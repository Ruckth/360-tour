import { test, type Page } from "@playwright/test";

/*
 * Before/after screenshots for P7 (Settings and Team), written to docs/screenshots/ux-p7/.
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_P7=after pnpm exec playwright test -c playwright.booking.config.ts ux-p7-screenshots
 */
const phase = process.env.CAPTURE_UX_P7;
test.skip(!phase, "Set CAPTURE_UX_P7=before|after to capture screenshots.");

const DIR = "docs/screenshots/ux-p7";
const SIZES = { desktop: { width: 1280, height: 950 }, phone: { width: 390, height: 844 } } as const;

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(150);
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(size, () => {
    test.use({ viewport });
    const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${phase}-${name}-${size}.png`, fullPage: true });

    test("team", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      // Viewport shots: a full-page capture leaves the sticky Save where the first screen ended.
      await page.screenshot({ path: `${DIR}/${phase}-team-${size}.png` });
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.screenshot({ path: `${DIR}/${phase}-team-rules-${size}.png` });
    });

    test("business", async ({ page }) => {
      await open(page, "?view=settings&tab=business");
      await shot(page, "business");
    });

    test("channels", async ({ page }) => {
      await open(page, "?view=settings&tab=channels");
      await shot(page, "channels");
    });

    test("manager read only", async ({ page }) => {
      await open(page, "?view=settings&role=manager&tab=business");
      await shot(page, "manager-read-only");
    });

    test("marketing access", async ({ page }) => {
      test.skip(phase !== "before", "Marketing › Access is gone after P7; its roles are on Team.");
      await open(page, "?view=marketing-access");
      await shot(page, "marketing-access");
    });
  });
}
