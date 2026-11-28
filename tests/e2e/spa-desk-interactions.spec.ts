import { api } from "../../convex/_generated/api";
import { appointmentRevision } from "../../convex/shared/appointmentWindow";
import { addDaysIso } from "../../convex/shared/dates";
import { resortMidnight, resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

const PHONE = { width: 390, height: 844 };

test.setTimeout(90_000);

test("D16 D22 mobile desk advances an appointment inline and counts hidden appointments in the visible date range", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const owner = await signedInBackend(page);
  const service = (await owner.query(api.services.admin.listServices, {}))
    .find((row) => row.status === "active" && row.staffIds.length > 0);
  if (!service) throw new Error("The integration seed needs an active service with assigned staff.");
  const serviceId = service._id;
  const staffId = service.staffIds[0];
  const date = addDaysIso(resortTodayIso(), 112);
  const range = { from: resortMidnight(date), to: resortMidnight(addDaysIso(date, 7)) };
  const readSchedule = () => owner.query(api.services.admin.listSchedule, range);
  const before = await readSchedule();
  const person = before.staff.find((staff) => staff._id === staffId);
  if (!person) throw new Error("The assigned therapist must be active.");
  const baseline = before.appointments.filter((appointment) =>
    appointment.staffId === staffId && appointment.start < range.to && appointment.end > range.from &&
    appointment.status !== "cancelled" && appointment.status !== "no_show"
  ).length;
  const guest = `Inline desk ${crypto.randomUUID().slice(0, 8)}`;
  async function book(fromDate: string, guestName: string) {
    for (let offset = 0; offset < 7; offset++) {
      const [slot] = await owner.query(api.services.admin.findOpenSlots, {
        date: addDaysIso(fromDate, offset), staffId, serviceId,
      });
      if (slot) return owner.mutation(api.services.commands.createAppointment.createAppointment, {
        serviceId, staffId, start: slot.start, guestName, guestPhone: "+66812345678",
      });
    }
    throw new Error(`No open slots in the week starting ${fromDate}`);
  }

  const cancelled = await book(date, `Cancelled ${guest}`);
  const cancelledRow = (await readSchedule()).appointments.find((row) => row._id === cancelled.appointmentId);
  if (!cancelledRow) throw new Error("Expected the appointment scheduled for cancellation in the visible week.");
  await owner.mutation(api.services.commands.cancelAppointment.cancelAppointment, {
    appointmentId: cancelled.appointmentId, expectedRevision: appointmentRevision(cancelledRow),
  });
  await book(addDaysIso(date, 14), `Later ${guest}`);
  const active = await book(date, guest);
  const readStatus = async () => (await readSchedule()).appointments.find((row) => row._id === active.appointmentId)?.status;

  await page.goto(`/admin/staff/calendar?date=${date}`);
  const markArrived = page.getByRole("button", { name: `Mark arrived: ${guest}`, exact: true });
  await chooseBranchIfPrompted(page, markArrived);
  const sheet = page.getByRole("dialog", { name: `Appointment · ${guest}` });
  await markArrived.click();
  await expect(sheet).toBeHidden();
  await expect.poll(readStatus).toBe("arrived");
  const startService = page.getByRole("button", { name: `Start service: ${guest}`, exact: true });
  await startService.click();
  await expect(sheet).toBeHidden();
  await expect.poll(readStatus).toBe("in_service");
  await expect(startService).toBeHidden();
  const row = page.getByRole("button", { name: new RegExp(`^${guest}.*In service`) });
  await expect(row).toBeVisible();
  await expect(row).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const staffFilter = page.getByRole("button", { name: /of \d+ staff/ });
  await staffFilter.click();
  const staffGroup = page.getByRole("group", { name: "Staff", exact: true });
  // The name and count are on the wrapping label, alongside the checkbox.
  const label = staffGroup.locator("label").filter({
    has: page.getByText(`${person.name} · ${baseline + 1}`, { exact: true }),
  });
  await expect(label.getByRole("checkbox")).toBeChecked();
  await label.getByRole("checkbox").uncheck();
  await expect(staffFilter).toHaveAccessibleName(new RegExp(`· ${baseline + 1} hidden appt${baseline ? "s" : ""}$`));
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(staffFilter).toHaveAccessibleName(new RegExp(`· ${baseline + 1} hidden appt${baseline ? "s" : ""}$`));
  await expect(row).toHaveCount(0);
  await staffFilter.click();
  await staffGroup.getByRole("button", { name: "Show all" }).click();
  await page.keyboard.press("Escape");
  await expect(row).toBeVisible();
});

test("D18 keyboard opens the calendar's off-shift explanation and follows the selected roster cell", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await signedInBackend(page);
  const date = addDaysIso(resortTodayIso(), 140);
  await page.goto(`/admin/staff/calendar?date=${date}`);
  const offShift = page.getByRole("button", { name: /^Not working · / }).first();
  await chooseBranchIfPrompted(page, offShift);
  const offShiftTitle = await offShift.getAttribute("aria-label");
  if (!offShiftTitle) throw new Error("Expected an accessible off-shift calendar block.");
  await offShift.press("Enter");
  const explanation = page.getByRole("dialog", { name: /is not working$/ });
  await expect(explanation).toContainText("outside their rostered shift");
  const person = (await explanation.getByRole("heading").innerText()).replace(/ is not working$/, "");
  expect(offShiftTitle).toContain(person);
  await explanation.getByRole("link", { name: "Open roster week" }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/staff/roster\\?date=${date}&staff=`));
  const cell = page.getByRole("gridcell", { selected: true });
  await expect(cell).toHaveAccessibleName(new RegExp(`^${person},`));
  await expect(cell).toBeFocused();
  await expect(cell).toBeInViewport();
});

test("D44 D25 keyboard tabs protect an unsaved assignment before opening therapist and Team settings", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signedInBackend(page);
  await page.goto("/admin/staff/services");
  const tabList = page.getByRole("tablist", { name: "Staff bookings sections" });
  const services = tabList.getByRole("tab", { name: "Services", exact: true });
  const therapists = tabList.getByRole("tab", { name: "Therapists", exact: true });
  const matrix = page.getByRole("button", { name: "Who does what", exact: true });
  await chooseBranchIfPrompted(page, matrix);
  await matrix.click();

  const assignment = page.getByRole("checkbox", { name: / performs / }).first();
  await expect(assignment).toBeVisible();
  const originallyAssigned = await assignment.isChecked();
  await assignment.press("Space");
  await expect(assignment).toHaveJSProperty("checked", !originallyAssigned);
  await services.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(therapists).toBeFocused();
  await expect(services).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/admin\/staff\/services$/);

  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(therapists).toBeFocused();
  await expect(page).toHaveURL(/\/admin\/staff\/services$/);
  await expect(assignment).toHaveJSProperty("checked", !originallyAssigned);

  await therapists.press("Space");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/staff\/staff$/);
  await expect(therapists).toHaveAttribute("aria-selected", "true");
  await expect(therapists).toBeFocused();

  // The assignment returns to its persisted value when reopening the editor.
  await services.press("Enter");
  await matrix.click();
  await expect(assignment).toHaveJSProperty("checked", originallyAssigned);
  await therapists.press("Enter");
  const team = page.getByRole("link", { name: "Settings → Team", exact: true });
  await team.press("Enter");
  await expect(page).toHaveURL(/\/admin\/settings\?tab=team$/);
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeVisible();
});
