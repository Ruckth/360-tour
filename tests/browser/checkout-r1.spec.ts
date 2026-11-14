import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "?role=cashier&scenario=spa") {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

test("an empty order explains how to start and has no payment actions", async ({ page }) => {
  await open(page, "?role=cashier");
  const order = page.getByRole("complementary", { name: "Order", exact: true });
  await expect(order.getByText("No items yet")).toBeVisible();
  await expect(order.getByTestId("order-due")).toHaveCount(0);
  await expect(order.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toHaveCount(0);
  await expect(page.getByText("No booking", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New order", exact: true })).toHaveCount(0);
});

test("a typed discount saves on blur and a larger discount still needs approval", async ({ page }) => {
  await open(page);
  const order = page.getByRole("complementary", { name: "Order", exact: true });
  await order.getByRole("button", { name: /^Thai massage 60/ }).click();
  const discount = order.getByRole("textbox", { name: "Discount" });
  await discount.fill("10%");
  await discount.press("Tab");
  await expect(order.getByTestId("order-due")).toHaveText("฿1,080");
  await discount.fill("15%");
  await discount.press("Tab");
  await expect(order.getByRole("group", { name: "Ask a manager" })).toBeVisible();
  await expect(order.getByTestId("order-due")).toHaveText("฿1,080");
});

test("invalid order numbers never open a different order", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const lookup = dialog.getByLabel("Order number");
  for (const invalid of ["0", "-1042", "1042.5", "1042abc", "9007199254740992"]) {
    await lookup.fill(invalid);
    await dialog.getByRole("button", { name: "Go", exact: true }).click();
    await expect(lookup).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("alert")).toHaveText("Enter a positive whole order number.");
    await expect(dialog).toBeVisible();
  }
  await lookup.fill("R-001042");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That's the receipt number. Enter the order number, shown as Order #.");
  await lookup.fill("Order #1042");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("order-panel-title")).toHaveText("Order #1042");
});

test("an approval past its local expiry names its item and leaves the decision to the server", async ({ page }) => {
  await page.clock.install();
  await open(page, "?role=manager&scenario=pending");
  await page.getByTestId("approvals-button").click();
  const request = page.getByTestId("approval-request").first();
  await expect(request).toContainText("Thai massage 60");
  await page.clock.fastForward(5 * 60_000);
  // A fast device clock must not block a decision the server would still accept.
  await expect(request).toContainText("Expiring now");
  await expect(request.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await expect(request.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
});

test.describe("phone payment layouts", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test("split validates every row, includes auto balance, and switches to cash in one tap", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /open the order/ }).click();
    const order = page.getByRole("dialog");
    await order.getByRole("button", { name: "Split payment", exact: true }).click();
    const pay = order.getByTestId("pay-panel");
    await expect(pay.getByText("Enter an amount for payment 1.")).toBeVisible();
    await expect(pay.getByText(/^Covered ·/)).toHaveCount(0);
    await expect(pay.getByRole("button", { name: "Confirm split", exact: true })).toBeDisabled();
    await pay.getByLabel("Payment 1 amount").fill("500");
    await expect(pay.getByTestId("split-remaining")).toHaveText("Covered · ฿1,200 in 2 payments");
    await expect(pay.getByText(/^Covered ·/)).toBeVisible();
    await expect(pay.getByLabel("Payment 2 amount")).toHaveText("฿700");
    await expect(pay.getByText("Rest")).toBeVisible();
    await pay.getByLabel("Payment 1 amount").fill("1200");
    await expect(pay.getByText("Leave an amount for the final payment, or use a single payment.")).toBeVisible();
    await expect(pay.getByRole("button", { name: "Confirm split", exact: true })).toBeDisabled();
    await pay.getByLabel("Payment 1 amount").fill("1200.01");
    await expect(pay.getByText(/^Over by/)).toBeVisible();
    await expect(pay.getByTestId("split-remaining")).toHaveText("Over by ฿0.01");
    await expect(pay.getByRole("button", { name: "Confirm split", exact: true })).toBeDisabled();
    await pay.getByRole("group", { name: "Take payment by" }).getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
    await expect(pay.getByLabel("Cash received")).toHaveValue("1,200");
    await pay.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
    await expect(pay.getByLabel("Cash received")).toHaveValue("1,200");
  });

  test("the refund form explains its prerequisite and hides other refund actions", async ({ page }) => {
    await open(page, "?role=manager&scenario=refund");
    const items = page.getByTestId("receipt-items");
    await items.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
    const form = items.getByRole("form", { name: "Refund", exact: true });
    await expect(form.getByRole("textbox", { name: "Reason", exact: true })).toBeVisible();

    await expect(form.getByRole("button", { name: "Pick a reason", exact: true })).toBeDisabled();
    await expect(items.getByRole("button", { name: "Refund Thai massage 60", exact: true })).toHaveCount(0);
    await expect(form.getByRole("button", { name: "PromptPay", exact: true })).toHaveAccessibleName("PromptPay");
    await form.getByRole("button", { name: "Short treatment", exact: true }).click();
    await expect(form.getByRole("button", { name: "Record refund ฿600", exact: true })).toBeEnabled();
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(items.getByRole("button", { name: "Refund Thai massage 60", exact: true })).toBeVisible();
  });
});

test("a changed refund draft guards New sale and Escape without recording money", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
  const form = page.getByRole("form", { name: "Refund", exact: true });
  const header = await page.getByTestId("receipt-view").locator(":scope > header").boundingBox();
  expect(header!.y, "opening a refund keeps the page header below the app bar").toBeGreaterThanOrEqual(64);
  await expect(form.getByText("Refund", { exact: true })).toBeInViewport();
  const itemsHeading = await page.getByTestId("receipt-items").getByRole("heading", { name: "Items", exact: true }).boundingBox();
  const serviceTitle = await page.getByTestId("receipt-items").getByText("Foot spa 45", { exact: true }).boundingBox();
  expect(serviceTitle!.y, "the service name stays below the sticky Items header").toBeGreaterThanOrEqual(itemsHeading!.y + itemsHeading!.height);
  await form.getByRole("button", { name: "Half", exact: true }).click();
  await form.getByRole("button", { name: "Guest complaint", exact: true }).click();
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  const guard = page.getByRole("alertdialog");
  await expect(guard.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await guard.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(form.getByLabel("Amount (฿)")).toHaveValue("300");
  await expect(form.getByLabel("Reason", { exact: true })).toHaveValue("Guest complaint");
  await form.getByLabel("Reason", { exact: true }).press("Escape");
  await guard.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("receipt-view")).toBeVisible();
  await expect(page.locator(".pos-receipt")).not.toContainText("Refunded");
});
