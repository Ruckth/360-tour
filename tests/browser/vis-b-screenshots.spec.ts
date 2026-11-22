import { test, expect, type Page } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";

// CAPTURE_VIS_B=1 BOOKING_UI_PORT=4372 bun run playwright test -c playwright.booking.config.ts vis-b-screenshots --workers=1
// Package B only. The original archives are never written by this spec.
test.skip(
  process.env.CAPTURE_VIS_B !== "1",
  "Set CAPTURE_VIS_B=1 to capture current screens.",
);
test.use({ colorScheme: "light", timezoneId: "Asia/Bangkok" });
const sizes = {
  ipad: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
};
async function open(page: Page, fixture: string, query = "") {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
async function shot(page: Page, name: string, fullPage = false) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `docs/screenshots/vis-b/${name}.png`,
    fullPage,
    animations: "disabled",
  });
}
async function scene(page: Page, name: string, phone: boolean) {
  if (
    [
      "hotel-calendar",
      "stay-sheet",
      "appointment-sheet",
      "new-booking",
    ].includes(name)
  ) {
    await openDesk(
      page,
      ["staff-calendar", "appointment-sheet"].includes(name)
        ? "?view=staff"
        : "",
    );
    if (name === "stay-sheet") {
      await page
        .locator("[data-slot=event-calendar-event]", {
          hasText: "Anna Schmidt",
        })
        .first()
        .click();
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
    }
    if (name === "appointment-sheet") {
      await page
        .locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" })
        .first()
        .click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
    }
    if (name === "new-booking") {
      await page
        .getByRole("button", { name: "New booking", exact: true })
        .click();
      await page.getByTestId("booking-check-in").click();
      await page.locator('[data-day="2026-11-20"] button').click();
      await page.locator('[data-day="2026-11-23"] button').click();
      await expect(page.getByText("Total ฿36,000")).toBeVisible();
    }
  } else if (name === "chats") {
    await open(page, "chats", "?path=/admin/chats");
    if (phone)
      await page
        .getByRole("button", { name: /Anna Müller/ })
        .first()
        .click();
  } else if (name === "missing-information")
    await open(page, "questions", "?path=/admin/questions");
}
// These states and fixture actions match now-screenshots.spec.ts.
for (const [size, viewport] of Object.entries(sizes))
  for (const state of [
    "new-booking",
    "stay-sheet",
    "appointment-sheet",
    "hotel-calendar",
    "chats",
    "missing-information",
  ]) {
    test(`${state}-${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await scene(page, state, size === "phone");
      await shot(page, `${state}-${size}`);
    });
  }
test("missing-information-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await scene(page, "missing-information", false);
  await shot(page, "missing-information-desktop");
});
