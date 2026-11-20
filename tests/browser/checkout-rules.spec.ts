import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Settings › Checkout rules on its fixture (checkout-rules-fixture.tsx), whose in-memory server
 * refuses the way convex/commerce/settings.ts and paymentCutover.ts do.
 */
async function open(page: Page, query = "") {
  await page.goto(`/tests/browser/checkout-rules.html?path=/admin/settings&tab=checkoutRules${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByTestId("checkout-rules")).toBeVisible();
}
const dialog = (page: Page) => page.getByTestId("rules-dialog");
const products = (page: Page) => page.getByTestId("switch-products");
async function confirmWith(page: Page, button: string, reason?: string) {
  if (reason) await dialog(page).getByRole("button", { name: reason, exact: true }).click();
  await dialog(page).getByRole("button", { name: button, exact: true }).click();
}

test.use({ viewport: { width: 1180, height: 820 } });

test("owner: Products Off → Managers only is refused until new payments are on and the till has reloaded", async ({ page }) => {
  await open(page);
  const managers = products(page).getByRole("radio", { name: "Managers only" });
  await expect(managers).toBeDisabled();
  await expect(page.getByTestId("sell-locked")).toHaveText("Switch to new payments and reload every till first.");
  await managers.click({ force: true });
  await expect(dialog(page)).toHaveCount(0);

  // The cutover: pause, then Switch to new payments (one way).
  const cutover = page.getByTestId("payments-cutover");
  await cutover.getByRole("button", { name: "Pause checkout for update" }).click();
  await confirmWith(page, "Pause checkout for update");
  await expect(cutover.getByTestId("payments-status")).toHaveText("Checkout paused");
  await cutover.getByRole("button", { name: "Switch to new payments" }).click();
  await expect(dialog(page)).toContainText("This can't be undone.");
  await confirmWith(page, "Switch to new payments");
  await expect(cutover.getByTestId("payments-status")).toHaveText("On");
  await expect(page.getByTestId("tills")).toContainText("Main tillWaiting to reload");
  await expect(page.getByTestId("sell-locked")).toContainText("Waiting for 1 till to reload.");
  await expect(managers).toBeDisabled();

  await page.evaluate(() => (window as unknown as { fixture: { ackTill(): void } }).fixture.ackTill());
  await expect(page.getByTestId("sell-locked")).toHaveCount(0);
  await managers.click();
  await expect(dialog(page)).toContainText("Switch Products to Managers only?");
  await confirmWith(page, "Switch to Managers only", "Desk rehearsal");
  await expect(managers).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("toast")).toHaveText(/Products: Managers only/);
  expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toMatchObject({ reason: "Desk rehearsal", switches: { products: "managers" } });
  // Once ready, what checkout can sell leads the page.
  const order = await page.locator('[data-testid="sale-switches"], [data-testid="payments-cutover"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(order).toEqual(["sale-switches", "payments-cutover"]);

  // Lowering is instant (rollback step 1): the reason is ready, one tap to confirm.
  await products(page).getByRole("radio", { name: "Off" }).click();
  await expect(dialog(page)).toContainText("What was already sold keeps working");
  await confirmWith(page, "Switch to Off");
  await expect(products(page).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
});

test("cutover is refused while a pay panel is open, lists it, then succeeds once it is finished", async ({ page }) => {
  await open(page, "&stage=open");
  const cutover = page.getByTestId("payments-cutover");
  await cutover.getByRole("button", { name: "Switch to new payments" }).click();
  await confirmWith(page, "Switch to new payments");
  const refusal = dialog(page).getByTestId("rules-refusal");
  await expect(refusal).toContainText("Finish or reconcile open payments before switching.");
  await expect(refusal.getByTestId("still-open")).toContainText("Pay panel on Main till");
  await expect(refusal.getByRole("link", { name: "Open order" })).toHaveAttribute("href", "/admin/checkout?order=order-0042");
  await expect(cutover.getByTestId("payments-status")).toHaveText("Checkout paused");

  await page.evaluate(() => (window as unknown as { fixture: { closePanel(): void } }).fixture.closePanel());
  await confirmWith(page, "Switch to new payments");
  await expect(dialog(page)).toHaveCount(0);
  await expect(cutover.getByTestId("payments-status")).toHaveText("On");
});

test("a rule changed on another screen keeps the draft, refuses the stale save and loads the current rules", async ({ page }) => {
  await open(page, "&stage=ready");
  const refund = page.getByRole("textbox", { name: "Full refund if unused within" });
  await refund.fill("14");
  await expect(page.getByTestId("rules-save-bar")).toContainText("1 change not saved");
  await page.evaluate(() => (window as unknown as { fixture: { otherScreen(): void } }).fixture.otherScreen());
  await expect(page.getByTestId("rules-stale")).toContainText("These rules changed on another screen.");
  await expect(refund).toHaveValue("14");

  await page.getByTestId("rules-save-bar").getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog(page).getByTestId("rules-diff")).toContainText("Full refund if unused within · 7 days");
  await confirmWith(page, "Save", "Policy change");
  await expect(dialog(page).getByTestId("rules-refusal")).toHaveText("This changed on another screen. Check the new details and try again.");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Load current rules" }).click();
  await expect(refund).toHaveValue("7");
  await expect(page.getByRole("textbox", { name: "Validity · vouchers" })).toHaveValue("90");
  await refund.fill("14");
  await page.getByTestId("rules-save-bar").getByRole("button", { name: "Save", exact: true }).click();
  await confirmWith(page, "Save", "Policy change");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveText(/Saved · added to History/);
  await expect(page.getByTestId("rules-save-bar")).toHaveCount(0);
  const latest = page.getByTestId("rules-history").getByTestId("history-entry").first();
  await expect(latest).toContainText("Checkout rules changed");
  await expect(latest).toContainText("Full refund if unused within: 7 days → 14 days");
  await expect(latest).toContainText("Policy change");
});

test("a manager runs the cutover and reads the rules but can't change sales or the rules", async ({ page }) => {
  await open(page, "&role=manager");
  await expect(products(page).getByRole("radio")).toHaveCount(0);
  await expect(products(page)).toContainText("Off");
  const refund = page.getByRole("textbox", { name: "Full refund if unused within" });
  await expect(refund).toHaveValue("7");
  await expect(refund).toHaveAttribute("readonly", "");
  await expect(page.getByTestId("terms-form")).toContainText("Only the owner can change these rules.");
  await expect(page.getByTestId("read-only-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Pause checkout for update" }).click();
  await confirmWith(page, "Pause checkout for update");
  await expect(page.getByTestId("payments-status")).toHaveText("Checkout paused");
  await expect(page.getByTestId("rules-history").getByTestId("history-entry")).toHaveText([/Checkout paused.*Payments update/]);
});

const controls = 'button, a[href], input, [role=radio]';
async function smallTargets(scope: Locator) {
  return scope.locator(controls).evaluateAll((elements) => elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === "hidden" || element.closest("[inert]")) return [];
    return box.width >= 43.9 && box.height >= 43.9 ? [] : [`${element.textContent?.trim() || element.getAttribute("aria-label")} ${box.width}×${box.height}`];
  }));
}

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1440, height: 900 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: viewport.width < 1440 });
    test("44 × 44 targets, visible focus and no sideways scroll", async ({ page }) => {
      await open(page, "&stage=ready");
      const section = page.getByTestId("checkout-rules");
      expect(await smallTargets(section)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await products(page).getByRole("radio", { name: "Off" }).focus();
      await page.keyboard.press("ArrowRight");
      const focused = page.locator(":focus");
      await expect(focused).toHaveText("Managers only");
      expect(await focused.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
      await products(page).getByRole("radio", { name: "Managers only" }).click();
      expect(await smallTargets(dialog(page))).toEqual([]);
      const box = await dialog(page).getByRole("button", { name: "Switch to Managers only" }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    });
  });
}

// PR #93 round-1 audit, major 8: the success notice never covers the rollback confirmation on a phone.
test.describe("390px rollback", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("turning a kind Off right after a change takes the second tap at once", async ({ page }) => {
    await open(page, "&stage=ready");
    await products(page).getByRole("radio", { name: "Everyone" }).click();
    await confirmWith(page, "Switch to Everyone", "Desk rehearsal");
    await expect(page.getByTestId("toast")).toHaveText(/Products: Everyone/);
    await products(page).getByRole("radio", { name: "Off" }).click();
    const confirm = dialog(page).getByRole("button", { name: "Switch to Off", exact: true });
    await expect(confirm).toBeVisible();
    // Round 2, blocker 2: Radix leaves the live notice outside its aria-hidden, so the notice itself
    // must step aside while any modal is open, wherever the dialog's buttons land.
    await expect(page.getByTestId("toast").getByText(/Products: Everyone/)).toBeHidden();
    const box = (await confirm.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid=rules-dialog]") !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit).toBe(true);
    // The auditor's direct tap at the button's centre, not a click that waits for actionability.
    const started = Date.now();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dialog(page)).toHaveCount(0);
    await expect(products(page).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    expect(Date.now() - started).toBeLessThan(2000);
    // The rule really changed on the server, and its notice returns once the dialog is gone.
    await expect(page.getByTestId("toast")).toHaveText(/Products: Off/);
    expect(await page.evaluate(() => (window as unknown as { fixture: { switches(): Record<string, string> } }).fixture.switches().products)).toBe("off");
  });
});

// Minor: a fine-pointer desktop gets the same 44 px chips and Close in the confirmation.
test.describe("1440px fine pointer", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  test("the confirmation's reason chips and Close are 44 px", async ({ page }) => {
    await open(page, "&stage=ready");
    await products(page).getByRole("radio", { name: "Managers only" }).click();
    expect(await smallTargets(dialog(page))).toEqual([]);
    const close = (await dialog(page).getByRole("button", { name: "Close" }).boundingBox())!;
    expect(Math.round(close.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(close.height)).toBeGreaterThanOrEqual(44);
  });
});
