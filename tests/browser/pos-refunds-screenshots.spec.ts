import { test, type Page } from "@playwright/test";

/*
 * Evidence screenshots for POS line refunds, written to docs/screenshots/pos-refunds/. Skipped in
 * the normal run; capture with:
 *   CAPTURE_POS_REFUNDS=1 pnpm exec playwright test -c playwright.booking.config.ts pos-refunds-screenshots
 */
test.skip(!process.env.CAPTURE_POS_REFUNDS, "Set CAPTURE_POS_REFUNDS=1 to capture screenshots.");

const DIR = "docs/screenshots/pos-refunds";
const SIZES = { desktop: { width: 1360, height: 1000 }, phone: { width: 390, height: 844 } } as const;
const THEMES = ["light", "dark"] as const;

async function open(page: Page, query: string, theme: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}${theme === "dark" ? "&theme=dark" : ""}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });

async function record(page: Page, line: string, amount: string | null, reason: string) {
  await receipt(page).getByRole("button", { name: `Refund ${line}` }).click();
  const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
  if (amount !== null) await form.getByRole("textbox", { name: "Amount (฿)" }).fill(amount);
  await form.getByRole("textbox", { name: "Reason" }).fill(reason);
  await form.getByRole("button", { name: "Record refund" }).click();
  await form.waitFor({ state: "detached" });
}

for (const [size, viewport] of Object.entries(SIZES)) {
  for (const theme of THEMES) {
    test.describe(`${size} ${theme}`, () => {
      test.use({ viewport });
      const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}-${size}-${theme}.png` });

      test("receipt with the refund form open", async ({ page }) => {
        await open(page, "?role=manager&scenario=refund&attached=1", theme);
        await receipt(page).getByRole("button", { name: "Refund Thai massage 60" }).click();
        const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
        await form.getByRole("textbox", { name: "Amount (฿)" }).fill("300");
        await form.getByRole("textbox", { name: "Reason" }).fill("Shortened treatment");
        await receipt(page).scrollIntoViewIfNeeded();
        if (size === "phone") await form.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await shot(page, "receipt-refund-form");
      });

      test("cashier asks a manager", async ({ page }) => {
        await open(page, "?role=cashier&scenario=refund", theme);
        await receipt(page).getByRole("button", { name: "Refund Foot spa 45" }).click();
        const form = receipt(page).getByRole("form", { name: "Ask a manager", exact: true });
        await form.getByRole("textbox", { name: "Reason" }).fill("Therapist ill, stopped early");
        if (size === "phone") await form.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await shot(page, "cashier-ask-manager");
      });

      test("receipt after refunds", async ({ page }) => {
        await open(page, "?role=manager&scenario=refund", theme);
        await record(page, "Thai massage 60", "300", "Shortened treatment");
        await record(page, "Foot spa 45", null, "Not given");
        await receipt(page).getByTestId("receipt-net").evaluate((el) => el.scrollIntoView({ block: "center" }));
        await shot(page, "receipt-after-refunds");
      });

      test("receipt fully refunded", async ({ page }) => {
        await open(page, "?role=manager&scenario=refund", theme);
        await record(page, "Thai massage 60", null, "Wrong booking");
        await record(page, "Foot spa 45", null, "Wrong booking");
        if (size === "phone") await page.getByTestId("receipt-status").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await shot(page, "receipt-fully-refunded");
      });

      test("approval card", async ({ page }) => {
        await open(page, "?role=manager&scenario=refund-pending", theme);
        await page.getByTestId("approvals-button").click();
        await page.getByRole("dialog", { name: "Approvals" }).getByTestId("approval-request").waitFor();
        await shot(page, "approval-card");
      });

      test("Team cashier rules", async ({ page }) => {
        await open(page, "?view=settings&tab=team", theme);
        const rules = page.getByRole("form", { name: "Cashier rules" });
        await rules.evaluate((el, block) => el.scrollIntoView({ block }), size === "phone" ? ("start" as const) : ("center" as const));
        await shot(page, "team-cashier-rules");
      });
    });
  }
}
