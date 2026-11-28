import { api } from "../../convex/_generated/api";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTime24, resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("D19/D20 Spa-origin stay picker attaches an eligible villa stay and recovers from occupancy", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const services = await owner.query(api.services.admin.listServices, {});
  const service = services.find((row) => row.status === "active" && row.staffIds.length);
  if (!service) throw new Error("The integration seed needs a staffed service.");
  const firstDay = addDaysIso(resortTodayIso(), 120);
  const staffId = service.staffIds[0];
  const therapist = (await owner.query(api.services.admin.listStaff, {})).find((person) => person._id === staffId);
  if (!therapist) throw new Error("The seeded therapist is unavailable.");
  let date = firstDay;
  for (let offset = 0; offset < 7; offset++) {
    date = addDaysIso(firstDay, offset);
    const slots = await owner.query(api.services.admin.findOpenSlots, { serviceId: service._id, date, staffId });
    if (slots[0] && slots.at(-1)!.start - slots[0].start >= (service.durationMin + service.bufferMin) * 60_000) break;
    if (offset === 6) throw new Error("The seeded service has no open times in the fixture week.");
  }
  const guestName = `Spa guest ${crypto.randomUUID().slice(0, 8)}`;
  const bookingId = await owner.mutation(api.bookings.commands.createBooking.createBooking, {
    propertySlug: "pool-villa", guestName, guestPhone: "+66812345678",
    checkIn: date, checkOut: addDaysIso(date, 1), guests: 1, confirmed: true, notifyGuest: false,
  });
  await page.goto(`/admin/staff/calendar?date=${date}`);
  const newAppointment = page.getByRole("button", { name: "New appointment", exact: true }).first();
  await chooseBranchIfPrompted(page, newAppointment);
  await page.evaluate((id) => localStorage.setItem("admin.staff.lastServiceId", id), service._id);
  await page.reload();
  await newAppointment.click();
  const dialog = page.getByRole("dialog", { name: "New appointment" });
  await dialog.getByText("Attach to a hotel stay (optional)", { exact: true }).click();
  await dialog.getByLabel("Find the stay by guest name, phone, email or code").fill(guestName);
  await dialog.getByRole("button", { name: new RegExp(guestName) }).click();
  await expect(dialog.getByText(/Tideglass Pool Residence.*confirmed/i)).toBeVisible();
  await dialog.getByLabel("Guest name (optional)").fill(guestName);
  const staff = dialog.getByLabel("Staff", { exact: true });
  await staff.click();
  await page.getByRole("option", { name: therapist.name, exact: true }).click();
  const slots = await owner.query(api.services.admin.findOpenSlots, { serviceId: service._id, date, staffId });
  const first = slots[0];
  const last = slots.at(-1)!;
  const timeButton = (start: number) => dialog.getByRole("button", { name: resortTime24(start), exact: true });
  await timeButton(first.start).click();
  await owner.mutation(api.services.commands.createAppointment.createAppointment, {
    serviceId: service._id, staffId, start: first.start, guestName: "Concurrent appointment", guestPhone: "+66812345678",
  });
  await expect(dialog.getByRole("status").filter({ hasText: "is no longer open" })).toBeVisible();
  await expect(staff).toContainText(therapist.name);
  await expect(dialog.getByLabel("Guest name (optional)")).toHaveValue(guestName);
  await expect(dialog.getByText("Attached hotel stay")).toBeVisible();
  await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
  await timeButton(last.start).click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => {
    const linked = await owner.query(api.bookings.admin.stayAppointments, { bookingId });
    return linked.appointments.map((appointment) => appointment.serviceName);
  }).toEqual([service.name]);
});

test("D23 stale Spa appointment link returns to the calendar", async ({ page }) => {
  await page.goto("/admin/staff/calendar?appointment=missing-appointment");
  const dismiss = page.getByRole("button", { name: "Dismiss appointment link" });
  await chooseBranchIfPrompted(page, dismiss);
  await expect(page.getByRole("status").filter({ hasText: "This linked appointment is no longer available" })).toBeVisible();
  await dismiss.click();
  await expect(page).toHaveURL(/\/admin\/staff\/calendar$/);
  await expect(dismiss).toBeHidden();
  await expect(page.getByRole("button", { name: "New appointment", exact: true }).first()).toBeVisible();
});
