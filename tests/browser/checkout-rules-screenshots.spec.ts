import { test } from "@playwright/test";

// CAPTURE_CHECKOUT_RULES=1 bun run playwright test -c playwright.booking.config.ts checkout-rules-screenshots --workers=1
// Settings › Checkout rules at the four audit widths, into output/checkout-rules/.
test.skip(process.env.CAPTURE_CHECKOUT_RULES !== "1", "Set CAPTURE_CHECKOUT_RULES=1 to capture Checkout rules.");
test.use({ colorScheme: "light", timezoneId: "Asia/Bangkok" });
const WIDTHS = { 390: 844, 820: 1180, 1180: 820, 1440: 900 } as const;
const STATES = { before: "", paused: "&stage=open", ready: "&stage=ready", manager: "&role=manager&stage=paused" } as const;
for (const [width, height] of Object.entries(WIDTHS)) {
  for (const [state, query] of Object.entries(STATES)) {
    test(`${state}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width: Number(width), height });
      await page.goto(`/tests/browser/checkout-rules.html?path=/admin/settings&tab=checkoutRules${query}`);
      await page.getByTestId("checkout-rules").waitFor();
      if (state === "paused") {
        await page.getByTestId("payments-cutover").getByRole("button", { name: "Switch to new payments" }).click();
        await page.getByTestId("rules-dialog").getByRole("button", { name: "Switch to new payments", exact: true }).click();
        await page.getByTestId("rules-refusal").waitFor();
      }
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `output/checkout-rules/${state}-${width}.png`, fullPage: state !== "paused" });
    });
  }
}
