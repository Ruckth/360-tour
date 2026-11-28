import type { Page } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTodayIso } from "../../convex/shared/time";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

const PHONE = { width: 390, height: 844 };

/** No page-level horizontal panning: nothing is wider than the viewport. */
async function expectNoHorizontalPan(page: Page) {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

/** The Monday on or before an ISO date. */
function mondayOf(iso: string) {
  const weekday = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -weekday);
}

test("D24: on a phone, Friday 10:00–18:00 for three therapists saves, survives reload and never pans sideways", async ({ page }) => {
  test.setTimeout(90_000);
  const owner = await signedInBackend(page);
  await page.setViewportSize(PHONE);
  // A week well ahead of any seeded appointment, so the change cannot conflict.
  const weekStart = mondayOf(addDaysIso(resortTodayIso(), 98));
  const friday = addDaysIso(weekStart, 4);
  const week = await owner.query(api.services.roster.getWeek, { weekStart });
  const people = week.staff.slice(0, 3);
  if (people.length < 3) throw new Error("The integration seed needs at least three active staff.");
  const cells = people.map((person) => ({ staffId: person._id, date: friday }));
  try {
    await page.goto(`/admin/staff/roster?date=${weekStart}`);
    const dayPicker = page.getByRole("group", { name: "Day to edit" });
    await chooseBranchIfPrompted(page, dayPicker);
    await expect(dayPicker).toBeVisible();
    // The 56rem desktop grid is not what a phone edits.
    await expect(page.getByRole("grid")).toBeHidden();
    await expectNoHorizontalPan(page);

    await dayPicker.getByRole("button", { name: /^Fri / }).click();
    const roster = page.getByRole("list", { name: /^Roster for Fri / });
    for (const person of people) await roster.getByRole("button", { name: new RegExp(`^${person.name},`) }).click();
    const toolbar = page.getByRole("toolbar", { name: "Change selected cells" });
    await expect(toolbar).toContainText("3 cells selected");
    await expect(dayPicker.getByRole("button", { name: /^Fri .*, 3 selected$/ })).toBeVisible();
    await expectNoHorizontalPan(page);

    await toolbar.getByRole("button", { name: "Custom…" }).click();
    const dialog = page.getByRole("dialog", { name: "Custom hours" });
    await expect(dialog).toContainText("3 selected cells");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(toolbar).toContainText("Select cells");

    await expect.poll(async () => {
      const saved = await owner.query(api.services.roster.getWeek, { weekStart });
      return cells.map(({ staffId }) => saved.cells.find((cell) => cell.staffId === staffId && cell.date === friday)?.shifts);
    }).toEqual(cells.map(() => [{ start: "10:00", end: "18:00" }]));

    await page.reload();
    await expect(dayPicker).toBeVisible();
    await dayPicker.getByRole("button", { name: /^Fri / }).click();
    for (const person of people) {
      await expect(roster.getByRole("button", { name: new RegExp(`^${person.name}, Fri .*: 10:00 to 18:00`) })).toBeVisible();
    }
    await expectNoHorizontalPan(page);
  } finally {
    await owner.mutation(api.services.roster.resetCells, { cells, skipConflicts: true });
  }
});

test("D14/D21: on a phone, the calendar finds an appointment beyond the loaded days through hidden filters, and the empty-day jump follows the filters", async ({ page }) => {
  test.setTimeout(90_000);
  const owner = await signedInBackend(page);
  await page.setViewportSize(PHONE);
  const services = await owner.query(api.services.admin.listServices, {});
  const service = services.find((row) => row.status === "active" && row.staffIds.length >= 2);
  if (!service) throw new Error("The integration seed needs a service with two staff.");
  const [shownStaff, hiddenStaff] = service.staffIds as [Id<"staff">, Id<"staff">];
  const staff = await owner.query(api.services.admin.listStaff, {});
  const hiddenName = staff.find((person) => person._id === hiddenStaff)!.name;
  // Guest search matches any name word, so each guest gets its own random word (no shared suffix).
  const word = () => `g${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const farWord = word();
  const [hiddenGuest, shownGuest, farGuest] = [`Hidden ${word()}`, `Shown ${word()}`, `Lookup ${farWord}`];
  const book = async (date: string, staffId: Id<"staff">, guestName: string) => {
    const slot = (await owner.query(api.services.admin.findOpenSlots, { serviceId: service._id, date, staffId }))[0];
    if (!slot) throw new Error(`No open slot on ${date}`);
    await owner.mutation(api.services.commands.createAppointment.createAppointment, {
      serviceId: service._id, staffId, start: slot.start, guestName, guestPhone: "+66812345678",
    });
    return slot.start;
  };
  // Far enough ahead to be empty in the seed: a hidden earlier appointment and a visible later one.
  const empty = addDaysIso(resortTodayIso(), 150);
  await book(addDaysIso(empty, 8), hiddenStaff, hiddenGuest);
  await book(addDaysIso(empty, 12), shownStaff, shownGuest);
  // D14 target: three weeks out, behind a hidden status filter.
  await book(addDaysIso(resortTodayIso(), 21), shownStaff, farGuest);

  await page.goto("/admin/staff/calendar");
  const search = page.getByRole("searchbox", { name: "Search appointments" }).or(page.getByRole("textbox", { name: "Search appointments" }));
  await chooseBranchIfPrompted(page, search.first());
  // Hide booked appointments on this device, as an operator might have.
  await page.evaluate(() => window.localStorage.setItem("admin.staff.hiddenStatuses", JSON.stringify(["booked"])));
  await page.reload();
  // Only the unique word: earlier runs leave other "Lookup …" guests in a reused local database.
  await search.first().fill(farWord);
  const status = page.getByRole("status").filter({ hasText: "No matching appointments in" });
  await expect(status).toBeVisible();
  await status.getByRole("button", { name: "Search all dates" }).click();
  const results = page.getByRole("region", { name: "Appointments on all dates" });
  await expect(results).toContainText(`1 match for “${farWord}”`);
  await results.getByRole("button", { name: new RegExp(farGuest) }).click();
  await expect(page.getByRole("dialog").filter({ hasText: farGuest })).toBeVisible();
  await expect(page.getByText("Showing this appointment even though your filters or search would hide it.")).toBeVisible();
  await expectNoHorizontalPan(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog").filter({ hasText: farGuest })).toBeHidden();

  // D21: clear the status filter, hide one therapist, and open an empty week.
  await page.evaluate(() => window.localStorage.setItem("admin.staff.hiddenStatuses", "[]"));
  await page.goto(`/admin/staff/calendar?date=${empty}`);
  await search.first().waitFor();
  await page.getByRole("button", { name: /of \d+ staff/ }).click();
  await page.getByRole("checkbox", { name: new RegExp(`^${hiddenName}`) }).uncheck();
  await page.keyboard.press("Escape");
  const jump = page.getByRole("button", { name: /^Next matching appointment:/ });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByText(shownGuest).first()).toBeVisible();
  await expect(page.getByText(hiddenGuest)).toHaveCount(0);
  await expectNoHorizontalPan(page);
});
