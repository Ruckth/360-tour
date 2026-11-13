import { test, type Page } from "@playwright/test";
import { UX_VIEWPORTS, controlsOnScreen } from "./helpers/ux-census";

/*
 * Before and after screenshots for P2 · Order panel and catalog, in docs/screenshots/ux-p2/.
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_P2=after pnpm exec playwright test -c playwright.booking.config.ts ux-p2-screenshots
 * The before set was taken the same way on ux/integration (CAPTURE_UX_P2=before), which has only
 * the scenes both versions share.
 */
const phase = process.env.CAPTURE_UX_P2;
test.skip(!phase, "Set CAPTURE_UX_P2=before|after to capture screenshots.");

const DIR = "docs/screenshots/ux-p2";

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(400);
}

async function orderPanel(page: Page, size: string) {
  if (size === "ipad") return page.getByRole("complementary", { name: "Order", exact: true });
  await page.getByRole("button", { name: /open the order/ }).click();
  await page.waitForTimeout(400);
  return page.getByRole("dialog");
}

for (const [size, viewport] of Object.entries(UX_VIEWPORTS)) {
  test(`${phase} ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${phase}-${size}-${name}.png` });
    const counts: Record<string, number> = {};

    await open(page, "?role=cashier");
    counts.start = await controlsOnScreen(page);
    await shot("start");

    await page.getByRole("tab", { name: "Spa", exact: true }).click();
    await page.getByRole("searchbox").fill("Coconut");
    await page.waitForTimeout(200);
    await shot("search-other-tab");

    await open(page, "?role=cashier&scenario=spa");
    const panel = await orderPanel(page, size);
    await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
    await page.waitForTimeout(400);
    counts.lineOpen = await controlsOnScreen(page);
    await shot("line-open");

    if (phase === "after") {
      await panel.getByRole("textbox", { name: "Discount" }).fill("15%");
      await page.waitForTimeout(200);
      await shot("over-limit");
      await panel.getByRole("button", { name: "Guest complaint" }).click();
      await panel.getByRole("button", { name: /^Send 15% \(฿180\) to manager$/ }).click();
      await panel.locator('[data-approval-status="pending"]').first().waitFor();
      await page.waitForTimeout(300);
      await shot("waiting");
    }

    await open(page, "?role=manager&scenario=spa");
    if (size === "phone") await orderPanel(page, size);
    const customer = page.getByRole("button", { name: /^Add customer$/ }).first();
    if (size === "phone") await page.keyboard.press("Escape");
    await customer.click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Search customers" }).fill("Anna");
    await page.waitForTimeout(400);
    await shot("customer");

    console.log(`[ux-p2 ${phase} ${size}] controls on screen: ${JSON.stringify(counts)}`);
  });
}
