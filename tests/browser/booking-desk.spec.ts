import { expect, test, type Locator, type Page } from "@playwright/test";
import { census } from "./helpers/screen-census";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { DESK_VIEWPORTS, Taps, openDesk } from "./helpers/desk-taps";

/*
 * P5 bookings and the round-2 desk pass: the desk journeys, counted on the desk fixture
 * (booking-desk-fixture.tsx) at iPad landscape and phone size. Targets are from
 * docs/plans/ux-simplification-plan.md ("What we'll measure") and the final audit
 * (docs/reviews/ux-audit/final-audit.md on ux/final-audit); counts are taps from the page where
 * the work happens. The fixture's "today" is Thursday 12 Nov 2026, 10:00 in Bangkok.
 */
test.use({ timezoneId: "Asia/Bangkok" });

const calls = (page: Page) => page.evaluate(() => window.desk.calls());
const chip = (page: Page, guest: string) => page.locator("[data-slot=event-calendar-event]", { hasText: guest }).first();
const popover = (page: Page, guest: string) => page.getByRole("dialog", { name: `Booking for ${guest}` });
/** Visible controls (buttons, fields, comboboxes…) inside `scope`, counted like the click audit. */
const controls = async (page: Page, scope: Locator) => {
  await scope.evaluate((el) => el.setAttribute("data-census", "1"));
  const counted = await census(page, "[data-census]");
  await scope.evaluate((el) => el.removeAttribute("data-census"));
  return counted.controlsOnPage;
};
/** Whether `target` is fully inside the viewport and not clipped by a scroller, so no scroll is needed. */
const inView = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return false;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
      const p = node.getBoundingClientRect();
      if (r.bottom > p.bottom + 1 || r.top < p.top - 1) return false;
    }
    return true;
  });

