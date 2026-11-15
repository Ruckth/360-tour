import { expect, test, type Page } from "@playwright/test";
import { UX_VIEWPORTS } from "./helpers/ux-census";

/*
 * After screenshots for the r2 checkout and receipt pass, in docs/screenshots/ux-r2-checkout/.
 * The before set is docs/reviews/ux-audit/final-screens on ux/final-audit. Skipped in the normal
 * run; capture with:
 *   CAPTURE_UX_R2=after pnpm exec playwright test -c playwright.booking.config.ts ux-r2-checkout-screenshots
 */
const phase = process.env.CAPTURE_UX_R2;
test.skip(!phase, "Set CAPTURE_UX_R2=after to capture screenshots.");

const DIR = "docs/screenshots/ux-r2-checkout";

async function open(page: Page, query: string, fixture = "staff-roles") {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(400);
}

for (const [size, viewport] of Object.entries(UX_VIEWPORTS)) {
  test(`${phase} ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const shot = async (name: string) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}/${phase}-${size}-${name}.png` });
    };
    const phone = size === "phone";
    const order = () => (phone ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true }));
    const openSheet = async () => { if (phone) await page.getByRole("button", { name: /open the order/ }).click(); };

    // 1. The till with one line: on a phone the bar offers Cash ฿1,200.
    await open(page, "?role=cashier&scenario=spa");
    await shot("01-till-one-line");
    if (phone) {
      // 2. The header's ⋯: Add booking and New order.
      await page.getByRole("button", { name: "More checkout actions" }).click();
      await shot("02-header-menu");
      await page.keyboard.press("Escape");
      // 3. Cash ฿1,200 on the bar opens the cash panel, prefilled; Confirm still takes the money.
      await page.getByTestId("bar-cash").click();
      await expect(page.getByRole("dialog").getByLabel("Cash received")).toHaveValue("1200");
      await shot("03-bar-cash-panel");
      await page.getByRole("dialog").getByRole("button", { name: "Close order", exact: true }).click();
    }

    // 4. A line open: Schedule folds therapist, date and time; 5. opened.
    await openSheet();
    await order().getByRole("button", { name: /^Thai massage 60/ }).click();
    await shot("04-line-open");
    await order().getByRole("button", { name: /^Schedule/ }).click();
    await shot("05-schedule-open");

    // 6. A request waiting: shown once, on the line's bar, with Withdraw.
    await order().getByRole("button", { name: /^Schedule/ }).click();
    await order().getByRole("textbox", { name: "Discount" }).fill("15%");
    await order().getByRole("group", { name: "Ask a manager" }).getByRole("button", { name: "Service delay" }).click();
    await order().getByRole("button", { name: "Send 15% (฿180) to manager" }).click();
    await expect(order().locator('[data-approval-status="pending"]')).toBeVisible();
    await shot("06-waiting-once");

    // 7. Split: the tender row gives way to Back.
    await open(page, "?role=cashier&scenario=spa");
    await openSheet();
    await order().getByRole("button", { name: "Split payment", exact: true }).click();
    await order().getByLabel("Payment 1 amount").fill("500");
    await shot("07-split");

    // 8. Coupon in the order: terms behind ⓘ (it needs ฿1,500 of spa).
    await open(page, "?role=cashier&scenario=spa");
    await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
    await page.waitForTimeout(300);
    await openSheet();
    await order().getByRole("button", { name: /^Add coupon/ }).filter({ visible: true }).first().click();
    const field = order().getByRole("textbox", { name: "Coupon code or offer link" });
    await field.fill("DCNT-SPA-500");
    await field.press("Enter");
    await expect(order().getByTestId("order-coupon")).toContainText("Saves");
    await shot("08-coupon-chip");

    // 9. Orders dialog, one line for both roles.
    await open(page, "?role=manager");
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await shot("09-orders-manager");

    // 10–12. Receipt: Correct payment (before and after picking), Void; the toolbar is only Close.
    await open(page, "?role=manager&scenario=paid");
    await page.getByRole("button", { name: "More receipt actions" }).click();
    await page.getByRole("menuitem", { name: "Correct payment" }).click();
    await shot("10-correct-payment");
    const form = page.getByTestId("correct-payment");
    await form.getByRole("button", { name: "PromptPay", exact: true }).click();
    await form.getByRole("button", { name: "Wrong method picked" }).click();
    await shot("11-correct-payment-ready");
    await open(page, "?role=manager&scenario=refund");
    await page.getByRole("button", { name: "More receipt actions" }).click();
    await page.getByRole("menuitem", { name: "Void…" }).click();
    await shot("12-void");

    // 13. Link review: one sentence.
    await open(page, "?scenario=unscheduled-paid", "checkout");
    await page.getByRole("article", { name: "Receipt" }).getByRole("button", { name: "Link appointment" }).click();
    await expect(page.getByRole("dialog").getByTestId("link-review")).toBeVisible();
    await shot("13-link-review");
  });
}
