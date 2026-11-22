import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { TaskCounter, UX_VIEWPORTS, controlsOnScreen, needsScroll, type UxViewport } from "./helpers/ux-census";

/*
 * P3 · Pay panel: the counts the plan sets (docs/plans/ux-simplification-plan.md), measured the way
 * the click audit did, at iPad landscape and phone size. On a phone, opening the order sheet
 * ("View order") is the one extra tap the plan allows, so it is not counted.
 *   cash panel controls   9 → 5 (Change, Cash received, two note chips, Confirm)
 *   exact cash sale       4 → 3 taps (item, Cash, Confirm)
 *   ฿1,500 handed over    4 taps (item, Cash, ฿1,500, Confirm), no sums: the button says the change
 *   split payment         5 → 3 taps (Split payment, Card, Confirm) and the one typed amount
 *   split panel controls  17 → 13: its own method chips replace the tender row, with one Back
 *   exact cash on a phone 4 → 3 taps: the bottom bar's "Cash ฿X" opens the cash panel, prefilled
 */

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(300);
}

/** The order panel: beside the catalog on iPad, in the bottom sheet on a phone (not counted). */
async function orderPanel(page: Page, size: UxViewport): Promise<Locator> {
  if (size === "ipad") return page.getByRole("complementary", { name: "Order", exact: true });
  await page.getByRole("button", { name: /open the order/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

const receipt = (page: Page) => page.getByRole("article", { name: "Receipt", includeHidden: true });

for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
  test.describe(size, () => {
    test.use({ viewport: UX_VIEWPORTS[size] });

    test("the cash panel opens at the amount due with 6 controls and at most one sentence", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
      const cash = panel.getByRole("group", { name: "Cash payment" });
      await expect(cash.getByLabel("Cash received")).toHaveValue("1,200");
      await expect(cash.getByRole("button", { name: "Confirm cash · ฿1,200 received · no change" })).toBeEnabled();
      await expect(cash.getByRole("group", { name: "Notes handed over" }).getByRole("button")).toHaveText(["Exact", "฿1,500", "฿2,000"]);
      await expect(cash.getByText("Received now")).toBeVisible();
      expect(await controlsOnScreen(page, cash)).toBe(6);
      for (const gone of ["+฿100", "+฿500", "+฿1,000", "Clear", "Back to order"]) {
        await expect(panel.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
      }
      await expectAtMostSentences(panel.getByTestId("pay-panel"), 1);

      // Typing replaces the amount: the field selects it all on focus.
      const field = cash.getByLabel("Cash received");
      await field.click();
      await page.keyboard.type("2500");
      await expect(field).toHaveValue("2500");
      await expect(cash.getByRole("button", { name: "Confirm cash · ฿2,500 received · change ฿1,300" })).toBeEnabled();
      await field.fill("1000");
      await expect(cash.getByRole("button", { name: "Confirm cash", exact: true })).toBeDisabled();
      await expect(cash.locator('[role="status"]')).toHaveText("Short฿200");
    });

    test("each tender and split keep the pay panel to one sentence", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "Card", exact: true }).click();
      const pay = panel.getByTestId("pay-panel");
      for (const tender of ["PromptPay", "Card", "Transfer"]) {
        await pay.getByRole("button", { name: tender, exact: true }).click();
        await expect(pay.getByRole("button", { name: tender, exact: true })).toHaveAttribute("aria-pressed", "true");
        await expectAtMostSentences(pay, 1);
      }
      // The tender row's names fit on one line each.
      for (const tender of ["Cash", "PromptPay", "Card", "Transfer"]) {
        const lines = await pay.getByRole("group", { name: "Take payment by" }).getByRole("button", { name: tender, exact: true })
          .evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          });
        expect(lines, `${tender} on one line`).toBeLessThanOrEqual(1);
      }
      await pay.getByRole("button", { name: "Split payment", exact: true }).click();
      await expectAtMostSentences(pay, 2);
    });

    test("split keeps single tenders one tap away and Order returns to the items", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "Split payment", exact: true }).click();
      const pay = panel.getByTestId("pay-panel");
      await panel.getByRole("button", { name: "Order", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Split payment", exact: true })).toBeFocused();
      await panel.getByRole("button", { name: "Split payment", exact: true }).click();
      await expect(pay.getByRole("radiogroup", { name: "Payment 1 method" })).toBeVisible();
      const tenders = pay.getByRole("group", { name: "Take payment by" });
      await tenders.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
      await expect(pay.getByLabel("Cash received")).toHaveValue("1,200");
      await panel.getByRole("button", { name: "Order", exact: true }).click();
      await expect(pay).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toBeFocused();
    });

    test("exact cash sale: 3 taps (item, Cash, Confirm)", async ({ page }) => {
      await open(page, "?role=cashier");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: /^Thai massage 60.*Add to order/ }), "Thai massage 60");
      const panel = await orderPanel(page, size);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await count.tap(panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }), "Cash");
      await count.tap(panel.getByRole("button", { name: "Confirm cash · ฿1,200 received · no change" }), "Confirm");
      await expect(page.getByRole("heading", { name: /^Receipt R-/ })).toBeVisible();
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });
    });

    test("cash with ฿1,500 handed over: 4 taps, and the button says the change", async ({ page }) => {
      await open(page, "?role=cashier");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: /^Thai massage 60.*Add to order/ }), "Thai massage 60");
      const panel = await orderPanel(page, size);
      await count.tap(panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }), "Cash");
      await count.tap(panel.getByRole("button", { name: "฿1,500", exact: true }), "฿1,500");
      const amountField = panel.getByLabel("Cash received");
      await expect(amountField).toBeVisible();
      await expect(amountField).toHaveValue("1,500");
      const amountBox = await amountField.boundingBox();
      expect(amountBox!.height, "cash entry stays rendered after a note shortcut").toBeGreaterThanOrEqual(56);
      await count.tap(panel.getByRole("button", { name: "Confirm cash · ฿1,500 received · change ฿300" }), "Confirm");
      await expect(page.getByRole("heading", { name: /^Receipt R-/ })).toBeVisible();
      await expect(receipt(page)).toContainText("฿1,500");
      await expect(receipt(page)).toContainText("฿300");
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 4, typed: 0, scrolls: 0 });
    });

    test("split payment: 3 taps and one typed amount; the last row takes the rest", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      const count = new TaskCounter();
      await count.tap(panel.getByRole("button", { name: "Split payment", exact: true }), "Split payment");
      for (const method of await panel.getByRole("radiogroup", { name: "Payment 2 method" }).getByRole("radio").all()) {
        const width = await method.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect(width.scroll, "split method label fits its segment").toBeLessThanOrEqual(width.client + 1);
      }
      await count.tap(panel.getByRole("radiogroup", { name: "Payment 2 method" }).getByRole("radio", { name: "Card", exact: true }), "Card");
      await count.type(panel.getByLabel("Payment 1 amount"), "500", "cash amount");
      await expect(panel.getByTestId("split-remaining")).toHaveText("Covered · ฿1,200 in 2 payments");
      await expectAtMostSentences(panel.getByTestId("pay-panel"), 1);
      await count.tap(panel.getByRole("button", { name: "Confirm ฿500 cash + ฿700 card" }), "Confirm");
      await expect(page.getByRole("heading", { name: /^Receipt R-/ })).toBeVisible();
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 3, typed: 1, scrolls: 0 });
    });

    test("the selected tender stays open; Order and Escape return to the items", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
      const pay = panel.getByTestId("pay-panel");
      // Another tender switches.
      await pay.getByRole("button", { name: "Card", exact: true }).click();
      await expect(pay.getByRole("button", { name: "Confirm ฿1,200 card" })).toBeVisible();
      // The active tender keeps the payment open; Order is the explicit way back.
      await pay.getByRole("button", { name: "Card", exact: true }).click();
      await expect(pay).toBeVisible();
      await panel.getByRole("button", { name: "Order", exact: true }).click();
      await expect(pay).toHaveCount(0);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeFocused();

      // Keyboard: Enter opens Cash, focus starts on it, Escape leaves (the phone sheet stays open).
      await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).press("Enter");
      await expect(pay.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(pay).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toBeFocused();
    });
  });
}