for (const [size, viewport] of Object.entries(DESK_VIEWPORTS)) {
  test.describe(size, () => {
    test.use({ viewport });

    test("stay popover: Take payment · Book spa · Details, the rest in ⋯", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Anna Schmidt").click();
      const pop = popover(page, "Anna Schmidt");
      await expect(pop.getByRole("button")).toHaveText(["Take payment ฿27,500", "Book spa", "Details", ""]);
      await pop.getByRole("button", { name: "More stay actions" }).click();
      await expect(page.getByRole("menu", { name: "More stay actions" }).getByRole("menuitem")).toHaveText(["Already paid…", "Copy reference", "Cancel stay"]);
    });

    test("already paid from the calendar: 4 taps, its own dialog, same revision and one attempt key", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Maya Lin"), "Maya's stay");
      await t.tap(popover(page, "Maya Lin").getByRole("button", { name: "More stay actions" }), "⋯");
      await t.tap(page.getByRole("menuitem", { name: "Already paid…" }), "Already paid…");
      // The dialog opens on the calendar, not inside the stay sheet.
      const dialog = page.getByRole("dialog", { name: "Already paid" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Maya Lin" })).toHaveCount(0);
      // One sentence; the date waits behind "Received now · Change", as at the till; ✕ closes it.
      await expectAtMostSentences(dialog, 1);
      await expect(dialog).not.toContainText("This does not charge the guest.");
      await expect(dialog).toContainText("Received now");
      await expect(dialog.getByLabel("Time (Bangkok)")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
      expect(await controls(page, dialog)).toBeLessThanOrEqual(9);
      await t.tap(page.getByRole("button", { name: "Record ฿8,500" }), "Record ฿8,500");
      await expect(page.getByTestId("toast")).toContainText("Maya Lin: Payment recorded.");
      expect(t.summary()).toMatchObject({ taps: 4, typed: 0, scrolls: 0 });
      const [payment] = (await calls(page)).filter((call) => call.name === "recordPayment");
      expect(payment.args).toMatchObject({ bookingId: "fxbkg000003", expectedRevision: 1, expectedAmount: 8500, method: "cash" });
      expect((payment.args as { idempotencyKey: string }).idempotencyKey).toMatch(/^pay-/);
    });

    test("cancel a paid stay opens its own dialog, with Keep stay", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Maya Lin").click();
      await popover(page, "Maya Lin").getByRole("button", { name: "More stay actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel stay" }).click();
      const dialog = page.getByRole("dialog", { name: "Cancel this stay?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("radio", { name: "Keep the payment" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Keep stay" })).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel stay" }).click();
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

    test("Today strip: nothing clipped (2 columns on a phone)", async ({ page }) => {
      await openDesk(page);
      const tiles = page.getByRole("region", { name: "Today" }).locator("button[aria-controls=today-list]");
      await expect(tiles).toHaveCount(4);
      const boxes = await tiles.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const clipped = [...el.querySelectorAll("span")].some((span) => span.scrollWidth > span.clientWidth + 1 || span.getBoundingClientRect().right > r.right + 1);
        return { top: Math.round(r.top), right: r.right, clipped };
      }));
      for (const box of boxes) {
        expect(box.right).toBeLessThanOrEqual(viewport.width);
        expect(box.clipped).toBe(false);
      }
      expect(new Set(boxes.map((b) => b.top)).size).toBe(size === "phone" ? 2 : 1);
    });

    test("hotel calendar toolbar: at most 8 controls, Today in the month picker, Show cancelled in ⋯", async ({ page }) => {
      await openDesk(page);
      const toolbar = page.getByTestId("calendar-toolbar");
      expect(await controls(page, toolbar)).toBeLessThanOrEqual(8);
      await expect(toolbar.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
      await expect(toolbar.getByRole("button", { name: "Show cancelled" })).toHaveCount(0);
      // Search is a box on iPad and an icon that opens it on a phone; the villa filter moves into ⋯ on a phone.
      if (size === "phone") {
        await expect(toolbar.getByRole("searchbox")).toBeHidden();
        await expect(toolbar.getByRole("combobox", { name: /Villa/ })).toHaveCount(0);
        await toolbar.getByRole("button", { name: "Search bookings" }).click();
        await expect(toolbar.getByRole("searchbox", { name: "Search bookings" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(toolbar.getByRole("searchbox")).toBeHidden();
      } else {
        await expect(toolbar.getByRole("searchbox", { name: "Search bookings" })).toBeVisible();
      }
      // Today sits inside the month picker.
      await toolbar.locator("[data-slot=event-calendar-date-picker]").click();
      await expect(page.getByRole("dialog").getByRole("button", { name: "Today", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "More calendar tools" }).click();
      const menu = page.getByRole("menu", { name: "More calendar tools" });
      await expect(menu.getByRole("menuitem")).toHaveText(["Block dates", "OTA calendars", "OTA rates", "Clean up old bookings"]);
      const toggles = menu.getByRole("menuitemcheckbox");
      await expect(toggles).toHaveText(size === "phone"
        ? ["All villas", "Lagoon Pool Villa", "Garden Villa", "Ocean Suite", "Tideglass Pool Residence", "Show cancelled"]
        : ["Show cancelled"]);
      await expect(menu.getByRole("menuitemcheckbox", { name: "Show cancelled" })).toHaveAttribute("aria-checked", "false");
      await menu.getByRole("menuitemcheckbox", { name: "Show cancelled" }).click();
      await page.getByRole("button", { name: "More calendar tools" }).click();
      await expect(page.getByRole("menuitemcheckbox", { name: "Show cancelled" })).toHaveAttribute("aria-checked", "true");
      if (size === "phone") {
        await page.getByRole("menuitemcheckbox", { name: "Garden Villa" }).click();
        await expect(chip(page, "Maya Lin")).toBeVisible();
        await expect(chip(page, "Anna Schmidt")).toHaveCount(0);
        await page.getByRole("button", { name: /Show all villas/ }).click();
        await expect(chip(page, "Anna Schmidt")).toBeVisible();
      }
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
      // Later today is a normal booking: 24-hour chips plus "Other time…", no time box, Auto staff.
      await expect(dialog.getByRole("group", { name: "Time" }).getByRole("button")).toHaveText(["10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "Other time…"]);
      await expect(dialog.locator("input[type=time]")).toHaveCount(0);
      await expect(dialog.getByRole("combobox", { name: "Staff" })).toContainText("Auto (least busy)");
      await expect(dialog).not.toContainText("Booked · Unpaid");
      await expectAtMostSentences(dialog, 1);
      await t.tap(dialog.getByRole("button", { name: "15:00", exact: true }), "15:00");
      await t.tap(dialog.getByRole("button", { name: "Book Hot stone 60 · 15:00" }), "Book");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("toast")).toContainText("Maya Lin: spa booked");
      expect(t.summary()).toMatchObject({ taps: 5, typed: 0, scrolls: 0 });
      const created = (await calls(page)).find((call) => call.name === "createAppointment")!.args;
      expect(created).toMatchObject({ bookingId: "fxbkg000003", guestName: "Maya Lin", guestPhone: "+66 81 234 5678", serviceId: "fxsvc000005" });
      // Auto picked the least busy qualified person; nobody was typed or chosen.
      expect((created as { staffId?: string }).staffId).toBeTruthy();
      // Taking payment from her stay now takes the spa too.
      await chip(page, "Maya Lin").click();
      await expect(popover(page, "Maya Lin").getByRole("button", { name: "Take payment ฿10,000" })).toBeVisible();
    });

    test("Other time… swaps the chips for a time box", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Maya Lin").click();
      await popover(page, "Maya Lin").getByRole("button", { name: "Book spa" }).click();
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await dialog.getByRole("button", { name: "Other time…" }).click();
      await expect(dialog.getByRole("button", { name: "15:00", exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("Time", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Open times" }).click();
      await expect(dialog.getByRole("button", { name: "15:00", exact: true })).toBeVisible();
    });

    test("new appointment for later today: normal form, Auto staff, Guest name without a scroll, one sentence", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await page.getByRole("button", { name: "New appointment" }).click();
      const dialog = page.getByRole("dialog", { name: "New appointment" });
      await expect(dialog.getByRole("combobox", { name: "Staff" })).toContainText("Auto (least busy)");
      await expect(dialog.locator("input[type=time]")).toHaveCount(0);
      await expect(dialog).not.toContainText("Past work");
      await expect(dialog.getByRole("button", { name: "Other time…" })).toBeVisible();
      await expectAtMostSentences(dialog, 1);
      expect(await inView(dialog.getByLabel("Guest name (optional)"))).toBe(true);
      // ✕ closes it; no footer Cancel.
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
      const t = new Taps(page);
      await t.tap(dialog.getByRole("group", { name: "Service" }).getByRole("button", { name: /^Hot stone 60/ }), "Hot stone 60");
      await t.tap(dialog.getByRole("button", { name: "15:00", exact: true }), "15:00");
      await t.type(dialog.getByLabel("Guest name (optional)"), "Walk-in Guest", "Guest name");
      await t.tap(dialog.getByRole("button", { name: "Book Hot stone 60 · 15:00" }), "Book");
      await expect.poll(async () => (await calls(page)).some((call) => call.name === "createAppointment")).toBe(true);
      expect(t.summary()).toMatchObject({ taps: 3, typed: 1, scrolls: 0 });
    });

    test("guest leaves: balance with spa, paid, receipt printed in 5 taps", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Anna Schmidt"), "Anna's stay");
      // ฿26,000 left on the stay and her unpaid Hot stone 60 (฿1,500).
      await t.tap(popover(page, "Anna Schmidt").getByRole("button", { name: "Take payment ฿27,500" }), "Take payment ฿27,500");
      await expect(page.locator("[data-route=order]")).toBeVisible();
      expect(await calls(page)).toEqual([{ name: "openStayCheckout", args: { bookingId: "fxbkg000001" } }]);
      if (size === "phone") await t.tap(page.getByRole("button", { name: /^View order/ }), "View order");
      await expect(page.getByText("Hot stone 60").first()).toBeVisible();
      await t.tap(page.getByRole("button", { name: "Cash", exact: true }), "Cash");
      await t.tap(page.getByRole("button", { name: /^Confirm ฿[\d,.]+ cash/ }), "Confirm cash");
      await t.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      await expect(page.locator("body")).toHaveAttribute("data-printed", "1");
      await expect(page.getByRole("article", { name: "Receipt" })).toContainText("27,500");
      // iPad: 5, since cash opens with the amount due. A phone adds "View order" (plan: counts are iPad).
      expect(t.summary()).toMatchObject({ taps: size === "phone" ? 6 : 5, typed: 0 });
    });

    test("stay sheet: one money block, one closed History, reference in ⋯, staff by name", async ({ page }) => {
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
      // Price, payments and changes share one closed History.
      await expect(sheet.locator("summary")).toHaveText(["History"]);
      await expect(sheet).not.toContainText("CONF-2026-A1B2C3");
      await expect(sheet).not.toContainText("ploy@auraliscove.co");
      await expect(sheet).toContainText("by ploy");
      await sheet.locator("summary", { hasText: "History" }).click();
      await expect(sheet.getByRole("heading", { name: "Payments and refunds" })).toBeVisible();
      await expect(sheet.getByRole("heading", { name: "Price" })).toBeVisible();
      await money.getByRole("button", { name: "Already paid…" }).click();
      const paid = page.getByRole("dialog", { name: "Already paid" });
      await expect(paid.getByRole("button", { name: "Record ฿26,000" })).toBeVisible();
      await paid.getByRole("button", { name: "Close", exact: true }).click();
      await sheet.getByRole("button", { name: "More booking actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Copy reference" })).toBeVisible();
    });

    test("appointment sheet: one filled primary, no Payment row, ⋯ of 6 with one Correct…", async ({ page }) => {
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
      // While a balance is due, Take payment is the one filled button.
      await expect(take).toHaveClass(/bg-primary/);
      await expect(sheet.getByRole("button", { name: "Mark arrived" })).not.toHaveClass(/bg-primary/);
      await expect(sheet.locator("dt", { hasText: /^Payment$/ })).toHaveCount(0);
      await expect(sheet).not.toContainText("SVC-0007");
      await expectAtMostSentences(sheet, 1);
      await sheet.getByRole("button", { name: "More appointment actions" }).click();
      const menu = page.getByRole("menu", { name: "More appointment actions" });
      await expect(menu.getByRole("menuitem")).toHaveText(["Start service", "Complete", "No-show", "Correct…", "Copy reference", "Cancel appointment"]);
      await menu.getByRole("menuitem", { name: "Correct…" }).click();
      const choose = page.getByRole("dialog", { name: "Correct" });
      await expect(choose.getByRole("button").filter({ hasNotText: /^Close$/ })).toHaveText(["Date or time", "Turnaround", "Status", "Guest, service or notes"]);
      await choose.getByRole("button", { name: "Status" }).click();
      await expect(page.getByRole("dialog", { name: "Correct status" })).toBeVisible();
      await page.keyboard.press("Escape");
      await sheet.getByRole("button", { name: "More appointment actions" }).click();
      await page.getByRole("menu", { name: "More appointment actions" }).getByRole("menuitem", { name: "Complete" }).click();
      await expect.poll(async () => (await calls(page)).find((call) => call.name === "updateAppointmentStatus")?.args).toMatchObject({ status: "completed" });
    });

    test("new booking: no description, no email note, no Clear on required dates, sticky Create", async ({ page }) => {
      await openDesk(page);
      await page.getByRole("button", { name: "New booking" }).click();
      const dialog = page.getByRole("dialog", { name: "New booking" });
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
      await expect(dialog).not.toContainText("Holds the dates now");
      await expect(dialog).not.toContainText("Manual bookings never expire");
      await expect(dialog).not.toContainText("No guest email on file");
      await page.getByTestId("booking-check-in").click();
      await expect(page.getByRole("button", { name: /^Clear / })).toHaveCount(0);
      await page.locator(`[data-day="2026-11-20"] button`).click();
      await page.locator(`[data-day="2026-11-23"] button`).click();
      await expect(dialog.getByText("Total ฿36,000")).toBeVisible();
      await expect(dialog).toContainText("· 3 nights");
      await expectAtMostSentences(dialog, 1);
      const create = dialog.getByRole("button", { name: "Create booking" });
      const box = await create.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole("button", { name: "Block these dates instead" })).toBeVisible();
      // The email choice shows once there is an email to send to.
      await dialog.getByLabel("Email (optional)").fill("guest@example.com");
      await expect(dialog.getByLabel(/Email guest about this booking/)).toBeVisible();
    });
  });
}

test.describe("touch", () => {
  test.use({ viewport: DESK_VIEWPORTS.ipad, hasTouch: true });
  test("the drag hint is for a mouse, so touch screens don't show it", async ({ page }) => {
    await openDesk(page);
    await expect(page.getByText(/Drag across days to book or block/)).toBeHidden();
  });
});

test("a mouse sees the drag hint", async ({ page }) => {
  await page.setViewportSize(DESK_VIEWPORTS.ipad);
  await openDesk(page);
  await expect(page.getByText(/Drag across days to book or block/)).toBeVisible();
});

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
