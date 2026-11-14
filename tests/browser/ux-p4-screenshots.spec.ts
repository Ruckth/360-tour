import { test, type Page } from "@playwright/test";
import { receiptCensus } from "./helpers/receipt-census";
import { UX_VIEWPORTS } from "./helpers/ux-census";

/*
 * Before and after screenshots for P4 · Receipt, in docs/screenshots/ux-p4/.
 * Skipped in the normal run; capture with:
 *   CAPTURE_UX_P4=after pnpm exec playwright test -c playwright.booking.config.ts ux-p4-screenshots
 * The before set was taken the same way on ux/integration (CAPTURE_UX_P4=before).
 */
const phase = process.env.CAPTURE_UX_P4;
test.skip(!phase, "Set CAPTURE_UX_P4=before|after to capture screenshots.");

const DIR = "docs/screenshots/ux-p4";

async function open(page: Page, query: string, fixture = "staff-roles") {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.getByRole("article", { name: "Receipt" }).waitFor();
  await page.waitForTimeout(400);
}

/** ⋯ then an item, after P4; the old button before it. */
async function receiptAction(page: Page, before: string, after: string) {
  if (phase === "before") await page.getByRole("button", { name: before, exact: true }).first().click();
  else {
    await page.getByRole("button", { name: "More receipt actions" }).click();
    await page.getByRole("menuitem", { name: after }).click();
  }
  await page.waitForTimeout(400);
}

for (const [size, viewport] of Object.entries(UX_VIEWPORTS)) {
  test(`${phase} ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${phase}-${size}-${name}.png` });
    const counts: Record<string, unknown> = {};

    for (const role of ["manager", "cashier"] as const) {
      await open(page, `?role=${role}&scenario=refund`);
      counts[role] = await receiptCensus(page);
      await shot(`${role}-receipt`);

      await page.getByTestId("receipt-items").getByRole("button", { name: "Refund Foot spa 45" }).click();
      await page.waitForTimeout(400);
      await shot(`${role}-refund`);
    }

    await open(page, "?role=manager&scenario=refund");
    await receiptAction(page, "Correct payment recording", "Correct payment");
    await shot("manager-correct");

    await open(page, "?role=manager&scenario=refund");
    await receiptAction(page, "Void…", "Void…");
    await shot("manager-void");

    await open(page, "?scenario=unscheduled-paid", "checkout");
    await shot("manager-link-receipt");
    await page.getByRole("button", { name: "Link appointment" }).click();
    await page.waitForTimeout(400);
    await shot("manager-link");

    console.log(`[ux-p4 ${phase} ${size}] ${JSON.stringify(counts)}`);
  });
}
