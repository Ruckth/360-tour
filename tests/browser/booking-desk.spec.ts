import { expect, test, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { DESK_VIEWPORTS, Taps, openDesk } from "./helpers/desk-taps";

/*
 * P5 bookings: the desk journeys, counted on the desk fixture (booking-desk-fixture.tsx) at iPad
 * landscape and phone size. Targets are from docs/plans/ux-simplification-plan.md ("What we'll
 * measure"); counts are taps from the page where the work happens.
 */
test.use({ timezoneId: "Asia/Bangkok" });

const calls = (page: Page) => page.evaluate(() => window.desk.calls());
const chip = (page: Page, guest: string) => page.locator("[data-slot=event-calendar-event]", { hasText: guest }).first();
const popover = (page: Page, guest: string) => page.getByRole("dialog", { name: `Booking for ${guest}` });

for (const [size, viewport] of Object.entries(DESK_VIEWPORTS)) {
  test.describe(size, () => {
    test.use({ viewport });

    test("record payment from the calendar: 3 taps, its own dialog, same revision and one attempt key", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Maya Lin"), "Maya's stay");
      await t.tap(popover(page, "Maya Lin").getByRole("button", { name: "Record payment" }), "Record payment");
      // The dialog opens on the calendar, not inside the stay sheet.
      await expect(page.getByRole("dialog", { name: "Record payment" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Maya Lin" })).toHaveCount(0);
      await t.tap(page.getByRole("button", { name: "Record ฿8,500" }), "Record ฿8,500");
      await expect(page.getByRole("status")).toContainText("Maya Lin: Payment recorded.");
      expect(t.summary()).toMatchObject({ taps: 3, typed: 0, scrolls: 0 });
      const [payment] = (await calls(page)).filter((call) => call.name === "recordPayment");
      expect(payment.args).toMatchObject({ bookingId: "fxbkg000003", expectedRevision: 1, expectedAmount: 8500, method: "cash" });
      expect((payment.args as { idempotencyKey: string }).idempotencyKey).toMatch(/^pay-/);
    });

    test("cancel a paid stay opens its own dialog", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Maya Lin").click();
      await popover(page, "Maya Lin").getByRole("button", { name: "Cancel stay" }).click();
      const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("radio", { name: "Keep the payment" })).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel booking" }).click();
      await expect(dialog).toHaveCount(0);
      expect((await calls(page)).find((call) => call.name === "cancelStay")?.args).toMatchObject({ bookingId: "fxbkg000003", expectedRevision: 1 });
    });

    test("arrivals: 1 tap for the list, then 1 per guest", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      const today = page.getByRole("region", { name: "Today" });
      await expect(today.getByRole("button", { name: /Arriving/ })).toContainText("2");
      await expect(today.getByRole("button", { name: /Leaving/ })).toContainText("1");
      await expect(today.getByRole("button", { name: /In house/ })).toContainText("1");
      await expect(today.getByRole("button", { name: /Balance due/ })).toContainText("฿44,300");
      await t.tap(today.getByRole("button", { name: /Arriving/ }), "Arriving");
      const list = today.getByRole("list", { name: "Arriving" });
      await expect(list.getByRole("button")).toHaveText([/Ken Tanaka/, /Maya Lin/]);
      await t.tap(list.getByRole("button", { name: /Ken Tanaka/ }), "Ken");
      await expect(popover(page, "Ken Tanaka")).toBeVisible();
      await page.keyboard.press("Escape");
      await t.tap(list.getByRole("button", { name: /Maya Lin/ }), "Maya");
      await expect(popover(page, "Maya Lin")).toBeVisible();
      expect(t.summary()).toMatchObject({ taps: 3, typed: 0, scrolls: 0 });
    });

    test("book spa for a staying guest: 5 taps, nothing typed, on the stay", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Maya Lin"), "Maya's stay");
      await t.tap(popover(page, "Maya Lin").getByRole("button", { name: "Book spa" }), "Book spa");
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await expect(dialog).toContainText("For Maya Lin · Garden Villa");
      await expect(dialog.getByLabel(/Guest name|Phone|Email/)).toHaveCount(0);
      await t.tap(dialog.getByRole("button", { name: /^Hot stone 60/ }), "Hot stone 60");
      await t.tap(dialog.getByRole("button", { name: "3:00 PM" }), "15:00");
      await t.tap(dialog.getByRole("button", { name: /^Book Hot stone 60 · 3:00/ }), "Book");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("status")).toContainText("Maya Lin: spa booked");
      expect(t.summary()).toMatchObject({ taps: 5, typed: 0, scrolls: 0 });
      const created = (await calls(page)).find((call) => call.name === "createAppointment")!.args;
      expect(created).toMatchObject({ bookingId: "fxbkg000003", guestName: "Maya Lin", guestPhone: "+66 81 234 5678", serviceId: "fxsvc000005" });
      // Checkout from her stay now takes the spa too.
      await chip(page, "Maya Lin").click();
      await expect(popover(page, "Maya Lin").getByRole("button", { name: "Checkout ฿10,000" })).toBeVisible();
    });

    test("guest leaves: balance with spa, paid, receipt printed in 5 taps", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Anna Schmidt"), "Anna's stay");
      // ฿26,000 left on the stay and her unpaid Hot stone 60 (฿1,500).
      await t.tap(popover(page, "Anna Schmidt").getByRole("button", { name: "Checkout ฿27,500" }), "Checkout ฿27,500");
      await expect(page.locator("[data-route=order]")).toBeVisible();
      expect(await calls(page)).toEqual([{ name: "openStayCheckout", args: { bookingId: "fxbkg000001" } }]);
      if (size === "phone") await t.tap(page.getByRole("button", { name: /^View order/ }), "View order");
      await expect(page.getByText("Hot stone 60").first()).toBeVisible();
      await t.tap(page.getByRole("button", { name: "Cash", exact: true }), "Cash");
      await t.tap(page.getByRole("button", { name: /^Confirm cash/ }), "Confirm cash");
      await t.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      await expect(page.locator("body")).toHaveAttribute("data-printed", "1");
      await expect(page.getByRole("article", { name: "Receipt" })).toContainText("27,500");
      // iPad: 5, since cash opens with the amount due. A phone adds "View order" (plan: counts are iPad).
      expect(t.summary()).toMatchObject({ taps: size === "phone" ? 6 : 5, typed: 0 });
    });

    test("stay sheet leads with one money block and reads in one sentence", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Anna Schmidt").click();
      await popover(page, "Anna Schmidt").getByRole("button", { name: "Details" }).click();
      const sheet = page.getByRole("dialog", { name: "Anna Schmidt" });
      const money = sheet.getByRole("region", { name: "Balance due" });
      await expect(money).toContainText("฿27,500");
      await expect(money).toContainText("Stay ฿26,000 · Spa ฿1,500");
      await expect(money.getByRole("button")).toHaveText(["Take payment", "Already paid…"]);
      // The money block is the first thing under the title.
      const top = await money.boundingBox();
      expect(top!.y).toBeLessThan(160);
      await expectAtMostSentences(sheet, 1);
      await money.getByRole("button", { name: "Already paid…" }).click();
      await expect(page.getByRole("button", { name: "Record ฿26,000" })).toBeVisible();
    });

    test("appointment sheet: one next step, ⋯, and the money block (9 buttons → 3)", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" }).first().click();
      const sheet = page.getByRole("dialog", { name: /Ken Tanaka/ });
      await expect(sheet.getByRole("region", { name: "Balance due" })).toContainText("฿1,200");
      // Buttons, not counting the sheet's own ✕ and the "Already paid…" text link.
      const buttons = sheet.locator("button:visible").filter({ hasNotText: /^Close$|^Already paid…$/ });
      const take = sheet.getByRole("link", { name: "Take payment" });
      await expect(take).toHaveAttribute("href", /\/admin\/checkout\?appointment=/);
      await expect(buttons).toHaveText(["Mark arrived", ""]);
      expect((await buttons.count()) + (await take.count())).toBe(3);
      await expect(sheet.getByRole("button", { name: "More appointment actions" })).toBeVisible();
      await expectAtMostSentences(sheet, 1);
      await sheet.getByRole("button", { name: "More appointment actions" }).click();
      const menu = page.getByRole("menu", { name: "More appointment actions" });
      await expect(menu.getByRole("menuitem")).toHaveText(["Start service", "Complete", "No-show", "Correct date / time", "Turnaround", "Edit details", "Correct status", "Cancel appointment"]);
      await menu.getByRole("menuitem", { name: "Complete" }).click();
      await expect.poll(async () => (await calls(page)).find((call) => call.name === "updateAppointmentStatus")?.args).toMatchObject({ status: "completed" });
    });

    test("new booking: total and nights, sticky Create, no footer Close", async ({ page }) => {
      await openDesk(page);
      await page.getByRole("button", { name: "New booking" }).click();
      const dialog = page.getByRole("dialog", { name: "New booking" });
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
      await expect(dialog).not.toContainText("Holds the dates now");
      await page.getByTestId("booking-check-in").click();
      await page.locator(`[data-day="2026-11-20"] button`).click();
      await page.locator(`[data-day="2026-11-23"] button`).click();
      await expect(dialog.getByText("Total ฿36,000")).toBeVisible();
      await expect(dialog).toContainText("· 3 nights");
      const create = dialog.getByRole("button", { name: "Create booking" });
      const box = await create.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole("button", { name: "Block these dates instead" })).toBeVisible();
    });

    test("OTA tools sit in ⋯", async ({ page }) => {
      await openDesk(page);
      await expect(page.getByRole("button", { name: "OTA calendars" })).toHaveCount(0);
      await page.getByRole("button", { name: "More calendar tools" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Block dates", "OTA calendars", "OTA rates", "Clean up old bookings"]);
    });
  });
}

test("the staff calendar remembers its view and filters on this device", async ({ page }) => {
  await page.setViewportSize(DESK_VIEWPORTS.ipad);
  await openDesk(page, "?view=staff");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("group", { name: "Status" }).getByRole("checkbox", { name: "Completed" }).uncheck();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show cancelled" }).click();
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Hide cancelled" })).toBeVisible();
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("group", { name: "Status" }).getByRole("checkbox", { name: "Completed" })).not.toBeChecked();
});
