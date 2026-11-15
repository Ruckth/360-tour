import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

for (const width of [390, 1180, 1440]) {
  test.describe(`${width}px checkout round 4`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width !== 1440, isMobile: width !== 1440 });

    test("refund tracks fit without wrapping or clipping and keep the order context", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
      const form = page.getByRole("form", { name: "Refund", exact: true });
      await expect(form.getByText("Order #1043 · Foot spa 45", { exact: true })).toBeVisible();
      for (const name of ["Refund to", "Quick reason"]) {
        const track = form.getByRole("radiogroup", { name, exact: true });
        const radios = track.getByRole("radio");
        await expect(radios).toHaveCount(name === "Refund to" ? 5 : 3);
        const geometry = await radios.evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          return { y: rect.y, left: rect.left, right: rect.right, textLeft: text.left, textRight: text.right, textHeight: text.height, height: rect.height };
        }));
        expect(new Set(geometry.map((box) => Math.round(box.y))).size).toBe(1);
        for (const box of geometry) {
          expect(box.textLeft).toBeGreaterThanOrEqual(box.left);
          expect(box.textRight).toBeLessThanOrEqual(box.right);
          expect(box.textHeight).toBeLessThan(25);
        }
      }
      const submit = form.getByRole("button", { name: "Pick a reason", exact: true });
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await form.getByRole("radio", { name: "Wrong charge", exact: true }).click();
      await expect(form.getByRole("button", { name: "Record refund ฿600", exact: true })).toBeEnabled();
      // Re-selecting All after typing the full amount restores its live remaining-amount default.
      await form.getByLabel("Amount (฿)", { exact: true }).fill("600");
      await form.getByRole("radio", { name: "All", exact: true }).click();
      await page.evaluate(async () => { await window.fixture.refundFromAnotherTill("Foot spa 45", 10_000); await window.fixture.setRole("manager"); });
      await expect(form.getByLabel("Amount (฿)", { exact: true })).toHaveValue("500");
      await expect(form.getByRole("button", { name: "Record refund ฿500", exact: true })).toBeEnabled();
    });

    test("the single-preset amount row fills its track when Half is unavailable", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await page.evaluate(async () => { await window.fixture.refundFromAnotherTill("Foot spa 45", 59_999); await window.fixture.setRole("manager"); });
      await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
      const form = page.getByRole("form", { name: "Refund", exact: true });
      await expect(form.getByRole("radio", { name: "Half", exact: true })).toHaveCount(0);
      const all = form.getByRole("radio", { name: "All", exact: true });
      await expect(all).toBeChecked();
      const amount = form.getByLabel("Amount (฿)", { exact: true });
      await expect(amount).toHaveValue("0.01");
      const row = await form.getByRole("group", { name: "Refund amount", exact: true }).boundingBox();
      const field = await amount.boundingBox();
      expect(field!.x + field!.width).toBeCloseTo(row!.x + row!.width, 0);
      expect((await all.boundingBox())!.width).toBeGreaterThan(row!.width / 2);
    });

    test("History stays compact and lazy, and split amounts share currency and number alignment", async ({ page }) => {
      // A saved order may predate recorded changes; offer a compact lazy disclosure.
      await open(page, "?role=cashier");
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      const description = page.getByText("Open orders on every till. Look up today's receipts by order number.", { exact: true });
      const lastLineWords = await description.evaluate((element) => {
        const node = element.firstChild!;
        const words = [...node.textContent!.matchAll(/\S+/g)].map((word) => {
          const range = document.createRange();
          range.setStart(node, word.index!);
          range.setEnd(node, word.index! + word[0].length);
          return Math.round(range.getBoundingClientRect().top);
        });
        return words.filter((top) => top === words.at(-1)).length;
      });
      expect(lastLineWords, "Orders description has no single-word orphan").toBeGreaterThanOrEqual(2);
      await page.getByRole("list", { name: "Open orders", exact: true }).getByRole("button", { name: /^Order #1042/ }).click();
      if (width === 390) await page.getByRole("button", { name: /open the order/ }).click();
      const panel = width === 390 ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
      const history = panel.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^History$/ }) });
      await expect(history).not.toHaveAttribute('open', '');
      expect((await history.boundingBox())!.height, 'no empty band under the collapsed row').toBeLessThanOrEqual(45);
      await expect(history.getByRole('region', { name: 'Order history' })).toHaveCount(0);
      await history.locator('summary').click();
      await expect(history.getByText('No recorded item changes.', { exact: true })).toBeVisible();
      await open(page, "?role=cashier&scenario=spa");
      if (width === 390) await page.getByRole("button", { name: /open the order/ }).click();
      const split = panel.getByRole("button", { name: "Split payment", exact: true });
      await expect(split).toHaveText("Split");
      await split.click();
      await panel.getByLabel("Payment 1 amount", { exact: true }).fill("500");
      await expect(panel.getByRole("heading", { name: "Payment 2 · rest", exact: true })).toBeVisible();
      const first = panel.getByLabel("Payment 1 amount", { exact: true });
      const last = panel.getByLabel("Payment 2 amount", { exact: true });
      await expect(last).toHaveText("฿700");
      const firstBox = (await first.boundingBox())!;
      const lastBox = (await last.boundingBox())!;
      expect(lastBox.x).toBeCloseTo(firstBox.x, 0);
      expect(lastBox.width).toBeCloseTo(firstBox.width, 0);
      for (const field of [first, last]) await expect(field.locator("..").getByText("฿", { exact: true })).toBeVisible();
      await expect(panel.getByTestId("split-remaining")).toContainText("Covered · ฿1,200 in 2 payments");
    });

    test("approvals focus the title and use the phone bottom-sheet geometry", async ({ page }) => {
      await open(page, "?role=manager&scenario=pending");
      await page.getByTestId("approvals-button").click();
      const panel = page.getByRole("dialog", { name: "Approvals", exact: true });
      await expect(panel.getByRole("heading", { name: "Approvals", exact: true })).toBeFocused();
      await expect(panel.getByTestId("approval-request").first()).toContainText("Thai massage 60 · Order #1043");
      if (width === 390) {
        const box = (await panel.boundingBox())!;
        expect(box.x).toBe(0);
        expect(box.width).toBe(width);
        expect(box.y + box.height).toBeCloseTo(844, 0);
      }
      const tip = panel.getByTestId("approval-request").first().getByRole("button", { name: "About approvals", exact: true });
      if (width !== 1440) {
        const gap = await tip.evaluate((button) => {
          const range = document.createRange();
          range.selectNode(button.parentElement!.firstChild!);
          return button.querySelector("svg")!.getBoundingClientRect().left - range.getBoundingClientRect().right;
        });
        expect(gap).toBeLessThanOrEqual(12);
      }
      await tip.click();
      await expect(page.getByRole("tooltip")).toContainText("Works once, for this order as it is now.");
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await expect(panel).toHaveCount(0);
    });
  });
}
