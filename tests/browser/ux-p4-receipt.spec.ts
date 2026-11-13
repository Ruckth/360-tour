import { expect, test, type Page } from "@playwright/test";
import { receiptCensus } from "./helpers/receipt-census";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { TaskCounter, UX_VIEWPORTS, controlsOnScreen, type UxViewport } from "./helpers/ux-census";

/*
 * P4 · Receipt: the counts the plan sets (docs/plans/ux-simplification-plan.md), measured the way
 * the click audit did, at iPad landscape and phone size, on the staff-roles fixture: a ฿1,800
 * receipt (Thai massage 60 ฿1,200 + Foot spa 45 ฿600) paid by card.
 *   words outside the paper     ~100 → ≤ 25
 *   side column blocks          9 → ≤ 3
 *   refund one line             3 taps (Refund, a reason chip, Record refund ฿600), 0 typed, 0 scrolls
 *   correct the payment method  5 taps (⋯, Correct payment, method, reason chip, Save), 0 typed, 0 scrolls, ≤ 7 controls
 *   print on 58 mm              3 taps the first time (⋯, Use 58 mm paper, Print), then 1
 *   link the only appointment   the review opens at once: Link, a reason chip, Confirm link
 */

async function open(page: Page, query: string, fixture = "staff-roles") {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await receipt(page).waitFor();
  await page.waitForTimeout(300);
}
const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });
const side = (page: Page) => page.getByTestId("receipt-side");
const view = (page: Page) => page.getByTestId("receipt-view");
const more = (page: Page) => page.getByRole("button", { name: "More receipt actions" });
const result = (count: TaskCounter) => ({ taps: count.taps, typed: count.typed, scrolls: count.scrolls });

