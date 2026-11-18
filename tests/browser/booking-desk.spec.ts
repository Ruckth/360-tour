import { expect, test, type Locator, type Page } from "@playwright/test";
import { census } from "./helpers/screen-census";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { DESK_VIEWPORTS, Taps, openDesk } from "./helpers/desk-taps";

/*
 * P5 bookings and the round-2 desk pass: the desk journeys, counted on the desk fixture
 * (booking-desk-fixture.tsx) at iPad landscape and phone size. Targets are from
 * the regression assertions below and docs/guides/admin-ux.md; counts are taps from the page where
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

test("replaces a pending villa calendar response when the filter changes", async ({ page }) => {
  await page.setViewportSize(DESK_VIEWPORTS.ipad);
  await page.addInitScript(() => localStorage.setItem("admin.hotel.villa", "removed-villa"));
  await openDesk(page, "?holdVilla=fxvilla000001");
  const picker = page.getByRole("button", { name: /^Villa:/ });
  await expect(picker).toContainText("All villas");
  await expect(chip(page, "Anna Schmidt")).toBeVisible();
  await expect(chip(page, "Maya Lin")).toBeVisible();

  await picker.click();
  await page.getByRole("option", { name: /Lagoon Pool Villa/ }).click();
  await expect(page.getByRole("status", { name: "Loading bookings" })).toBeVisible();
  await expect(chip(page, "Maya Lin")).toHaveCount(0);
  await picker.click();
  await page.getByRole("option", { name: /Garden Villa/ }).click();
  await expect(chip(page, "Maya Lin")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("fixture-release-villa")));
  await expect(chip(page, "Maya Lin")).toBeVisible();
  await expect(chip(page, "Anna Schmidt")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Today" }).getByRole("button", { name: /Arriving/ })).toContainText("2");
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
      await expect(page.getByRole("menu", { name: "More stay actions" }).getByRole("menuitem")).toHaveText(["Record payment…", "Copy reference", "Cancel stay"]);
    });

    test("already paid from the calendar: 4 taps, its own dialog, same revision and one attempt key", async ({ page }) => {
      await openDesk(page);
      const t = new Taps(page);
      await t.tap(chip(page, "Maya Lin"), "Maya's stay");
      await t.tap(popover(page, "Maya Lin").getByRole("button", { name: "More stay actions" }), "⋯");
      await t.tap(page.getByRole("menuitem", { name: "Record payment…" }), "Record payment…");
      // The dialog opens on the calendar, not inside the stay sheet.
      const dialog = page.getByRole("dialog", { name: "Record a payment taken elsewhere" });
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
      expect(payment.args).toMatchObject({ bookingId: "fxbkg000003", expectedRevision: 1, expectedAmount: 850000, method: "cash" });
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

    test("Today strip: four compact columns, nothing clipped", async ({ page }) => {
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
      expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
    });

    test("hotel toolbar shares navigation; villa, search and cancelled tools stay reachable", async ({ page }) => {
      await openDesk(page);
      const toolbar = page.getByTestId("calendar-toolbar");
      if (size === "phone") {
        await expect(page.locator('[data-slot="event-calendar-agenda-view"]')).toBeVisible();
        await expect(toolbar.getByRole("combobox", { name: "Calendar view" })).toBeVisible();
        await toolbar.getByRole("button", { name: "Search bookings", exact: true }).click();
        await expect(page.getByRole("searchbox", { name: "Search bookings" })).toBeFocused();
        await page.keyboard.press("Escape");
      } else {
        await expect(toolbar.getByRole("button", { name: "Today", exact: true })).toBeVisible();
        await toolbar.getByRole("searchbox", { name: "Search bookings", exact: true }).click();
        await expect(toolbar.getByRole("searchbox", { name: "Search bookings" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(toolbar.getByRole("radio", { name: "Month", exact: true })).toHaveAttribute("data-state", "on");
      }
      await page.getByRole("button", { name: "More calendar tools" }).click();
      const menu = page.getByRole("menu", { name: "More calendar tools" });
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
      const checkoutOrder = size === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
      await t.tap(checkoutOrder.getByRole("button", { name: /^Cash ฿[\d,.]+$/, exact: true }), "Cash");
      await t.tap(page.getByRole("button", { name: /^Confirm cash · ฿[\d,.]+ received/ }), "Confirm cash");
      await t.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      await expect(page.locator("body")).toHaveAttribute("data-printed", "1");
      await expect(page.getByRole("article", { name: "Receipt", includeHidden: true })).toContainText("27,500");
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
      await expect(money.locator("button:not([data-info-tip])")).toHaveText(["Take payment", "Record external payment…"]);
      for (const action of await money.locator("button:not([data-info-tip])").all()) {
        const actionBox = (await action.boundingBox())!;
        const moneyBox = (await money.boundingBox())!;
        expect(actionBox.x).toBeGreaterThanOrEqual(moneyBox.x);
        expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(moneyBox.x + moneyBox.width);
      }
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
      await money.getByRole("button", { name: "Record external payment…" }).click();
      const paid = page.getByRole("dialog", { name: "Record a payment taken elsewhere" });
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
      // Header Edit and Close are icon actions; the payment and status actions keep their hierarchy.
      const buttons = sheet.locator('button:visible:not([aria-label="Close"]):not([aria-label="Edit appointment"]):not([data-info-tip])').filter({ hasNotText: /^(Record external payment…|Take payment)$/ });
      const take = sheet.getByRole("button", { name: "Take payment", exact: true });
      await expect(take).toBeEnabled();
      await expect(buttons).toHaveText(["Mark arrived", "", "Open stay · Ocean Suite · until Sat 14 Nov"]);
      await expect(sheet.getByRole("button", { name: "Edit appointment" })).toBeVisible();
      expect((await buttons.count()) + (await take.count())).toBe(4);
      // While a balance is due, Take payment is the one filled button.
      await expect(take).toHaveClass(/bg-primary/);
      await expect(sheet.getByRole("button", { name: "Mark arrived" })).not.toHaveClass(/bg-primary/);
      await expect(sheet.locator("dt", { hasText: /^Payment$/ })).toHaveCount(0);
      await expect(sheet).not.toContainText("SVC-0007");
      await expectAtMostSentences(sheet, 1);
      await sheet.getByRole("button", { name: "More appointment actions" }).click();
      const menu = page.getByRole("menu", { name: "More appointment actions" });
      await expect(menu.getByRole("menuitem")).toHaveText(["Start service", "Complete", "No-show", "Fix time, turnaround or status…", "Copy reference", "Cancel appointment"]);
      await menu.getByRole("menuitem", { name: "Fix time, turnaround or status…" }).click();
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
      expect(await inView(dialog.getByText("Total ฿36,000"))).toBe(true);
      const checkIn = await dialog.getByTestId("booking-check-in").boundingBox();
      const checkOut = await dialog.getByTestId("booking-check-out").boundingBox();
      expect(checkIn!.y).toBe(checkOut!.y);
      await expect(dialog).toContainText("3 nights");
      if (size === "ipad") {
        // The two Price fields fit together on iPad without clipping the coupon input.
        expect(await inView(dialog.getByLabel("Coupon code"))).toBe(true);
        await dialog.getByLabel("Coupon code").scrollIntoViewIfNeeded();
        expect(await inView(dialog.getByRole("button", { name: "Create booking" }))).toBe(true);
      }
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
  await page.getByRole("radio", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("group", { name: "Status" }).getByRole("checkbox", { name: "Completed" }).uncheck();
  await page.getByRole("checkbox", { name: "Show cancelled" }).check();
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByRole("radio", { name: "Week", exact: true })).toHaveAttribute("data-state", "on");
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("checkbox", { name: "Show cancelled" })).toBeChecked();
  await expect(page.getByRole("group", { name: "Status" }).getByRole("checkbox", { name: "Completed" })).not.toBeChecked();
});

for (const [size, viewport] of Object.entries(DESK_VIEWPORTS)) {
  test.describe(`round 1 ${size}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    test("agendas are the phone default and explicit view choices survive reload", async ({ page }) => {
      await openDesk(page);
      await expect(page.locator(`[data-slot=event-calendar-${size === "phone" ? "agenda" : "month"}-view]`)).toBeVisible();
      if (size === "phone") {
        await page.getByRole("combobox", { name: "Calendar view" }).click();
        await page.getByRole("option", { name: "Month", exact: true }).click();
        await page.reload();
        await expect(page.locator('[data-slot="event-calendar-month-view"]')).toBeVisible();
      }
      await openDesk(page, "?view=staff");
      await expect(page.locator(`[data-slot=event-calendar-${size === "phone" ? "agenda-view" : "resource-view"}]`)).toBeVisible();
    });
    test("stay notes survive Keep editing on every sheet close route", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Anna Schmidt").click();
      await page.getByRole("button", { name: "Details", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Anna Schmidt", exact: true });
      await sheet.getByLabel("Notes (staff only)").fill("Please keep this unsaved note");
      for (const close of [() => sheet.getByRole("button", { name: "Close", exact: true }).click(), () => page.keyboard.press("Escape"), ...(size === "ipad" ? [() => page.mouse.click(10, 10)] : [])]) {
        await close();
        const guard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
        await expect(guard).toBeVisible();
        await guard.getByRole("button", { name: "Keep editing", exact: true }).click();
        await expect(sheet.getByLabel("Notes (staff only)")).toHaveValue("Please keep this unsaved note");
      }
      expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
      await page.keyboard.press("Escape");
      await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      expect((await calls(page)).filter(call => call.name === "updateNotes")).toHaveLength(0);
    });
    test("appointment details survive a cancelled close and discard without writing", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await chip(page, "Ken Tanaka").click();
      const sheet = page.getByRole("dialog", { name: /Appointment · Ken Tanaka/ });
      await sheet.getByRole("button", { name: "Edit appointment", exact: true }).click();
      await sheet.getByLabel("Notes (optional)").fill("Unsaved pressure preference");
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(sheet.getByLabel("Notes (optional)")).toHaveValue("Unsaved pressure preference");
      await sheet.getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
      await expect(sheet.getByRole("button", { name: "Edit appointment", exact: true })).toBeEnabled();
      expect((await calls(page)).filter(call => call.name === "updateAppointmentDetails")).toHaveLength(0);
    });
  });
}

test("new booking explains disabled Create and focuses an incomplete phone number", async ({ page }) => {
  await page.setViewportSize(DESK_VIEWPORTS.phone);
  await openDesk(page);
  await page.getByRole("button", { name: "New booking", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New booking", exact: true });
  await expect(dialog.getByRole("button", { name: "Create booking", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Choose check-in and check-out dates.")).toBeVisible();
  await page.getByTestId("booking-check-in").click();
  await page.locator('[data-day="2026-11-20"] button').click();
  await page.locator('[data-day="2026-11-23"] button').click();
  await dialog.getByLabel("Guest name", { exact: true }).fill("New Guest");
  await dialog.getByLabel("Phone", { exact: true }).fill("081");
  await dialog.getByRole("button", { name: "Create booking", exact: true }).click();
  await expect(dialog.getByText("Enter a complete phone number for the selected country.")).toBeVisible();
  await expect(dialog.getByLabel("Phone", { exact: true })).toBeFocused();
  expect((await calls(page)).filter(call => call.name === "createBooking")).toHaveLength(0);
});

test("phone agenda rows expose their visible balance and appointment status to assistive technology", async ({ page }) => {
  await page.setViewportSize(DESK_VIEWPORTS.phone);
  await openDesk(page);
  await expect(page.getByRole("button", { name: /Anna Schmidt.*฿26,000/ }).first()).toBeVisible();
  await openDesk(page, "?view=staff");
  await expect(page.getByRole("button", { name: /Ken Tanaka.*09:50–10:50.*Booked/ }).first()).toBeVisible();
});

test.describe("phone agenda touch scrolling", () => {
  test.use({ viewport: DESK_VIEWPORTS.phone, hasTouch: true, isMobile: true });
  test("a finger can scroll from a guest row without starting a drag", async ({ page, context }) => {
    await openDesk(page);
    const agenda = page.locator('[data-slot="event-calendar-agenda-view"]');
    await expect(agenda.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0);
    const row = agenda.locator('[data-slot="event-calendar-event"]').first();
    const box = (await row.boundingBox())!;
    const touch = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 18 }] });
      await page.waitForTimeout(16);
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(60);
    expect(await calls(page)).toHaveLength(0);
    await openDesk(page, "?view=staff");
    await expect(page.locator('[data-slot="event-calendar-event"]').first()).toHaveCSS("touch-action", "pan-y");
  });
});
