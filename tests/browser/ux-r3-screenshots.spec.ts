import { test, type Page } from "@playwright/test";
import { DESK_NOW, openDesk } from "./helpers/desk-taps";

/*
 * After screenshots for round 3 (one date format, one disclosure, one success toast), written to
 * docs/screenshots/ux-r3/. Skipped in the normal run; capture with:
 *   CAPTURE_UX_R3=1 BOOKING_UI_PORT=4365 pnpm exec playwright test -c playwright.booking.config.ts ux-r3-screenshots
 */
test.skip(!process.env.CAPTURE_UX_R3, "Set CAPTURE_UX_R3=1 to capture screenshots.");
test.use({ timezoneId: "Asia/Bangkok" });

const DIR = "docs/screenshots/ux-r3";
const SIZES = { ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } } as const;

const shot = async (page: Page, name: string) => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}.png` });
};
const ready = async (page: Page, url: string) => {
  await page.clock.setFixedTime(DESK_NOW);
  await page.goto(url);
  await page.locator("[data-fixture-ready]").waitFor();
};

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(size, () => {
    test.use({ viewport });

    test("dates: the stay sheet's History", async ({ page }) => {
      await openDesk(page);
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Anna Schmidt" }).first().click();
      await page.getByRole("button", { name: "Details" }).click();
      const sheet = page.getByRole("dialog", { name: "Anna Schmidt" });
      await sheet.locator("summary", { hasText: "History" }).click();
      await sheet.getByRole("heading", { name: "Payments and refunds" }).scrollIntoViewIfNeeded();
      await shot(page, `after-stay-history-dates-${size}`);
    });

    test("dates: the staff calendar on a 24-hour clock", async ({ page }) => {
      await openDesk(page, "?view=staff");
      await shot(page, `after-staff-calendar-24h-${size}`);
    });

    test("dates: chat details", async ({ page }) => {
      await ready(page, "/tests/browser/chats.html?path=/admin/chats");
      if (size === "phone") await page.getByRole("button", { name: /Anna Müller/ }).first().click();
      await page.getByRole("button", { name: "Chat details" }).click();
      const sheet = page.getByRole("dialog", { name: "Chat details" });
      await sheet.locator("summary", { hasText: "More · technical" }).click();
      await shot(page, `after-chat-details-${size}`);
    });

    test("disclosure: the coupon editor's More", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await ready(page, "/tests/browser/marketing-coupon.html");
      await shot(page, `after-coupon-more-closed-${size}`);
      const more = page.locator("summary", { hasText: "More · campaign" });
      await more.click();
      await more.scrollIntoViewIfNeeded();
      await shot(page, `after-coupon-more-open-${size}`);
    });

    test("toast: resolve a missing-information report, with Undo", async ({ page }) => {
      await ready(page, "/tests/browser/questions.html?path=/admin/questions");
      await page.getByRole("combobox", { name: 'Resolve "Is breakfast included?" with a fact or source' }).click();
      await page.getByRole("option", { name: "Breakfast is included" }).click();
      await page.getByTestId("toast").getByRole("button", { name: "Undo" }).waitFor();
      await shot(page, `after-toast-undo-${size}`);
    });

    test("toast: a spa booked from the stay", async ({ page }) => {
      await openDesk(page);
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Maya Lin" }).first().click();
      await page.getByRole("button", { name: "Book spa" }).click();
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await dialog.getByRole("button", { name: /^Hot stone 60/ }).click();
      await dialog.getByRole("button", { name: "15:00", exact: true }).click();
      await dialog.getByRole("button", { name: /^Book Hot stone 60/ }).click();
      await page.getByTestId("toast").getByText("Maya Lin: spa booked").waitFor();
      await shot(page, `after-toast-spa-booked-${size}`);
    });
  });
}