for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
  test.describe(size, () => {
    test.use({ viewport: UX_VIEWPORTS[size] });

    for (const role of ["manager", "cashier"] as const) {
      test(`${role}: Print · Share · New sale, ≤ 25 words outside the paper, ≤ 3 side blocks, one sentence`, async ({ page }) => {
        await open(page, `?role=${role}&scenario=refund`);
        const toolbar = page.getByRole("toolbar", { name: "Receipt actions" });
        await expect(toolbar.getByRole("button")).toHaveText(["Print", "Share", "New sale", ""]);
        // One row, ⋯ included, at both sizes.
        const tops = await toolbar.getByRole("button").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
        expect(Math.max(...tops) - Math.min(...tops), "toolbar on one row").toBeLessThanOrEqual(2);
        for (const gone of ["Checkout", "Copy receipt", "58 mm", "80 mm", "Void…", "Correct payment recording", "No money was received…"]) {
          await expect(page.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
        }
        await expect(page.getByRole("region", { name: "After payment" })).toHaveCount(0);
        await expect(page.getByText("Printing tips")).toHaveCount(0);
        const counts = await receiptCensus(page);
        expect(counts.wordsOutsidePaper, "words outside the paper").toBeLessThanOrEqual(25);
        expect(counts.sideBlocks, "side column blocks").toBeLessThanOrEqual(3);
        await expectAtMostSentences(view(page), 1);
        // Cashiers don't get History, or links their rules don't let them make.
        await expect(page.getByTestId("receipt-history")).toHaveCount(role === "cashier" ? 0 : 1);
        await expect(receipt(page).getByRole("button", { name: "Link appointment" })).toHaveCount(role === "cashier" ? 0 : 2);
      });
    }

    test("refund one line: 3 taps, nothing typed, no scroll, and the result shows under its line", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      const count = new TaskCounter();
      await count.tap(receipt(page).getByRole("button", { name: "Refund Foot spa 45" }), "Refund Foot spa 45");
      const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
      await expect(form.getByRole("button", { name: "All ฿600" })).toHaveAttribute("aria-pressed", "true");
      await expectAtMostSentences(view(page), 1);
      await count.tap(form.getByRole("button", { name: "Shortened treatment" }), "reason chip");
      await count.tap(form.getByRole("button", { name: "Record refund ฿600" }), "Record refund ฿600");
      const note = receipt(page).locator("[data-line-note]");
      await expect(note).toHaveText("Refunded ฿600 · Shortened treatment");
      await expect(note).toBeFocused();
      await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿600");
      expect(result(count), count.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });
    });

    test("Half sets half of what is left, and the button says the money", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await receipt(page).getByRole("button", { name: "Refund Thai massage 60" }).click();
      const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
      await form.getByRole("button", { name: "Half ฿600" }).click();
      await expect(form.getByRole("textbox", { name: "Amount (฿)" })).toHaveValue("600");
      await form.getByRole("button", { name: "Guest complaint" }).click();
      await form.getByRole("button", { name: "Record refund ฿600" }).click();
      await expect(receipt(page).locator("[data-line-note]")).toHaveText("Refunded ฿600 · Guest complaint");
      // What is left is ฿600: All and Half follow it.
      await receipt(page).getByRole("button", { name: "Refund Thai massage 60" }).click();
      await expect(form.getByRole("button", { name: "All ฿600" })).toHaveAttribute("aria-pressed", "true");
      await expect(form.getByRole("button", { name: "Half ฿300" })).toBeVisible();
    });

    test("a cashier's refund request names the money and waits on the bar", async ({ page }) => {
      await open(page, "?role=cashier&scenario=refund");
      await receipt(page).getByRole("button", { name: "Refund Foot spa 45" }).click();
      const form = receipt(page).getByRole("form", { name: "Ask a manager", exact: true });
      await form.getByRole("button", { name: "Shortened treatment" }).click();
      await form.getByRole("button", { name: "Send refund ฿600 to manager" }).click();
      await expect(receipt(page).locator("[data-line-note]")).toHaveText("Sent to a manager · refund ฿600 · Shortened treatment");
      const bar = side(page).locator('[data-approval-status="pending"]');
      await expect(bar).toContainText("Waiting for a manager · refund ฿600 · Foot spa 45");
      // The cashier who asked can cancel; only approvers decide.
      await expect(bar.getByRole("button", { name: "Approve" })).toHaveCount(0);
    });

    test("approvers approve right on the Waiting for a manager bar", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund-pending");
      const bar = side(page).locator('[data-approval-status="pending"]');
      await expect(bar).toContainText("Waiting for a manager · refund ฿300 · Thai massage 60");
      await expectAtMostSentences(view(page), 1);
      expect((await receiptCensus(page)).sideBlocks).toBeLessThanOrEqual(3);
      await bar.getByRole("button", { name: "Approve" }).click();
      await expect(side(page).locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
      await expect(receipt(page).getByTestId("receipt-refunded")).toHaveText("Refunded-฿300");
    });

    test("correct the payment method: 5 taps, nothing typed, no scroll, at most 7 controls", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      const count = new TaskCounter();
      await count.tap(more(page), "⋯");
      await count.tap(page.getByRole("menuitem", { name: "Correct payment" }), "Correct payment");
      const form = page.getByTestId("correct-payment");
      await expect(form.getByRole("heading", { name: "Correct payment" })).toBeFocused();
      expect(await controlsOnScreen(page, form), "correction controls").toBeLessThanOrEqual(7);
      await expect(form.getByLabel("Received at · Bangkok time")).toBeHidden();
      await expectAtMostSentences(view(page), 1);
      await count.tap(form.getByRole("button", { name: "PromptPay QR", exact: true }), "PromptPay QR");
      await count.tap(form.getByRole("button", { name: "Wrong method picked" }), "reason chip");
      await count.tap(form.getByRole("button", { name: "Save · PromptPay QR ฿1,800" }), "Save");
      await expect(form).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "Payment corrected · PromptPay QR ฿1,800" })).toBeVisible();
      await expect(page.getByText("Order #1043 · ฿1,800 · Paid by card · corrected")).toBeVisible();
      // The issued receipt keeps its tender.
      await expect(receipt(page)).toContainText("Card");
      await expect(receipt(page)).not.toContainText("PromptPay");
      expect(result(count), count.log.join("\n")).toEqual({ taps: 5, typed: 0, scrolls: 0 });
    });

    test("More holds the received date, the amount, another tender, the customer and an own reason", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await more(page).click();
      await page.getByRole("menuitem", { name: "Correct payment" }).click();
      const form = page.getByTestId("correct-payment");
      await form.getByText("More", { exact: true }).click();
      await expect(form.getByLabel("Received at · Bangkok time")).toBeVisible();
      await expect(form.getByRole("textbox", { name: "Corrected payment 1 amount" })).toHaveValue("1800");
      await expect(form.getByRole("button", { name: "Add another tender" })).toBeVisible();
      await expect(form.getByLabel("Customer")).toBeVisible();
      await form.getByRole("textbox", { name: "Own reason" }).fill("Guest paid by QR at the desk");
      await expect(form.getByRole("button", { name: "Save correction" })).toBeEnabled();
      await expectAtMostSentences(view(page), 1);
      // Close puts the ⋯ back; nothing was saved.
      await page.getByRole("button", { name: "Close Correct payment" }).click();
      await expect(form).toHaveCount(0);
      await expect(more(page)).toBeFocused();
      await expect(page.getByText("· corrected")).toHaveCount(0);
    });

    test("print on 58 mm: 3 taps the first time, then 1", async ({ page }) => {
      await page.addInitScript(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed += 1; }; });
      await open(page, "?role=manager&scenario=refund");
      const pageSize = () => page.evaluate(() => {
        const sizes: string[] = [];
        const walk = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSPageRule) sizes.push(rule.style.getPropertyValue("size"));
            else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
          }
        };
        for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
        return sizes.filter(Boolean)[0]?.split(" ")[0];
      });
      expect(await pageSize()).toBe("80mm");
      const first = new TaskCounter();
      await first.tap(more(page), "⋯");
      await first.tap(page.getByRole("menuitem", { name: "Use 58 mm paper" }), "Use 58 mm paper");
      await expect(page.getByRole("status").filter({ hasText: "Prints on 58 mm paper · remembered on this device" })).toBeVisible();
      await first.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      expect(await pageSize()).toBe("58mm");
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      expect(result(first), first.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });

      // The next receipt on this device: 58 mm already.
      await open(page, "?role=manager&scenario=refund");
      expect(await pageSize()).toBe("58mm");
      const next = new TaskCounter();
      await next.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      expect(result(next)).toEqual({ taps: 1, typed: 0, scrolls: 0 });
      await more(page).click();
      await expect(page.getByRole("menuitem", { name: "Use 80 mm paper" })).toBeVisible();
    });

    test("Share copies the receipt where the device can't share", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, "share"); });
      await open(page, "?role=manager&scenario=refund");
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Receipt copied." })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Foot spa 45");
    });

    test("one Void… asks whether money was received, with no default; Yes voids the sale", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await more(page).click();
      await page.getByRole("menuitem", { name: "Void…" }).click();
      const panel = page.getByTestId("void-panel");
      const yes = panel.locator('[data-void-choice="received"]');
      const no = panel.locator('[data-void-choice="unreceived"]');
      await expect(panel.getByText("Was money received?")).toBeVisible();
      await expect(yes).toHaveText("YesVoid the sale · no refund sent");
      await expect(no).toHaveText("NoEntered by mistake · nothing was received");
      // No answer is picked for them, and neither runs without a reason.
      await expect(yes).toBeDisabled();
      await expect(no).toBeDisabled();
      await expectAtMostSentences(view(page), 1);
      await panel.getByRole("button", { name: "Wrong guest" }).click();
      await expect(yes).toBeEnabled();
      await yes.click();
      await expect(page.getByRole("status").filter({ hasText: "Sale voided · no refund sent" })).toBeVisible();
      await expect(receipt(page)).toContainText("Void · Wrong guest");
      await expect(page.getByTestId("receipt-void-status")).not.toContainText("Entered by mistake");
      await expectAtMostSentences(view(page), 1);
    });

    test("with an attached appointment, each choice says what happens to its booking", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund&attached=1");
      await more(page).click();
      await page.getByRole("menuitem", { name: "Void…" }).click();
      const panel = page.getByTestId("void-panel");
      await expect(panel.locator('[data-void-choice="received"]')).toHaveText("YesVoid the sale · booking stays paid");
      await expect(panel.locator('[data-void-choice="unreceived"]')).toHaveText("NoEntered by mistake · balance reopens ฿1,600");
    });

    test("Void… · No voids it as entered by mistake", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await more(page).click();
      await page.getByRole("menuitem", { name: "Void…" }).click();
      const panel = page.getByTestId("void-panel");
      await panel.getByRole("button", { name: "Duplicate sale" }).click();
      await panel.locator('[data-void-choice="unreceived"]').click();
      await expect(page.getByRole("status").filter({ hasText: "Entered by mistake · voided, nothing received" })).toBeVisible();
      await expect(page.getByTestId("receipt-void-status")).toContainText("Entered by mistake · no money was received, no refund sent");
    });

    test("Void… is off once the receipt has a refund", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await receipt(page).getByRole("button", { name: "Refund Foot spa 45" }).click();
      await receipt(page).getByRole("button", { name: "Charged by mistake" }).click();
      await receipt(page).getByRole("button", { name: "Record refund ฿600" }).click();
      await expect(receipt(page).locator("[data-line-note]")).toBeVisible();
      await more(page).click();
      await expect(page.getByRole("menuitem", { name: "Void… · not after a refund" })).toHaveAttribute("aria-disabled", "true");
    });

    test("History is one closed section with Items · Payments · Refunds, one sentence at most", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      const history = page.getByTestId("receipt-history");
      await expect(history.getByRole("tablist")).toHaveCount(0);
      await history.getByText("History", { exact: true }).click();
      const tabs = history.getByRole("tab");
      await expect(tabs).toHaveText(["Items", "Payments", "Refunds"]);
      await expect(history.getByRole("region", { name: "Order history" })).toBeVisible();
      await expectAtMostSentences(view(page), 1);
      await tabs.nth(1).click();
      await expect(history.getByRole("region", { name: "Payment record" })).toContainText("As on the receipt");
      await expect(history.getByRole("region", { name: "Payment corrections" })).toBeVisible();
      await expectAtMostSentences(view(page), 1);
      await tabs.nth(1).press("ArrowRight");
      await expect(tabs.nth(2)).toBeFocused();
      await expect(history.getByRole("region", { name: "Line refunds" })).toBeVisible();
      await expectAtMostSentences(view(page), 1);
    });
  });
}

test.describe("link after payment", () => {
  for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
    test(`${size}: the only matching appointment opens on its review; Link, chip, Confirm`, async ({ page }) => {
      await page.setViewportSize(UX_VIEWPORTS[size]);
      await open(page, "?scenario=unscheduled-paid", "checkout");
      const count = new TaskCounter();
      await count.tap(receipt(page).getByRole("button", { name: "Link appointment" }), "Link appointment");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("link-review")).toContainText("SVC-0002");
      await count.tap(dialog.getByRole("button", { name: "Guest asked" }), "reason chip");
      await count.tap(dialog.getByRole("button", { name: "Confirm link" }), "Confirm link");
      await expect(receipt(page).getByTestId("line-link")).toHaveText("Linked · SVC-0002");
      // Back still lists every candidate, the plan's escape hatch.
      expect(result(count), count.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });
    });
  }

  test("Back from the review shows the list", async ({ page }) => {
    await open(page, "?scenario=unscheduled-paid", "checkout");
    await receipt(page).getByRole("button", { name: "Link appointment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByTestId("link-candidate").filter({ hasText: "SVC-0002" })).toBeVisible();
  });
});
