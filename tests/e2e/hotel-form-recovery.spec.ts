import { api } from "../../convex/_generated/api";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test, type Page } from "./fixtures";

test.setTimeout(75_000);

async function openHotelForm(page: Page, name: string) {
  await page.goto("/admin/hotel");
  const tools = page.getByRole("button", { name: "More calendar tools" });
  await chooseBranchIfPrompted(page, tools);
  await tools.click();
  await page.getByRole("menuitem", { name }).click();
  return page.getByRole("dialog", { name, exact: true });
}

async function pickDay(calendar: Page, date: string) {
  const day = calendar.locator(`[data-day="${date}"]:not([data-outside]) button`).first();
  for (let month = 0; month < 3 && !(await day.isVisible()); month++) {
    await calendar.getByRole("button", { name: /next month/i }).first().click();
  }
  await day.click();
}

test("F01 F02 preserve a concurrent OTA link replacement and open it without losing the draft", async ({ page }) => {
  const owner = await signedInBackend(page);
  const villas = await owner.query(api.catalog.properties.adminList, {});
  const villa = villas.find(row => row.slug === "pool-villa")!;
  const rate = { propertyId: villa._id, platform: "booking_com" as const, nightlyRate: 100_000 };
  const updated = "https://example.com/hotel/new-listing";
  await owner.mutation(api.catalog.properties.upsertOtaRate, { ...rate, url: "https://example.com/hotel/old-listing" });
  const other = await page.context().newPage();
  try {
    const first = await openHotelForm(page, "OTA rates");
    const second = await openHotelForm(other, "OTA rates");
    for (const dialog of [first, second]) {
      await dialog.getByRole("combobox", { name: "Villa" }).click();
      await dialog.page().getByRole("option", { name: villa.name, exact: true }).click();
      await dialog.getByRole("link", { name: /Open Booking.com listing/ }).locator("../..").getByRole("button", { name: "Edit", exact: true }).click();
    }
    const price = first.getByRole("spinbutton");
    await price.fill("1234");
    await second.getByLabel("Listing URL (optional)").fill(updated);
    await second.getByRole("button", { name: "Update rate" }).click();
    const listing = first.getByRole("link", { name: /Open Booking.com listing/ });
    await expect(listing).toHaveAttribute("href", updated);
    await page.context().route(updated, route => route.fulfill({ body: "Listing" }));
    await listing.focus();
    const [popup] = await Promise.all([page.waitForEvent("popup"), listing.press("Enter")]);
    await popup.waitForURL(updated);
    await popup.close();
    await expect(first).toBeVisible();
    await expect(listing).toBeFocused();
    await expect(price).toHaveValue("1234");
    await first.getByRole("button", { name: "Update rate" }).click();
    await expect.poll(async () => {
      const rows = await owner.query(api.catalog.properties.listOtaRates, { propertyId: villa._id });
      const saved = rows.find(row => row.platform === "booking_com");
      return { url: saved?.url, nightlyRate: saved?.nightlyRate };
    }).toEqual({ url: updated, nightlyRate: 123_400 });
  } finally {
    await other.close();
  }
});

