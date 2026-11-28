import { api } from "../../convex/_generated/api";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("hotel staff can read the phone calendar key and open maintenance with a keyboard", async ({ page }) => {
  test.setTimeout(60_000);
  await signedInBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/hotel");
  const tools = page.getByRole("button", { name: "More calendar tools" });
  await chooseBranchIfPrompted(page, tools);
  await expect(tools).toBeEnabled();

  const key = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Key$/ }) });
  const summary = key.locator("summary");
  await summary.click();
  for (const label of ["Paid", "Pending · dashed border", "Confirmed · balance due", "Cancelled", "Host block", "OTA block"]) {
    await expect(key.getByText(label, { exact: true })).toBeVisible();
  }
  await summary.click();
  await expect(key.getByText("OTA block")).toBeHidden();

  await tools.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More calendar tools" });
  await expect(menu).toBeVisible();
  for (const name of ["View", "Add", "Channels", "Maintenance"]) {
    await expect(menu.getByRole("group", { name })).toBeVisible();
  }
  await page.keyboard.press("End");
  const cleanup = menu.getByRole("menuitem", { name: /Clean up old bookings/ });
  await expect(cleanup).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Clean up test bookings" });
  await expect(dialog).toBeVisible();
  const threshold = dialog.getByRole("spinbutton", { name: "Older than (days)" });
  const hint = dialog.locator("#cleanup-days-hint");
  const apply = dialog.getByRole("button", { name: "Apply" });
  await threshold.fill("30");
  await threshold.press("Tab");
  await expect(hint).toContainText("more than 7 days");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(hint).toContainText("more than 30 days");
  for (const invalid of ["", "-1", "1.5"]) {
    await threshold.fill(invalid);
    await threshold.press("Tab");
    await expect(apply).toBeDisabled();
    await expect(hint).toContainText("more than 30 days");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tools).toBeFocused();
});

test("opening a stay's spa form shows only appointments attached to that booking", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const services = await owner.query(api.services.admin.listServices, {});
  const service = services.find(row => row.staffIds.length > 0);
  if (!service) throw new Error("The integration seed needs a staffed service.");
  const firstDay = addDaysIso(resortTodayIso(), 42);
  for (let offset = 0; offset < 7; offset++) {
    const date = addDaysIso(firstDay, offset);
    const slots = await owner.query(api.services.admin.findOpenSlots, { serviceId: service._id, date });
    const first = slots[0];
    const last = slots.at(-1);
    if (!first || !last || (last.start - first.start) < (service.durationMin + service.bufferMin) * 60_000) continue;
    const guestName = `Hotel spa ${crypto.randomUUID().slice(0, 8)}`;
    const bookingId = await owner.mutation(api.bookings.commands.createBooking.createBooking, {
      propertySlug: "pool-villa", guestName, guestPhone: "+66812345678",
      checkIn: date, checkOut: addDaysIso(date, 1), guests: 1, confirmed: true, notifyGuest: false,
    });
    // The two appointments share the guest and service. Only one has this stay's record ID.
    const appointment = { serviceId: service._id, guestName, guestPhone: "+66812345678" };
    await owner.mutation(api.services.commands.createAppointment.createAppointment, { ...appointment, bookingId, start: first.start });
    await owner.mutation(api.services.commands.createAppointment.createAppointment, { ...appointment, start: last.start });
    await page.goto(`/admin/hotel?booking=${bookingId}`);
    const bookSpa = page.getByRole("button", { name: "Book spa" });
    await chooseBranchIfPrompted(page, bookSpa);
    await bookSpa.click();
    const linked = page.getByRole("region", { name: "Linked spa appointments" });
    await expect(linked.getByRole("listitem")).toHaveCount(1);
    await expect(linked.getByRole("listitem")).toContainText(service.name);
    await expect(linked.getByRole("listitem")).toContainText("booked");
    return;
  }
  throw new Error("The seeded service needs two non-overlapping times within the fixture week.");
});

test("the hotel desk opens payment from today's balance and finds a past stay by keyboard", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const today = resortTodayIso();
  const name = `Desk ${crypto.randomUUID().slice(0, 8)}`;
  const base = { propertySlug: "pool-villa", guestName: name, guestPhone: "+66876543210", guests: 1, notifyGuest: false };
  await owner.mutation(api.bookings.commands.createBooking.createBooking, { ...base, checkIn: today, checkOut: addDaysIso(today, 1) });
  await owner.mutation(api.bookings.commands.createBooking.createBooking, { ...base, checkIn: addDaysIso(today, -32), checkOut: addDaysIso(today, -30) });
  await page.goto("/admin/hotel");
  const balance = page.getByRole("button", { name: /^Balance due / });
  await chooseBranchIfPrompted(page, balance);
  await expect(balance).toHaveAccessibleName(/THB/);
  await balance.click();
  const guest = page.getByRole("list", { name: "Balance due" }).getByRole("listitem").filter({ hasText: name });
  await guest.getByRole("button", { name: "Take payment" }).click();
  await expect(page).toHaveURL(/\/admin\/checkout\?order=[^&]+/);
  await page.goto("/admin/hotel");
  const search = page.getByRole("searchbox", { name: "Search bookings" });
  await search.fill(name);
  await expect(page.getByRole("region", { name: "Current or upcoming" }).getByRole("button")).toHaveCount(1);
  const past = page.getByRole("region", { name: "Past" }).getByRole("button", { name: new RegExp(name) });
  await past.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(name);
});
