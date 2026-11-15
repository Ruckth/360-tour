import { test, expect } from "@playwright/test";

// CAPTURE_VIS_C=1 BOOKING_UI_PORT=4373 pnpm exec playwright test -c playwright.booking.config.ts vis-c-screenshots --workers=1
// Same fixtures, states and light-mode viewports as docs/screenshots/now/README.md.
test.skip(process.env.CAPTURE_VIS_C !== "1", "Set CAPTURE_VIS_C=1 to capture Package C.");
test.use({ colorScheme: "light", timezoneId: "Asia/Bangkok" });
const scenes = [
  { name: "business-desktop", fixture: "staff-roles?view=settings&tab=business", width: 1280, height: 950, fullPage: true },
  { name: "business-phone", fixture: "staff-roles?view=settings&tab=business", width: 390, height: 844, fullPage: false },
  { name: "team-phone", fixture: "staff-roles?view=settings&tab=team", width: 390, height: 844, fullPage: false },
  { name: "team-ipad", fixture: "staff-roles?view=settings&tab=team", width: 1180, height: 820, fullPage: false },
  { name: "new-coupon-phone", fixture: "marketing-coupon", width: 390, height: 844, fullPage: true },
  { name: "new-coupon-ipad", fixture: "marketing-coupon", width: 1180, height: 820, fullPage: false },
  { name: "marketing-dashboard-desktop", fixture: "marketing-dashboard", width: 1440, height: 900, fullPage: false },
  { name: "marketing-dashboard-phone", fixture: "marketing-dashboard", width: 390, height: 844, fullPage: false },
];
for (const scene of scenes) test(scene.name, async ({ page }) => {
  await page.setViewportSize({ width: scene.width, height: scene.height });
  const [fixture, query] = scene.fixture.split("?");
  await page.goto(`/tests/browser/${fixture}.html${query ? `?${query}` : ""}`);
  if (fixture === "marketing-dashboard") await page.getByRole("heading", { name: "Marketing dashboard" }).waitFor({ state: "attached" });
  else await page.locator("[data-fixture-ready]").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(scene.width);
  await page.screenshot({ path: `docs/screenshots/vis-c/${scene.name}.png`, fullPage: scene.fullPage, animations: "disabled" });
  if (scene.name === "business-desktop") {
    await page.getByRole("button", { name: /^Check-in time,/ }).click();
    await page.screenshot({ path: "docs/screenshots/vis-c/business-time-picker-desktop.png", animations: "disabled" });
    await page.getByRole("combobox", { name: "Check-in time hour", exact: true }).click();
    await page.getByRole("option", { name: "15", exact: true }).click();
    await page.getByRole("combobox", { name: "Check-in time minute", exact: true }).click();
    await page.getByRole("option", { name: "30", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check-in time, 15:30", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  }
  // Supplement the comparison states with the summary and dirty bars that are conditional.
  if (scene.name === "new-coupon-phone") {
    await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
    await page.getByRole("region", { name: "Summary", exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.screenshot({ path: "docs/screenshots/vis-c/coupon-summary-phone.png", animations: "disabled" });
  }
  if (scene.name === "team-phone") {
    await page.getByRole("textbox", { name: "Discount without approval" }).fill("15");
    await page.screenshot({ path: "docs/screenshots/vis-c/team-dirty-phone.png", animations: "disabled" });
  }
});