test("F03 F04 retry keeps only the villas skipped in preview and during save", async ({ page }) => {
  const owner = await signedInBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const villas = (await owner.query(api.catalog.properties.adminList, {})).filter(row => row.status === "active").slice(0, 3);
  expect(villas).toHaveLength(3);
  const [unavailable, late, available] = villas;
  const start = addDaysIso(resortTodayIso(), 18);
  const end = addDaysIso(start, 2);
  const dates = { start, end };
  const block = api.bookings.calendar.addDateBlocks.addDateBlocks;
  await owner.mutation(block, { ...dates, propertyIds: [unavailable._id], reason: "Before review" });

  let waitForWrite: Promise<void> | undefined;
  let releaseWrite: (() => void) | undefined;
  await page.routeWebSocket(/\/api\/[^/]+\/sync/, socket => {
    const server = socket.connectToServer();
    socket.onMessage(async message => {
      if (typeof message === "string" && message.includes('"type":"Mutation"') && message.includes("addDateBlocks:addDateBlocks")) {
        releaseWrite?.();
        await waitForWrite;
      }
      server.send(message);
    });
  });
  const dialog = await openHotelForm(page, "Block dates");
  for (const villa of villas) await dialog.getByRole("checkbox", { name: villa.name, exact: true }).check();
  await dialog.getByTestId("booking-check-in").click();
  await pickDay(page, start);
  await pickDay(page, end);
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Planned maintenance");
  await expect(dialog.getByText("2 of 3 villas can be blocked")).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: unavailable.name })).toBeVisible();

  const writeRequested = new Promise<void>(resolve => { releaseWrite = resolve; });
  let forwardWrite!: () => void;
  waitForWrite = new Promise<void>(resolve => { forwardWrite = resolve; });
  try {
    await dialog.getByRole("button", { name: /Save 2 blocks.*skip 1/ }).click();
    await writeRequested;
    await owner.mutation(block, { ...dates, propertyIds: [late._id], reason: "Taken during save" });
  } finally {
    forwardWrite();
  }
  const outcome = page.getByRole("dialog", { name: "Blocked 1 of 3 villas" });
  await expect(outcome.getByRole("heading")).toBeVisible();
  await expect(outcome.getByRole("listitem").filter({ hasText: available.name })).toContainText("Blocked");
  await outcome.getByRole("button", { name: "Retry skipped villas" }).press("Enter");
  await expect(dialog.getByRole("checkbox", { name: unavailable.name, exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: late.name, exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: available.name, exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("textbox", { name: "Reason" })).toHaveValue("Planned maintenance");
  await expect(dialog.getByTestId("booking-check-in")).toHaveAttribute("data-selected-date", start);
  await expect(dialog.getByTestId("booking-check-out")).toHaveAttribute("data-selected-date", end);
  await expect(dialog.getByText("0 of 2 villas can be blocked")).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
});

test("F12 repeated time-off conflict opens the same appointment and F13 focuses the linked roster day", async ({ page }) => {
  const owner = await signedInBackend(page);
  await page.setViewportSize({ width: 900, height: 720 });
  const services = await owner.query(api.services.admin.listServices, {});
  const service = services.find(row => row.status === "active" && row.staffIds.length > 0)!;
  const staff = await owner.query(api.services.admin.listStaff, {});
  let date = addDaysIso(resortTodayIso(), 9);
  let slot;
  for (let day = 0; day < 7; day++, date = addDaysIso(date, 1)) {
    [slot] = await owner.query(api.services.admin.findOpenSlots, { serviceId: service._id, date });
    if (slot) break;
  }
  if (!slot) throw new Error("Expected a slot in the seeded service week");
  const person = staff.find(row => row._id === slot.autoStaffId)!;
  const guestName = `Time off conflict ${crypto.randomUUID().slice(0, 8)}`;
  const appointment = await owner.mutation(api.services.commands.createAppointment.createAppointment, {
    serviceId: service._id, staffId: person._id, start: slot.start, guestName, guestPhone: "+66812345678",
  });
  const addTimeOff = page.getByRole("button", { name: "Add time off", exact: true });
  await page.goto("/admin/staff/staff");
  await chooseBranchIfPrompted(page, addTimeOff);
  const conflictHrefs: (string | null)[] = [];
  for (let visit = 0; visit < 2; visit++) {
    await addTimeOff.click();
    const form = page.getByRole("dialog", { name: "Add time off" });
    await form.getByRole("checkbox", { name: person.name }).check();
    await form.getByRole("button", { name: "From", exact: true }).click();
    await pickDay(page, date);
    await form.getByRole("button", { name: "Add time off", exact: true }).click();
    const conflict = form.getByRole("link");
    await expect(conflict).toBeVisible();
    conflictHrefs.push(await conflict.getAttribute("href"));
    await conflict.press("Enter");
    await expect(form).toBeHidden();
    const sheet = page.getByRole("dialog", { name: `Appointment · ${guestName}` });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]appointment=/);
    if (visit === 0) await page.getByRole("tab", { name: "Therapists", exact: true }).click();
  }
  expect(conflictHrefs[1]).toBe(conflictHrefs[0]);
  expect(conflictHrefs[0]).toContain(`appointment=${appointment.appointmentId}`);

  await page.getByRole("button", { name: new RegExp(`^Not working · ${person.name}`) }).first().press("Enter");
  const rosterLink = page.getByRole("link", { name: "Open roster week" });
  await expect(rosterLink).toHaveAttribute("href", `/admin/staff/roster?date=${date}&staff=${person._id}`);
  await rosterLink.press("Enter");
  const target = page.getByRole("gridcell", { selected: true });
  await expect(target).toHaveAccessibleName(new RegExp(person.name));
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
});
