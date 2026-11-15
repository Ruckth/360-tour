import { test, expect } from "@playwright/test";

// CAPTURE_VIS_A=1 BOOKING_UI_PORT=4371 pnpm exec playwright test -c playwright.booking.config.ts vis-a-screenshots --workers=1
// Same staff fixtures and actions as now-screenshots; historical archives stay unchanged.
test.skip(process.env.CAPTURE_VIS_A !== "1", "Set CAPTURE_VIS_A=1 to capture Package A.");
test.use({ colorScheme: "light", timezoneId: "Asia/Bangkok" });
for (const [size, viewport] of Object.entries({ ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } })) {
  for (const state of ["checkout-start", "line-open", "cash-panel", "cash-1500", "split", "receipt", "refund"]) {
    test(`${state}-${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const paid = state === "receipt" || state === "refund";
      await page.goto(`/tests/browser/staff-roles.html?role=${paid ? "manager" : "cashier"}${paid ? "&scenario=refund" : state === "checkout-start" ? "" : "&scenario=spa"}`);
      await page.locator("[data-fixture-ready]").waitFor();
      if (state === "refund") await page.getByTestId("receipt-items").getByRole("button", { name: "Refund Foot spa 45" }).click();
      else if (["line-open", "cash-panel", "cash-1500", "split"].includes(state)) {
        if (size === "phone") await page.getByRole("button", { name: /open the order/ }).click();
        const panel = size === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
        if (state === "line-open") await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
        else if (state === "split") {
          await panel.getByRole("button", { name: "Split payment", exact: true }).click();
          await panel.getByLabel("Payment 1 amount").fill("500");
        } else {
          await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
          if (state === "cash-1500") await panel.getByRole("button", { name: "฿1,500", exact: true }).click();
        }
      }
      if (paid) await expect(page.getByRole("article", { name: "Receipt" }).getByRole("button")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `docs/screenshots/vis-a/${state}-${size}.png`, animations: "disabled" });
    });
  }
}
