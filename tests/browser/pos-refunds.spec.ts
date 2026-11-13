import { expect, test, type Page } from "@playwright/test";

/*
 * Partial refunds on POS receipt lines (package 2.1), on the staff-roles fixture: a ฿1,800 receipt
 * (Thai massage 60 ฿1,200 + Foot spa 45 ฿600) paid by card. Amounts go to the server in satang.
 */
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });

async function refund(page: Page, line: string, amount: string | null, reason: string, title = "Refund") {
  await receipt(page).getByRole("button", { name: `Refund ${line}` }).click();
  const form = receipt(page).getByRole("form", { name: title, exact: true });
  if (amount !== null) await form.getByRole("textbox", { name: "Amount (฿)" }).fill(amount);
  await form.getByRole("textbox", { name: "Reason" }).fill(reason);
  return form;
}

test.use({ viewport: { width: 1360, height: 1000 } });

test("a manager refunds part of a line, then the rest of the receipt", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const r = receipt(page);
  await expect(page.getByTestId("receipt-status")).toHaveCount(0);
  await expect(r.getByTestId("receipt-net")).toHaveCount(0);

  await r.getByRole("button", { name: "Refund Thai massage 60" }).click();
  const form = r.getByRole("form", { name: "Refund", exact: true });
  const amount = form.getByRole("textbox", { name: "Amount (฿)" });
  // Opens with the amount focused, prefilled with what is left, and the original tender.
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue("1200");
  await expect(form.getByRole("combobox", { name: "Method" })).toHaveText("Card");
  await expect(form.getByText("Up to ฿1,200")).toBeVisible();
  await expect(form.getByRole("button", { name: "Record refund" })).toBeDisabled();
  await amount.fill("1200.01");
  await expect(form.getByText("Up to ฿1,200.")).toBeVisible();
  await amount.fill("300");
  await form.getByRole("textbox", { name: "Reason" }).fill("Shortened treatment");
  await form.getByRole("button", { name: "Record refund" }).click();

  await expect(page.getByText("Refunded ฿300.")).toBeFocused();
  await expect(form).toHaveCount(0);
  await expect(r.getByTestId("receipt-line-refunded")).toHaveText("Refunded-฿300");
  await expect(r.getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");
  await expect(r.getByTestId("receipt-net")).toHaveText("Net฿1,500");
  await expect(page.getByTestId("receipt-status")).toHaveCount(0);

  // The rest of the massage: the form now offers what is left.
  const rest = await refund(page, "Thai massage 60", null, "Guest left early");
  await expect(rest.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("900");
  await rest.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿900.")).toBeVisible();
  await expect(r.getByRole("button", { name: "Refund Thai massage 60" })).toHaveCount(0);

  await (await refund(page, "Foot spa 45", null, "Not given")).getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByTestId("receipt-status")).toHaveText("Refunded");
  await expect(r.getByTestId("receipt-refunded")).toHaveText("Refunded-฿1,800");
  await expect(r.getByTestId("receipt-net")).toHaveText("Net฿0");
  await expect(r.getByRole("button", { name: /^Refund / })).toHaveCount(0);
});

