import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Checkout coupons in a real browser, on the fixture backend (checkout-fixture.tsx scenarios):
 * no horizontal scroll at phone, iPad and desktop widths in light and dark, and the entry,
 * applied, problem, payment and receipt states laid out inside their panels.
 */

const WIDTHS = [390, 820, 1180, 1440];
const EVIDENCE = process.env.CHECKOUT_LAYOUT_EVIDENCE;

async function open(page: Page, width: number, scenario: string, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.goto(`/tests/browser/checkout.html?scenario=${scenario}${theme === "dark" ? "&theme=dark" : ""}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(300);
}

/** The order panel: the side panel on wide screens, the bottom sheet (opened) on narrow ones. */
async function orderPanel(page: Page, width: number): Promise<Locator> {
  if (width >= 1024) return page.getByRole("complementary", { name: "Order" });
  await page.getByRole("button", { name: /open the order/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

async function expectNoSideScroll(page: Page, width: number) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), "page scroll width").toBeLessThanOrEqual(width);
}

/** The element sits inside the viewport and inside its panel, and its content doesn't overflow it. */
async function expectInside(locator: Locator, panel: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const outer = (await panel.boundingBox())!;
  expect.soft(box.x, `${label} left`).toBeGreaterThanOrEqual(outer.x - 1);
  expect.soft(box.x + box.width, `${label} right`).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect.soft(await locator.evaluate((el) => el.scrollWidth - el.clientWidth), `${label} overflow`).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`coupon states fit at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "coupon-entry", theme);
      let panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Add coupon/ }).click();
      const field = panel.getByRole("textbox", { name: "Coupon code or offer link" });
      await field.fill("https://elsewhere.example/q1");
      await field.press("Enter");
      await expect(panel.getByText("Only offer links from this site can be used.")).toBeVisible();
      await expectInside(panel.getByRole("form", { name: "Add coupon" }), panel, "coupon field");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-entry-${width}-${theme}`);

      // A scanner types the poster QR's link and Enter.
      await field.fill(`${new URL(page.url()).origin}/q1`);
      await field.press("Enter");
      const chip = panel.getByTestId("order-coupon");
      await expect(chip).toContainText("Saves ฿500");
      await expect(panel.getByTestId("order-coupon-total")).toContainText("Coupon DCNT-SPA-500");
      await expectInside(chip, panel, "applied coupon");
      await expectInside(panel.getByRole("listitem").filter({ hasText: "Thai massage 60" }).first(), panel, "row with a coupon share");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-applied-${width}-${theme}`);

      await open(page, width, "coupon-problem", theme);
      panel = await orderPanel(page, width);
      await expect(panel.getByTestId("order-coupon-problem")).toContainText("This coupon needs at least ฿1,500.");
      await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeDisabled();
      await expectInside(panel.getByTestId("order-coupon-problem"), panel, "coupon problem");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-problem-${width}-${theme}`);

      await open(page, width, "coupon-soldout", theme);
      panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: "Card", exact: true }).click();
      await panel.getByRole("button", { name: /^Confirm .* received$/ }).click();
      const refused = panel.getByTestId("pay-coupon-problem");
      await expect(refused).toContainText("Payment not recorded.");
      await expectInside(refused, panel, "refused at payment");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-soldout-${width}-${theme}`);

      await open(page, width, "coupon-paid", theme);
      const receipt = page.locator("article.pos-receipt");
      await expect(receipt.getByTestId("receipt-coupon-total")).toHaveText(/Coupon DCNT-SPA-500.*-฿500/);
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-receipt-${width}-${theme}`);
    });
  }
}

test("a stay priced with its own coupon says so and keeps its price", async ({ page }) => {
  await open(page, 1180, "coupon-stay", "light");
  const panel = await orderPanel(page, 1180);
  await expect(panel.getByText("on the booking")).toBeVisible();
  await expect(panel.getByTestId("order-coupon-total")).toContainText("-฿120");
  await shot(page, "coupon-stay-1180-light");
});

test("the receipt prints the coupon on 58 mm paper", async ({ page }) => {
  await open(page, 1180, "coupon-paid", "light");
  await page.getByRole("radio", { name: "58 mm" }).click();
  await page.emulateMedia({ media: "print" });
  const receipt = page.locator("article.pos-receipt");
  await expect(receipt.getByTestId("receipt-line-coupon")).toHaveCount(2);
  expect(await receipt.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await shot(page, "coupon-receipt-print-58");
});

test("on a short phone screen the coupon trigger sits in the order header, keeping the tenders in view", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tests/browser/checkout.html?scenario=coupon-entry");
  await page.locator("[data-fixture-ready]").waitFor();
  const panel = await orderPanel(page, 844);
  const card = panel.getByRole("button", { name: "Card", exact: true });
  expect((await card.boundingBox())!.y + (await card.boundingBox())!.height).toBeLessThanOrEqual(390.5);
  await panel.getByRole("button", { name: "Add coupon", exact: true }).click();
  const field = panel.getByRole("textbox", { name: "Coupon code or offer link" });
  await expect(field).toBeFocused();
  await field.fill("DCNT-SPA-500");
  await field.press("Enter");
  await expect(panel.getByTestId("order-coupon")).toContainText("Saves ฿500");
  await expectNoSideScroll(page, 844);
  await shot(page, "coupon-short-844x390");
});

test("cancelling the coupon field returns focus to the Add coupon that is showing", async ({ page }) => {
  // The full-size row on a normal screen.
  await open(page, 1280, "coupon-entry", "light");
  let panel = await orderPanel(page, 1280);
  await panel.getByRole("button", { name: /^Add coupon/ }).click();
  await panel.getByRole("button", { name: "Cancel coupon" }).click();
  await expect(panel.getByRole("button", { name: /^Add coupon/ })).toBeFocused();
  // The compact trigger in the order header on a short screen.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tests/browser/checkout.html?scenario=coupon-entry");
  await page.locator("[data-fixture-ready]").waitFor();
  panel = await orderPanel(page, 844);
  await panel.getByRole("button", { name: "Add coupon", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel coupon" }).click();
  await expect(panel.getByRole("button", { name: "Add coupon", exact: true })).toBeFocused();
});
