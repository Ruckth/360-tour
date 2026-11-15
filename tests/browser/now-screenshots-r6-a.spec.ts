import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, colorScheme: "light", timezoneId: "Asia/Bangkok" });
test.skip(process.env.CAPTURE_NOW !== "1", "Set CAPTURE_NOW=1 to capture Package A task and ledger states.");
for (const [size, viewport] of Object.entries({ phone: { width: 390, height: 844 }, ipad: { width: 1180, height: 820 }, desktop: { width: 1440, height: 900 } })) {
  test.describe(`round 6 checkout ${size}`, () => {
    test.use({ viewport, hasTouch: size !== "desktop", isMobile: size !== "desktop", colorScheme: "light", timezoneId: "Asia/Bangkok" });
    for (const state of ["correct-payment", "void", "discard-prompt", "ledger-refunds", "ledger-activity"]) {
      test(`extra-${state}-${size}`, async ({ page }) => {
        const ledger = state.startsWith("ledger");
        await page.goto(ledger ? "/tests/browser/checkout-history-r6.html" : "/tests/browser/staff-roles.html?role=manager&scenario=refund");
        await page.locator("[data-fixture-ready]").waitFor();
        if (ledger) {
          await page.getByTestId("receipt-history").locator("summary").first().click();
          if (state === "ledger-refunds") await page.getByRole("tab", { name: "Refunds", exact: true }).click();
          const history = page.getByTestId("receipt-history");
          await history.scrollIntoViewIfNeeded();
          for (const details of await history.locator('details').all()) await expect(details).not.toHaveAttribute("open");
        } else {
          await page.getByRole("button", { name: "More receipt actions" }).click();
          await page.getByRole("menuitem", { name: state === "void" ? "Void…" : "Correct payment", exact: true }).click();
          const panel = page.getByTestId(state === "void" ? "void-panel" : "correct-payment");
          await panel.getByRole("textbox", { name: "Reason", exact: true }).fill("Wrong recording");
          if (state !== "void") await panel.getByRole("button", { name: "PromptPay", exact: true }).click();
          if (state === "discard-prompt") {
            await page.getByRole("button", { name: "Close Correct payment" }).click();
            await expect(page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
          }
        }
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `docs/screenshots/${process.env.CAPTURE_DIR ?? "audit-r6-a"}/extra-${state}-${size}.png`, animations: "disabled", fullPage: ledger });
      });
    }
  });
}

test("extra-line-open-phone-360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/tests/browser/staff-roles.html?role=cashier&scenario=spa");
  await page.getByRole("button", { name: /open the order/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Thai massage 60/ }).click();
  await page.screenshot({ path: `docs/screenshots/${process.env.CAPTURE_DIR ?? "audit-r6-a"}/extra-line-open-phone-360.png`, animations: "disabled" });
});
