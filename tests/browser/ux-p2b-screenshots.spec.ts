import { test, type Page } from "@playwright/test";
import { UX_VIEWPORTS } from "./helpers/ux-census";

/*
 * Before and after screenshots for P2b · Open orders, in docs/screenshots/ux-p2b/. Skipped in the
 * normal run; capture with:
 *   CAPTURE_UX_P2B=after pnpm exec playwright test -c playwright.booking.config.ts ux-p2b-screenshots
 * The before set was taken the same way on ux/integration (CAPTURE_UX_P2B=before).
 */
const phase = process.env.CAPTURE_UX_P2B;
test.skip(!phase, "Set CAPTURE_UX_P2B=before|after to capture screenshots.");

const DIR = "docs/screenshots/ux-p2b";

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(400);
}

for (const [size, viewport] of Object.entries(UX_VIEWPORTS)) {
  test(`${phase} ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${phase}-${size}-${name}.png` });

    // The order panel's header: Save & close before, gone after.
    await open(page, "?role=cashier&scenario=spa");
    if (size === "phone") {
      await page.getByRole("button", { name: /open the order/ }).click();
      await page.waitForTimeout(400);
    }
    await shot("order");

    // A cashier's Orders: the number field before, the open orders list after.
    await open(page, "?role=cashier&scenario=spa");
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    await shot("orders");
  });
}
