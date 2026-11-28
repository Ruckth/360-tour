import { expect, test, type Page } from "@playwright/test";

/*
 * Partial refunds on POS receipt lines (package 2.1), on the staff-roles fixture: a ฿1,800 receipt
 * (Thai massage 60 ฿1,200 + Foot spa 45 ฿600) paid by card. Amounts go to the server in satang.
 */
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const items = (page: Page) => page.getByTestId("receipt-items");
const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });
/** What a finished refund or request says, under its line. */
const note = (page: Page, text: string) => items(page).locator("[data-line-note]").filter({ hasText: text });
const RECORD = /^Record refund/;

async function refund(page: Page, line: string, amount: string | null, reason: string, title = "Refund") {
  await items(page).getByRole("button", { name: `Refund ${line}` }).click();
  const form = items(page).getByRole("form", { name: title, exact: true });
  if (amount !== null) await form.getByRole("textbox", { name: "Amount (฿)" }).fill(amount);
  else await form.getByRole("radio", { name: "All", exact: true }).click();
  await form.getByRole("textbox", { name: "Reason" }).fill(reason);
  return form;
}

test.use({ viewport: { width: 1360, height: 1000 } });

test("a manager refunds part of a line, then the rest of the receipt", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const r = receipt(page);
  await expect(page.getByTestId("receipt-status")).toHaveText("Paid");
  await expect(r.getByTestId("receipt-net")).toHaveCount(0);

  await items(page).getByRole("button", { name: "Refund Thai massage 60" }).click();
  const form = items(page).getByRole("form", { name: "Refund", exact: true });
  const amount = form.getByRole("textbox", { name: "Amount (฿)" });
  // The form focuses its heading and requires a deliberate amount.
  await expect(form.getByText("Refund", { exact: true })).toBeFocused();
  await expect(amount).toHaveValue("");
  await expect(form.getByRole("radio", { name: "All", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(form.getByRole("radiogroup", { name: "Refund to" }).getByRole("radio", { name: "Card", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByRole("button", { name: "Choose an amount" })).toBeDisabled();
  await amount.fill("1200.01");
  await expect(form.getByText("Up to ฿1,200.")).toBeVisible();
  await amount.fill("300");
  await form.getByRole("radio", { name: "Cut short" }).click();
  await form.getByRole("button", { name: "Record refund ฿300" }).click();

  await expect(note(page, "Refunded ฿300 · Short treatment")).toBeFocused();
  await expect(form).toHaveCount(0);
  await expect(r.getByTestId("receipt-line-refunded")).toHaveText("Refunded-฿300");
  await expect(r.getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");
  await expect(r.getByTestId("receipt-net")).toHaveText("Net฿1,500");
  await expect(page.getByTestId("receipt-status")).toHaveText("Partly refunded · ฿300");

  // The rest of the massage: the form now offers what is left.
  const rest = await refund(page, "Thai massage 60", null, "Guest left early");
  await expect(rest.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("900");
  await rest.getByRole("button", { name: "Record refund ฿900" }).click();
  await expect(note(page, "Refunded ฿900 · Guest left early")).toBeVisible();
  await expect(items(page).getByRole("button", { name: "Refund Thai massage 60" })).toHaveCount(0);

  await (await refund(page, "Foot spa 45", null, "Not given")).getByRole("button", { name: RECORD }).click();
  await expect(page.getByTestId("receipt-status")).toHaveText("Refunded");
  await expect(r.getByTestId("receipt-refunded")).toHaveText("Refunded-฿1,800");
  await expect(r.getByTestId("receipt-net")).toHaveText("Net฿0");
  await expect(items(page).getByRole("button", { name: /^Refund / })).toHaveCount(0);
});

test("the form works from the keyboard and Escape returns focus to its line", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const trigger = items(page).getByRole("button", { name: "Refund Foot spa 45" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const form = items(page).getByRole("form", { name: "Refund", exact: true });
  await expect(form.getByText("Refund", { exact: true })).toBeFocused();
  // The segmented method control works from the keyboard; Escape still closes the form.
  const cash = form.getByRole("radiogroup", { name: "Refund to" }).getByRole("radio", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true });
  await cash.focus();
  await page.keyboard.press("Enter");
  await expect(cash).toHaveAttribute("aria-checked", "true");
  await form.getByRole("textbox", { name: "Reason" }).focus();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a refund over what is left shows the server's remaining amount", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const form = await refund(page, "Thai massage 60", null, "Wrong service");
  // Another till returns ฿500 on the same line before this one is sent.
  await page.evaluate(() => window.fixture.refundFromAnotherTill("Thai massage 60", 50_000));
  const recordAll = form.getByRole("button", { name: "Record refund ฿1,200" });
  if (await recordAll.isEnabled()) await recordAll.click();
  await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("1200");
  await form.getByRole("button", { name: "Use remaining amount" }).click();
  await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("700");
  await expect(form.getByRole("radio", { name: "All", exact: true })).toHaveAttribute("aria-checked", "true");
  await form.getByRole("button", { name: "Record refund ฿700" }).click();
  await expect(note(page, "Refunded ฿700")).toBeVisible();
  await expect(receipt(page).getByTestId("receipt-line-refunded")).toHaveText("Refunded-฿1,200");
});

test("a cashier asks a manager, and the approved refund appears on the receipt", async ({ page }) => {
  await open(page, "?role=cashier&scenario=refund");
  const form = await refund(page, "Thai massage 60", "300", "Short treatment", "Ask a manager");
  await form.getByRole("button", { name: "Send refund ฿300 to manager" }).click();
  await expect(note(page, "Sent to a manager · refund ฿300")).toBeVisible();
  await expect(page.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager · refund ฿300 · Thai massage 60");
  // One request at a time; nothing is refunded yet.
  await expect(items(page).getByRole("button", { name: "Refund Foot spa 45" })).toBeDisabled();
  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveCount(0);

  // A manager takes the till.
  await page.evaluate(() => window.fixture.setRole("manager"));
  await page.getByTestId("approvals-button").click();
  const panel = page.getByRole("dialog", { name: "Approvals" });
  const card = panel.getByTestId("approval-request");
  await expect(card.locator("p").first()).toHaveText("Thai massage 60 · Order #1043");
  await expect(card).toContainText("Mint asks to refund ฿300");
  await expect(card).toContainText("“Short treatment”");
  await expect(card).toContainText("Net received ฿1,800 → ฿1,500");
  await card.getByRole("button", { name: "Approve" }).click();
  // The last request: the panel closes and the toast says what happened.
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveText("Approved refund ฿300 · Thai massage 60 on #1043");

  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");
  await expect(receipt(page).getByTestId("receipt-net")).toHaveText("Net฿1,500");
  await expect(page.locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
  // The real backend recorded the approved request with its own attempt key.
  const attempts = await page.evaluate(() => window.fixture.recordedRefunds());
  expect(attempts).toHaveLength(1);
  expect(attempts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[0]).toMatchObject({ amount: 30_000, currency: "THB", method: "card", reason: "Short treatment" });
});

test("a cashier allowed to refund records it directly", async ({ page }) => {
  await open(page, "?role=cashier&scenario=refund&refund=cashier");
  const form = await refund(page, "Foot spa 45", "150", "Cut short");
  await expect(form.getByRole("button", { name: /to manager$/ })).toHaveCount(0);
  await form.getByRole("button", { name: "Record refund ฿150" }).click();
  await expect(note(page, "Refunded ฿150 · Cut short")).toBeVisible();
  await expect(receipt(page).getByTestId("receipt-net")).toHaveText("Net฿1,650");
  await expect(page.locator("[data-approval-status]")).toHaveCount(0);
});

test("void is turned off once the receipt has a refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  const more = page.getByRole("button", { name: "More receipt actions" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Void…", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await (await refund(page, "Foot spa 45", "100", "Cut short")).getByRole("button", { name: "Record refund ฿100" }).click();
  await expect(note(page, "Refunded ฿100 · Cut short")).toBeVisible();
  await more.click();
  // pos.voidOrder and voidUnreceivedOrder both refuse it (ORDER_HAS_REFUNDS), so the one Void… is off and says why.
  await expect(page.getByRole("menuitem", { name: "Void… · not after a refund" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("menuitem", { name: "Void…", exact: true })).toHaveCount(0);
});

test("attached rows point to their booking instead of offering a refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund&attached=1");
  await expect(items(page).getByRole("button", { name: "Refund Thai massage 90" })).toHaveCount(0);
  await items(page).getByRole("button", { name: "Refunding Thai massage 90" }).click();
  await expect(page.getByRole("tooltip")).toHaveText("Refund this on the appointment.");
});

test("financial history and the orders list show the refund", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await (await refund(page, "Thai massage 60", "300", "Short treatment")).getByRole("button", { name: "Record refund ฿300" }).click();
  await expect(note(page, "Refunded ฿300")).toBeVisible();

  const history = page.getByTestId("receipt-history");
  await history.getByText("History", { exact: true }).click();
  await history.getByRole("tab", { name: "Refunds" }).click();
  const stream = history.getByRole("region", { name: "Line refunds" });
  await expect(stream.getByRole("listitem")).toHaveCount(1);
  await expect(stream.getByRole("listitem")).toContainText("Refunded · ฿300 · Card");
  await expect(stream.getByRole("listitem")).toContainText("Thai massage 60");
  await expect(stream.getByRole("listitem")).toContainText("Short treatment");

  await page.getByRole("button", { name: "New sale" }).click();
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Paid", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Paid orders" }).getByRole("listitem").first()).toContainText("Refunded ฿300");
});

test("a retry after a lost answer reuses the same attempt key", async ({ page }) => {
  await open(page, "?role=manager&scenario=refund");
  await page.evaluate(() => window.fixture.loseNextRefundResponse());
  const form = await refund(page, "Thai massage 60", "300", "Short treatment");
  await form.getByRole("button", { name: "Record refund ฿300" }).click();
  await expect(form.getByRole("alert")).toHaveText("Connection lost. Try again.");
  await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toBeDisabled();
  await expect(form.getByRole("textbox", { name: "Reason" })).toBeDisabled();
  for (const method of await form.getByRole("radiogroup", { name: "Refund to" }).getByRole("radio").all()) await expect(method).toBeDisabled();
  await form.getByRole("button", { name: "Retry same refund" }).click();
  await expect(note(page, "Refunded ฿300")).toBeVisible();
  const retryAttempts = await page.evaluate(() => window.fixture.refundAttempts());
  expect(retryAttempts[1]).toEqual(retryAttempts[0]);
  // Recorded once.
  await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");

  // A new form is a new return, with a new key.
  await (await refund(page, "Thai massage 60", "100", "Second return")).getByRole("button", { name: "Record refund ฿100" }).click();
  await expect(note(page, "Refunded ฿100 · Second return")).toBeVisible();
  const keys = (await page.evaluate(() => window.fixture.refundAttempts())).map((attempt) => attempt.idempotencyKey);
  expect(keys).toHaveLength(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});
