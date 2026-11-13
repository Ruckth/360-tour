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

const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });

for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
  test.describe(size, () => {
    test.use({ viewport: UX_VIEWPORTS[size] });

    test("the cash panel opens at the amount due with 5 controls and at most one sentence", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "Cash", exact: true }).click();
      const cash = panel.getByRole("group", { name: "Cash payment" });
      await expect(cash.getByLabel("Cash received")).toHaveValue("1200");
      await expect(cash.getByRole("button", { name: "Confirm cash ฿1,200 · no change" })).toBeEnabled();
      await expect(cash.getByRole("group", { name: "Notes handed over" }).getByRole("button")).toHaveText(["฿1,500", "฿2,000"]);
      await expect(cash.getByText("Received now")).toBeVisible();
      expect(await controlsOnScreen(page, cash)).toBe(5);
      for (const gone of ["Exact", "+฿100", "+฿500", "+฿1,000", "Clear", "Back to order"]) {
        await expect(panel.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
      }
      await expectAtMostSentences(panel.getByTestId("pay-panel"), 1);

      // Typing replaces the amount: the field selects it all on focus.
      const field = cash.getByLabel("Cash received");
      await field.click();
      await page.keyboard.type("2500");
      await expect(field).toHaveValue("2500");
      await expect(cash.getByRole("button", { name: "Confirm cash ฿2,500 · change ฿1,300" })).toBeEnabled();
      await field.fill("1000");
      await expect(cash.getByRole("button", { name: "Short ฿200" })).toBeDisabled();
    });

    test("each tender and split keep the pay panel to one sentence", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "Card", exact: true }).click();
      for (const tender of ["PromptPay QR", "Card", "Transfer", "Split payment"]) {
        await panel.getByTestId("pay-panel").getByRole("button", { name: tender, exact: true }).click();
        await expect(panel.getByTestId("pay-panel").getByRole("button", { name: tender, exact: true })).toHaveAttribute("aria-pressed", "true");
        await expectAtMostSentences(panel.getByTestId("pay-panel"), 1);
      }
    });

    test("exact cash sale: 3 taps (item, Cash, Confirm)", async ({ page }) => {
      await open(page, "?role=cashier");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: /^Thai massage 60.*Add to order/ }), "Thai massage 60");
      const panel = await orderPanel(page, size);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await count.tap(panel.getByRole("button", { name: "Cash", exact: true }), "Cash");
      await count.tap(panel.getByRole("button", { name: "Confirm cash ฿1,200 · no change" }), "Confirm");
      await expect(receipt(page)).toBeVisible();
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 3, typed: 0, scrolls: 0 });
    });

    test("cash with ฿1,500 handed over: 4 taps, and the button says the change", async ({ page }) => {
      await open(page, "?role=cashier");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: /^Thai massage 60.*Add to order/ }), "Thai massage 60");
      const panel = await orderPanel(page, size);
      await count.tap(panel.getByRole("button", { name: "Cash", exact: true }), "Cash");
      await count.tap(panel.getByRole("button", { name: "฿1,500", exact: true }), "฿1,500");
      await count.tap(panel.getByRole("button", { name: "Confirm cash ฿1,500 · change ฿300" }), "Confirm");
      await expect(receipt(page)).toBeVisible();
      await expect(receipt(page)).toContainText("฿1,500");
      await expect(receipt(page)).toContainText("฿300");
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 4, typed: 0, scrolls: 0 });
    });

    test("split payment: 3 taps and one typed amount; the last row takes the rest", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      const count = new TaskCounter();
      await count.tap(panel.getByRole("button", { name: "Split payment", exact: true }), "Split payment");
      await count.tap(panel.getByRole("group", { name: "Payment 2 method" }).getByRole("button", { name: "Card", exact: true }), "Card");
      await count.type(panel.getByLabel("Payment 1 amount"), "500", "cash amount");
      await expect(panel.getByTestId("split-remaining")).toHaveText("฿700");
      await expectAtMostSentences(panel.getByTestId("pay-panel"), 1);
      await count.tap(panel.getByRole("button", { name: "Confirm ฿500 cash + ฿700 card" }), "Confirm");
      await expect(receipt(page)).toBeVisible();
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 3, typed: 1, scrolls: 0 });
    });

    test("the tender row does Back's job, and Escape leaves the panel from the keyboard", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "Cash", exact: true }).click();
      const pay = panel.getByTestId("pay-panel");
      // Another tender switches.
      await pay.getByRole("button", { name: "Card", exact: true }).click();
      await expect(pay.getByRole("button", { name: "Confirm card ฿1,200" })).toBeVisible();
      // The active one closes, back to the order.
      await pay.getByRole("button", { name: "Card", exact: true }).click();
      await expect(pay).toHaveCount(0);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeFocused();

      // Keyboard: Enter opens Cash, focus starts on it, Escape leaves (the phone sheet stays open).
      await panel.getByRole("button", { name: "Cash", exact: true }).press("Enter");
      await expect(pay.getByRole("button", { name: "Cash", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(pay).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: "Cash", exact: true })).toBeFocused();
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
      await sheet.getByRole("button", { name: "Cash", exact: true }).click();
      const confirm = sheet.getByRole("button", { name: /^Confirm cash ฿[\d,]+ · no change$/ });
      expect(await needsScroll(confirm), "Confirm needs no scroll").toBe(false);
      await expectTappable(page, sheet, confirm, "Confirm cash");
      for (const name of ["Cash", "Split payment"]) await expectTappable(page, sheet, sheet.getByRole("button", { name, exact: true }), name);
      await expectTappable(page, sheet, sheet.getByRole("group", { name: "Notes handed over" }).getByRole("button").last(), "last note chip");
      await page.screenshot({ path: `test-results/ux-p3-shell-${viewport.width}x${viewport.height}-cash.png` });
    });

    test("split and card stay reachable", async ({ page }) => {
      const sheet = await openSheet(page);
      await sheet.getByRole("button", { name: "Split payment", exact: true }).click();
      await sheet.getByLabel("Payment 1 amount").fill("500");
      const confirm = sheet.getByRole("button", { name: /^Confirm ฿500 cash \+ ฿[\d,]+ PromptPay$/ });
      await confirm.scrollIntoViewIfNeeded();
      await expectTappable(page, sheet, confirm, "Confirm split");
      await page.screenshot({ path: `test-results/ux-p3-shell-${viewport.width}x${viewport.height}-split.png` });

      const tenders = sheet.getByRole("group", { name: "Take payment by" });
      await tenders.scrollIntoViewIfNeeded();
      await tenders.getByRole("button", { name: "Card", exact: true }).click();
      const card = sheet.getByRole("button", { name: /^Confirm card ฿/ });
      expect(await needsScroll(card), "Confirm card needs no scroll").toBe(false);
      await expectTappable(page, sheet, card, "Confirm card");
    });
  });
}
