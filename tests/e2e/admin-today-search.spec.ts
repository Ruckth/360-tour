import { api } from "../../convex/_generated/api";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("Today leads to the resort desk and admin search opens the exact stay and appointment", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const services = await owner.query(api.services.admin.listServices, {});
  const service = services.find(row => row.staffIds.length > 0);
  if (!service) throw new Error("The integration seed needs a staffed service.");

  const guest = `Today ${crypto.randomUUID().slice(0, 8)}`;
  const today = resortTodayIso();
  const bookingId = await owner.mutation(api.bookings.commands.createBooking.createBooking, {
    propertySlug: "pool-villa", guestName: guest, guestPhone: "+66891234567", guests: 1,
    checkIn: addDaysIso(today, 30), checkOut: addDaysIso(today, 31), notifyGuest: false,
  });
  const openSlots = await Promise.all(Array.from({ length: 7 }, (_, index) => owner.query(
    api.services.admin.findOpenSlots, { serviceId: service._id, date: addDaysIso(today, 30 + index) },
  )));
  const slot = openSlots.find(slots => slots.length)?.[0];
  if (!slot) throw new Error("No seeded opening in the fixture week.");
  const { appointmentId } = await owner.mutation(api.services.commands.createAppointment.createAppointment, {
    serviceId: service._id, start: slot.start, guestName: guest, guestPhone: "+66891234567",
  });

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/today$/);
  const arrivals = page.getByRole("region", { name: "Hotel" }).getByRole("link", { name: /^Arriving/ });
  await chooseBranchIfPrompted(page, arrivals);
  await arrivals.click();
  await expect(page).toHaveURL(/\/admin\/hotel\?today=arriving$/);
  await expect(page.getByRole("button", { name: /^Arriving/, expanded: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search admin pages" });
  const matches = page.getByRole("group", { name: "Matching records" });
  await search.fill(guest);
  await matches.getByRole("region", { name: "Stays" }).getByRole("link", { name: new RegExp(guest) }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]booking=${bookingId}(?:&|$)`));
  await expect(page.getByRole("dialog")).toContainText(guest);

  await page.goto("/admin/today");
  await search.fill(guest);
  await matches.getByRole("region", { name: "Appointments" }).getByRole("link", { name: new RegExp(guest) }).press("Enter");
  await expect(page).toHaveURL(url => url.pathname === "/admin/staff/calendar" &&
    url.searchParams.get("appointment") === appointmentId && url.searchParams.get("date") === resortTodayIso(slot.start));
  await expect(page.getByRole("dialog", { name: new RegExp(guest) })).toBeVisible();
});
