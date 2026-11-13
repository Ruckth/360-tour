import { test, type Page } from "@playwright/test";

/*
 * After screenshots for P1 · Shell and approvals, written to docs/screenshots/ux-p1/ next to the
 * before set (taken on ux/base). Skipped in the normal run; capture with:
 *   CAPTURE_UX_P1=1 pnpm exec playwright test -c playwright.booking.config.ts ux-p1-screenshots
 */
test.skip(!process.env.CAPTURE_UX_P1, "Set CAPTURE_UX_P1=1 to capture screenshots.");

const DIR = "docs/screenshots/ux-p1";
const SIZES = { ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } } as const;

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/admin-shell.html${query}`);
  await page.locator("header h1").waitFor();
  await page.waitForTimeout(300);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`after ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "?role=manager&path=/admin/chats&pending=1");
    await page.getByRole("textbox", { name: "Type an admin reply" }).fill("Yes, 10:00 tomorrow works. Shall I book it?");
    await shot(page, `after-${size}-manager-chats`);
    await page.getByTestId("approvals-button").click();
    await page.waitForTimeout(300);
    await shot(page, `after-${size}-manager-approvals`);
    await page.getByRole("dialog", { name: "Approvals" }).getByRole("button", { name: "Approve" }).click();
    await page.getByTestId("toast").getByText("Approved").waitFor();
    await page.waitForTimeout(300);
    await shot(page, `after-${size}-manager-after-last-approval`);

    await open(page, "?role=cashier&path=/admin/checkout");
    await shot(page, `after-${size}-cashier-till`);

    if (size === "phone") {
      await open(page, "?role=manager&path=/admin/checkout&pending=1");
      await page.getByRole("button", { name: /^View order/ }).click();
      await page.waitForTimeout(300);
      await shot(page, `after-${size}-manager-order-sheet`);
    }
  });
}
