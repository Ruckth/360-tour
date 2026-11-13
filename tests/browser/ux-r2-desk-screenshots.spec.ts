import { test, type Page } from "@playwright/test";
import { DESK_VIEWPORTS, openDesk } from "./helpers/desk-taps";

/*
 * After screenshots for the round-2 desk pass, written to docs/screenshots/ux-r2-desk/. The
 * before shots are the final audit's (docs/reviews/ux-audit/final-screens on ux/final-audit).
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_R2_DESK=1 BOOKING_UI_PORT=4363 pnpm exec playwright test -c playwright.booking.config.ts ux-r2-desk-screenshots
 */
test.skip(!process.env.CAPTURE_UX_R2_DESK, "Set CAPTURE_UX_R2_DESK=1 to capture screenshots.");
test.use({ timezoneId: "Asia/Bangkok" });

const DIR = "docs/screenshots/ux-r2-desk";
const chip = (page: Page, guest: string) => page.locator("[data-slot=event-calendar-event]", { hasText: guest }).first();

for (const [size, viewport] of Object.entries(DESK_VIEWPORTS)) {
  test.describe(size, () => {
    test.use({ viewport });
    // Let button colour transitions finish before each shot.
    const shot = async (page: Page, name: string) => {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${DIR}/after-${name}-${size}.png` });
    };

    test("hotel calendar, toolbar, Today strip", async ({ page }) => {
      await openDesk(page);
      await shot(page, "hotel");
      await page.getByRole("button", { name: "More calendar tools" }).click();
      await shot(page, "hotel-more");
      await page.keyboard.press("Escape");
      await page.getByTestId("calendar-toolbar").locator("[data-slot=event-calendar-date-picker]").click();
      await shot(page, "month-picker-today");
      await page.keyboard.press("Escape");
      if (size === "phone") {
        await page.getByRole("button", { name: "Search bookings" }).click();
        await shot(page, "search-open");
        await page.keyboard.press("Escape");
      }
      await page.getByRole("region", { name: "Today" }).getByRole("button", { name: /Arriving/ }).click();
      await shot(page, "today-arriving");
    });

    test("stay popover, its ⋯, stay sheet and Already paid", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Anna Schmidt").click();
      await page.getByRole("button", { name: /^Take payment ฿/ }).waitFor();
      await shot(page, "popover");
      await page.getByRole("button", { name: "More stay actions" }).click();
      await shot(page, "popover-more");
      await page.getByRole("menuitem", { name: "Already paid…" }).click();
      await page.getByRole("dialog", { name: "Already paid" }).waitFor();
      await shot(page, "already-paid");
      await page.keyboard.press("Escape");
      await chip(page, "Anna Schmidt").click();
      await page.getByRole("button", { name: "Details" }).click();
      const sheet = page.getByRole("dialog", { name: "Anna Schmidt" });
      await sheet.getByRole("region", { name: "Balance due" }).waitFor();
      await shot(page, "stay-sheet");
      await sheet.locator("summary", { hasText: "History" }).click();
      await sheet.getByRole("heading", { name: "Payments and refunds" }).scrollIntoViewIfNeeded();
      await shot(page, "stay-history");
    });

    test("book spa: chips, Other time…", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Maya Lin").click();
      await page.getByRole("button", { name: "Book spa" }).click();
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await dialog.getByRole("button", { name: /^Hot stone 60/ }).click();
      await shot(page, "book-spa");
      await dialog.getByRole("button", { name: "Other time…" }).click();
      await shot(page, "book-spa-other-time");
    });

    test("new appointment, appointment sheet, ⋯ and Correct…", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await page.getByRole("button", { name: "New appointment" }).click();
      await page.getByRole("dialog", { name: "New appointment" }).getByRole("button", { name: "Other time…" }).waitFor();
      await shot(page, "new-appointment");
      await page.keyboard.press("Escape");
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" }).first().click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
      await shot(page, "appointment-sheet");
      await page.getByRole("button", { name: "More appointment actions" }).click();
      await shot(page, "appointment-more");
      await page.getByRole("menuitem", { name: "Correct…" }).click();
      await page.getByRole("dialog", { name: "Correct" }).waitFor();
      await shot(page, "appointment-correct");
    });

    test("new booking", async ({ page }) => {
      await openDesk(page);
      await page.getByRole("button", { name: "New booking" }).click();
      await page.getByTestId("booking-check-in").click();
      await shot(page, "new-booking-dates");
      await page.locator(`[data-day="2026-11-20"] button`).click();
      await page.locator(`[data-day="2026-11-23"] button`).click();
      await page.getByText("Total ฿36,000").waitFor();
      await shot(page, "new-booking");
    });
  });
}