test("the form works from the keyboard and Escape returns focus to its line", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const trigger = receipt(page).getByRole("button", { name: "Refund Foot spa 45" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
  await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toBeFocused();
  // The method list closes on Escape without closing the form.
  await form.getByRole("combobox", { name: "Method" }).click();
  await page.getByRole("option", { name: "Cash" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "Method" }).click();
  await page.getByRole("option", { name: "Cash" }).click();
  await expect(form.getByRole("combobox", { name: "Method" })).toHaveText("Cash");
  await form.getByRole("textbox", { name: "Reason" }).focus();
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a refund over what is left shows the server's remaining amount", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const form = await refund(page, "Thai massage 60", null, "Wrong service");
  // Another till returns ฿500 on the same line before this one is sent.
  await page.evaluate(() => window.fixture.refundFromAnotherTill("Thai massage 60", 50_000));
  await form.getByRole("button", { name: "Record refund" }).click();
  await expect(form.getByRole("alert")).toHaveText("Only ฿700 left to refund on this line.");
  await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("700");
  await expect(form.getByText("Up to ฿700")).toBeVisible();
  await form.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿700.")).toBeVisible();
  await expect(receipt(page).getByTestId("receipt-line-refunded")).toHaveText("Refunded-฿1,200");
});

test("a cashier asks a manager, and the approved refund appears on the receipt", async ({ page }) => {
  await open(page, "?role=cashier&scenario=refund");
  const form = await refund(page, "Thai massage 60", "300", "Shortened treatment", "Ask a manager");
  await form.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager · refund ฿300 · Thai massage 60");
  // One request at a time; nothing is refunded yet.
  await expect(receipt(page).getByRole("button", { name: "Refund Foot spa 45" })).toBeDisabled();
  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveCount(0);

  // A manager takes the till.
  await page.evaluate(() => window.fixture.setRole("manager"));
  await page.getByTestId("approvals-button").click();
  const panel = page.getByRole("dialog", { name: "Approvals" });
  const card = panel.getByTestId("approval-request");
  await expect(card).toContainText("Mint asks to refund ฿300 · Thai massage 60");
  await expect(card).toContainText("“Shortened treatment”");
  await expect(card).toContainText("Order #1043 · Net received ฿1,800 → ฿1,500");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(panel.getByRole("status").first()).toHaveText("Approved · Order #1043");
  await page.keyboard.press("Escape");

  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");
  await expect(receipt(page).getByTestId("receipt-net")).toHaveText("Net฿1,500");
  await expect(page.locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
  // The real backend recorded the approved request with its own attempt key.
  const attempts = await page.evaluate(() => window.fixture.recordedRefunds());
  expect(attempts).toHaveLength(1);
  expect(attempts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[0]).toMatchObject({ amount: 30_000, currency: "THB", method: "card", reason: "Shortened treatment" });
});

test("a cashier allowed to refund records it directly", async ({ page }) => {
  await open(page, "?role=cashier&scenario=refund&refund=cashier");
  const form = await refund(page, "Foot spa 45", "150", "Cut short");
  await expect(form.getByRole("button", { name: "Send request" })).toHaveCount(0);
  await form.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿150.")).toBeVisible();
  await expect(receipt(page).getByTestId("receipt-net")).toHaveText("Net฿1,650");
  await expect(page.locator("[data-approval-status]")).toHaveCount(0);
});

test("void is turned off once the receipt has a refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await expect(page.getByRole("button", { name: "Void…" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "No money was received…" })).toBeVisible();
  await (await refund(page, "Foot spa 45", "100", "Cut short")).getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿100.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Void…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "No money was received…" })).toHaveCount(0);
  // Scroll first: a tooltip closes when its page scrolls.
  const why = page.getByRole("button", { name: "Why void is off" });
  await why.scrollIntoViewIfNeeded();
  await why.click();
  await expect(page.getByRole("tooltip")).toHaveText("A receipt with refunds can’t be voided.");
});

test("attached rows point to their booking instead of offering a refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund&attached=1");
  await expect(receipt(page).getByRole("button", { name: "Refund Thai massage 90" })).toHaveCount(0);
  await receipt(page).getByRole("button", { name: "Refunding Thai massage 90" }).click();
  await expect(page.getByRole("tooltip")).toHaveText("Refund this on the appointment.");
});

test("financial history and the orders list show the refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await (await refund(page, "Thai massage 60", "300", "Shortened treatment")).getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿300.")).toBeVisible();

  await page.getByText("Browse all financial history", { exact: true }).click();
  const stream = page.getByRole("region", { name: "All line refunds" });
  await expect(stream.getByRole("listitem")).toHaveCount(1);
  await expect(stream.getByRole("listitem")).toContainText("Refunded · ฿300 · Card");
  await expect(stream.getByRole("listitem")).toContainText("Thai massage 60");
  await expect(stream.getByRole("listitem")).toContainText("Shortened treatment");

  await page.getByRole("button", { name: "New sale" }).click();
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Paid", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Paid orders" }).getByRole("listitem").first()).toContainText("Refunded ฿300");
});

test("a retry after a lost answer reuses the same attempt key", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await page.evaluate(() => window.fixture.loseNextRefundResponse());
  const form = await refund(page, "Thai massage 60", "300", "Shortened treatment");
  await form.getByRole("button", { name: "Record refund" }).click();
  await expect(form.getByRole("alert")).toHaveText("Connection lost. Try again.");
  await form.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿300.")).toBeVisible();
  // Recorded once.
  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");

  // A new form is a new return, with a new key.
  await (await refund(page, "Thai massage 60", "100", "Second return")).getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded ฿100.")).toBeVisible();
  const keys = (await page.evaluate(() => window.fixture.refundAttempts())).map((attempt) => attempt.idempotencyKey);
  expect(keys).toHaveLength(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});
