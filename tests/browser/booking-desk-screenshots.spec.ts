import { test, type Page } from "@playwright/test";
import { DESK_VIEWPORTS, openDesk } from "./helpers/desk-taps";

/*
 * After screenshots for P5 bookings, written to docs/screenshots/ux-p5/ next to the before ones.
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_P5=1 BOOKING_UI_PORT=4351 pnpm exec playwright test -c playwright.booking.config.ts booking-desk-screenshots
 */
test.skip(!process.env.CAPTURE_UX_P5, "Set CAPTURE_UX_P5=1 to capture screenshots.");
test.use({ timezoneId: "Asia/Bangkok" });

const DIR = "docs/screenshots/ux-p5";
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

    test("hotel calendar, Today strip, popover, stay sheet", async ({ page }) => {
      await openDesk(page);
      await shot(page, "hotel");
      await page.getByRole("region", { name: "Today" }).getByRole("button", { name: /Arriving/ }).click();
      await shot(page, "today-arriving");
      await page.getByRole("region", { name: "Today" }).getByRole("button", { name: /Arriving/ }).click();
      await chip(page, "Anna Schmidt").click();
      await page.getByRole("button", { name: /^Take payment ฿/ }).waitFor();
      await shot(page, "popover");
      await page.getByRole("button", { name: "Details" }).click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
      await shot(page, "stay-sheet");
    });

    test("record payment and book spa from the popover", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Maya Lin").click();
      await page.getByRole("button", { name: "More stay actions" }).click();
      await page.getByRole("menuitem", { name: "Record payment…" }).click();
      await page.getByRole("dialog", { name: "Record a payment taken elsewhere" }).waitFor();
      await shot(page, "record-payment");
      await page.keyboard.press("Escape");
      await chip(page, "Maya Lin").click();
      await page.getByRole("button", { name: "Book spa" }).click();
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await dialog.getByRole("button", { name: /^Hot stone 60/ }).click();
      await shot(page, "book-spa");
    });

    test("staff calendar and appointment sheet", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await shot(page, "staff-calendar");
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" }).first().click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
      await shot(page, "appointment-sheet");
      await page.getByRole("button", { name: "More appointment actions" }).click();
      await shot(page, "appointment-more");
    });

    test("new booking", async ({ page }) => {
      await openDesk(page);
      await page.getByRole("button", { name: "New booking" }).click();
      await page.getByTestId("booking-check-in").click();
      await page.locator(`[data-day="2026-11-20"] button`).click();
      await page.locator(`[data-day="2026-11-23"] button`).click();
      await page.getByText("Total ฿36,000").waitFor();
      await shot(page, "new-booking");
    });

    test("guest leaves: checkout with the stay and its spa", async ({ page }) => {
      await openDesk(page);
      await chip(page, "Anna Schmidt").click();
      await page.getByRole("button", { name: "Take payment ฿27,500" }).click();
      await page.locator("[data-route=order]").waitFor();
      if (size === "phone") await page.getByRole("button", { name: /^View order/ }).click();
      await page.getByText("Hot stone 60").first().waitFor();
      await shot(page, "checkout-stay-and-spa");
    });
  });
}
