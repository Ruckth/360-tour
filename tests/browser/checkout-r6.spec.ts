import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, role = "manager") {
  await page.goto(`/tests/browser/staff-roles.html?role=${role}&scenario=refund`);
  await page.locator("[data-fixture-ready]").waitFor();
}
async function task(page: Page, name: "Correct payment" | "Void…") {
  await page.getByRole("button", { name: "More receipt actions" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  return page.getByTestId(name === "Correct payment" ? "correct-payment" : "void-panel");
}
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
const unloadBlocked = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));

for (const width of [390, 1180]) {
  test.describe(`${width}px receipt drafts`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
    for (const name of ["Correct payment", "Void…"] as const) {
      test(`${name}: Close, Escape and in-app links protect drafts; Discard closes`, async ({ page }) => {
        await open(page);
        const panel = await task(page, name);
        const close = page.getByRole("button", { name: name === "Correct payment" ? "Close Correct payment" : "Close Void", exact: true });
        await close.click();
        await expect(panel).toHaveCount(0);
        await expect(guard(page)).toHaveCount(0);
        await task(page, name);
        const reason = panel.getByRole("textbox", { name: "Reason", exact: true });
        await reason.fill("Unfinished draft");
        expect(await unloadBlocked(page)).toBe(true);
        await close.click();
        await expect(guard(page)).toBeVisible();
        await guard(page).getByRole("button", { name: "Keep editing" }).click();
        await expect(reason).toHaveValue("Unfinished draft");
        await reason.press("Escape");
        await expect(guard(page)).toBeVisible();
        await guard(page).getByRole("button", { name: "Keep editing" }).click();
        // The shared hook guards real same-tab anchors outside the task too.
        await page.evaluate(() => {
          const link = document.createElement("a");
          link.href = "/tests/browser/staff-roles.html?role=manager";
          link.textContent = "Leave receipt";
          document.body.prepend(link);
        });
        await page.getByRole("link", { name: "Leave receipt" }).click();
        await expect(guard(page)).toBeVisible();
        await guard(page).getByRole("button", { name: "Keep editing" }).click();
        await expect(reason).toHaveValue("Unfinished draft");
        await close.click();
        await guard(page).getByRole("button", { name: "Discard", exact: true }).click();
        await expect(panel).toHaveCount(0);
        expect(await unloadBlocked(page)).toBe(false);
      });
      for (const role of ["manager", "cashier"]) {
        test(`${name}: ${role} successful submit bypasses the guard and clears the draft`, async ({ page }) => {
          await open(page, role);
          const panel = await task(page, name);
          if (name === "Correct payment") await panel.getByRole("button", { name: "PromptPay", exact: true }).click();
          await panel.getByRole("textbox", { name: "Reason", exact: true }).fill("Wrong recording");
          expect(await unloadBlocked(page)).toBe(true);
          if (name === "Correct payment") await panel.getByRole("button", { name: role === "manager" ? /^Save ·/ : /^Send .* to manager$/ }).click();
          else await panel.locator('[data-void-choice="unreceived"]').click();
          await expect(panel).toHaveCount(0);
          await expect(guard(page)).toHaveCount(0);
          await expect(page.getByRole("status").filter({ hasText: role === "cashier" ? "Sent to a manager" : name === "Correct payment" ? "Payment corrected" : "Entered by mistake" })).toBeVisible();
          expect(await unloadBlocked(page)).toBe(false);
          await page.getByRole("button", { name: "New sale", exact: true }).click();
          await expect(guard(page)).toHaveCount(0);
          await expect(page.getByTestId("receipt-view")).toHaveCount(0);
        });
      }
    }
    for (const change of ["method", "date", "amount", "payer"]) {
      test(`correction ${change} edit counts as a draft`, async ({ page }) => {
        await open(page);
        const panel = await task(page, "Correct payment");
        if (change === "method") await panel.getByRole("button", { name: "PromptPay", exact: true }).click();
        else {
          await panel.locator("summary", { hasText: "More" }).click();
          if (change === "date") await panel.getByLabel("Received at · Bangkok time").fill("2026-10-01T12:00");
          if (change === "amount") await panel.getByLabel("Corrected payment 1 amount", { exact: true }).fill("");
          if (change === "payer") await panel.getByRole("button", { name: "No named customer", exact: true }).click();
        }
        await expect.poll(() => unloadBlocked(page)).toBe(true);
        await page.getByRole("button", { name: "Close Correct payment" }).click();
        await expect(guard(page)).toBeVisible();
        await guard(page).getByRole("button", { name: "Discard", exact: true }).click();
        await expect(panel).toHaveCount(0);
      });
    }
  });
}

test.use({ hasTouch: true, isMobile: true });
for (const width of [360, 390]) {
  test(`order header remains one row at ${width}px with visible Coupon text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/staff-roles.html?role=cashier&scenario=spa");
    await page.getByRole("button", { name: /open the order/ }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
    const title = panel.getByTestId("order-panel-title");
    const coupon = panel.getByRole("button", { name: "Add coupon", exact: true });
    await expect(coupon).toHaveText("Coupon");
    const controls = [coupon, panel.getByRole("button", { name: "More order actions" }), panel.getByRole("button", { name: "Close order", exact: true })];
    const titleBox = (await title.boundingBox())!;
    for (const control of controls) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeLessThan(titleBox.y + titleBox.height);
      expect(box.y + box.height).toBeGreaterThan(titleBox.y);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await panel.getByRole("button", { name: /^Schedule/ }).click();
    const cue = panel.getByText("More item options", { exact: true });
    await expect(cue).toBeVisible();
    const cueRow = cue.locator("..");
    await expect(cueRow).toHaveCSS("position", "static");
    const scroller = panel.locator("div.overflow-y-auto").filter({ has: page.getByLabel("Discount", { exact: true }) }).last();
    const scrollBox = (await scroller.boundingBox())!;
    expect((await cueRow.boundingBox())!.y).toBeGreaterThanOrEqual(scrollBox.y + scrollBox.height - 1);
  });
}

test("receipt ledgers hide raw references until Technical details opens", async ({ page }) => {
  await page.goto("/tests/browser/checkout-history-r6.html");
  await page.locator("[data-fixture-ready]").waitFor();
  const history = page.getByTestId("receipt-history");
  await history.locator("summary").first().click();
  await expect(history.getByText("Customer", { exact: true })).toBeVisible();
  const customer = history.getByText("Customer reference: internal-customer-reference", { exact: true });
  await expect(customer).toBeHidden();
  await history.getByText("Technical details", { exact: true }).click();
  await expect(customer).toBeVisible();
  await page.getByRole("tab", { name: "Refunds", exact: true }).click();
  const ledger = history.getByRole("region", { name: "Appointment refunds" });
  // Ledger uses a named section (region) so it remains easy to find even with several sources.
  await expect(ledger.getByRole("listitem").getByText("Linked appointment", { exact: true })).toBeVisible();
  await expect(ledger.getByText("Net balance after this return: ฿100 → ฿80", { exact: true })).toBeVisible();
  const id = ledger.getByText("Appointment reference: internal-appointment-reference", { exact: true });
  await expect(id).toBeHidden();
  await ledger.getByText("Technical details", { exact: true }).click();
  await expect(id).toBeVisible();
});
