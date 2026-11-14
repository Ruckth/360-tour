import { test, type Locator, type Page } from "@playwright/test";
import { UX_VIEWPORTS, controlsOnScreen } from "./helpers/ux-census";

/*
 * Before and after screenshots for P3 · Pay panel, in docs/screenshots/ux-p3/.
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_P3=after pnpm exec playwright test -c playwright.booking.config.ts ux-p3-screenshots
 * The before set was taken the same way on ux/integration (CAPTURE_UX_P3=before).
 */
const phase = process.env.CAPTURE_UX_P3;
test.skip(!phase, "Set CAPTURE_UX_P3=before|after to capture screenshots.");

const DIR = "docs/screenshots/ux-p3";

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(400);
}

async function orderPanel(page: Page, size: string): Promise<Locator> {
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

    await open(page, "?role=cashier&scenario=spa");
    let panel = await orderPanel(page, size);
    await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
    await page.waitForTimeout(300);
    const cash = phase === "after" ? panel.getByRole("group", { name: "Cash payment" }) : panel;
    counts.cashPanel = await controlsOnScreen(page, cash);
    await shot("cash");

    if (phase === "after") await panel.getByRole("button", { name: "฿1,500", exact: true }).click();
    else await panel.getByLabel("Cash received").fill("1500");
    await page.waitForTimeout(200);
    await shot("cash-1500");

    await open(page, "?role=cashier&scenario=spa");
    panel = await orderPanel(page, size);
    await panel.getByRole("button", { name: "Split payment", exact: true }).click();
    await page.waitForTimeout(300);
    await panel.getByLabel("Payment 1 amount").fill("500");
    await page.waitForTimeout(200);
    await shot("split");

    console.log(`[ux-p3 ${phase} ${size}] controls: ${JSON.stringify(counts)}`);
  });
}