/*
 * The approver's phone order sheet inside the real admin shell (admin-shell-fixture.tsx): the
 * header stays visible, so the sheet is the screen less the header, a little shorter than 94dvh.
 * The pay panel and its Confirm still fit, and stay reachable.
 */
for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`approver's phone sheet in the admin shell ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    async function openSheet(page: Page) {
      await page.goto("/tests/browser/admin-shell.html?role=manager&path=/admin/checkout&pending=0");
      await page.locator("header h1").waitFor();
      await page.getByRole("button", { name: /^View order/ }).click();
      const sheet = page.getByRole("dialog", { name: "Order #1043" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(400);
      const box = (await sheet.boundingBox())!;
      const header = (await page.locator("header").first().boundingBox())!;
      // Under the header, to the bottom of the screen: shorter than the cashier's 94dvh.
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(box.height).toBeLessThan(viewport.height * 0.94);
      return sheet;
    }

    /** On screen, inside the sheet, and the topmost element where a finger lands. */
    async function expectTappable(page: Page, sheet: Locator, target: Locator, label: string) {
      await expect(target, label).toBeVisible();
      const box = (await target.boundingBox())!;
      const frame = (await sheet.boundingBox())!;
      expect.soft(box.y, `${label} top`).toBeGreaterThanOrEqual(frame.y - 0.5);
      expect.soft(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(Math.min(frame.y + frame.height, viewport.height) + 0.5);
      const hit = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(top && (el === top || el.contains(top)));
      });
      expect.soft(hit, `${label} is not covered`).toBe(true);
    }

    test("cash fits with Confirm in view, no scroll", async ({ page }) => {
      const sheet = await openSheet(page);
      await sheet.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
      const confirm = sheet.getByRole("button", { name: /^Confirm cash · ฿[\d,]+ received · no change$/ });
      expect(await needsScroll(confirm), "Confirm needs no scroll").toBe(false);
      await expectTappable(page, sheet, confirm, "Confirm cash");
      for (const name of ["Cash", "Split payment"]) await expectTappable(page, sheet, sheet.getByRole("button", { name, exact: true }), name);
      await expectTappable(page, sheet, sheet.getByRole("group", { name: "Notes handed over" }).getByRole("button").last(), "last note chip");
      if (process.env.CAPTURE_SCREENSHOTS === "1") await page.screenshot({ path: `test-results/ux-p3-shell-${viewport.width}x${viewport.height}-cash.png` });
    });

    test("split and card stay reachable", async ({ page }) => {
      const sheet = await openSheet(page);
      await sheet.getByRole("button", { name: "Split payment", exact: true }).click();
      await sheet.getByLabel("Payment 1 amount").fill("500");
      const confirm = sheet.getByRole("button", { name: /^Confirm ฿500 cash \+ ฿[\d,]+ PromptPay$/ });
      await confirm.scrollIntoViewIfNeeded();
      await expectTappable(page, sheet, confirm, "Confirm split");
      if (process.env.CAPTURE_SCREENSHOTS === "1") await page.screenshot({ path: `test-results/ux-p3-shell-${viewport.width}x${viewport.height}-split.png` });

      // Splitting shows Back instead of the tender row; the order's tenders are one tap behind it.
      await sheet.getByRole("group", { name: "Take payment by" }).getByRole("button", { name: "Card", exact: true }).click();
      const card = sheet.getByRole("button", { name: /^Confirm ฿[\d,.]+ card$/ });
      expect(await needsScroll(card), "Confirm card needs no scroll").toBe(false);
      await expectTappable(page, sheet, card, "Confirm card");
    });
  });
}

test.describe("phone bottom bar", () => {
  test.use({ viewport: UX_VIEWPORTS.phone });

  test("exact cash: 3 taps (item, Cash ฿1,200 on the bar, Confirm); Confirm is still required", async ({ page }) => {
    await open(page, "?role=cashier");
    const bar = page.getByTestId("bar-cash");
    // Nothing to pay yet: the bar is View order only.
    await expect(bar).toHaveCount(0);
    const count = new TaskCounter();
    await count.tap(page.getByRole("button", { name: /^Thai massage 60.*Add to order/ }), "Thai massage 60");
    await expect(bar).toHaveAccessibleName("Cash ฿1,200");
    await expect(page.getByRole("button", { name: /^View order 1 item · .*open the order$/ })).toBeVisible();
    await count.tap(bar, "Cash ฿1,200");
    const sheet = page.getByRole("dialog");
    const cash = sheet.getByRole("group", { name: "Cash payment" });
    await expect(cash.getByLabel("Cash received")).toHaveValue("1,200");
    // Opening the sheet records nothing: the order is still unpaid until Confirm.
    await expect(receipt(page)).toHaveCount(0);
    await count.tap(cash.getByRole("button", { name: "Confirm cash · ฿1,200 received · no change" }), "Confirm");
    await expect(page.getByRole("heading", { name: /^Receipt R-/ })).toBeVisible();
    expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });
  });

  test("Cash leaves the bar while the order can't be paid", async ({ page }) => {
    await open(page, "?role=cashier&scenario=spa");
    await expect(page.getByTestId("bar-cash")).toBeVisible();
    await page.getByRole("button", { name: /open the order/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /^Thai massage 60/ }).click();
    await sheet.getByRole("textbox", { name: "Discount" }).fill("15%");
    const ask = sheet.getByRole("group", { name: "Ask a manager" });
    await ask.getByRole("button", { name: "Service delay" }).click();
    await ask.getByRole("button", { name: "Send 15% (฿180) to manager" }).click();
    await sheet.getByRole("button", { name: "Close order", exact: true }).click();
    // A request is waiting for a manager: settleOrder would refuse, so the bar offers no Cash.
    await expect(page.getByTestId("bar-cash")).toHaveCount(0);
  });
});
