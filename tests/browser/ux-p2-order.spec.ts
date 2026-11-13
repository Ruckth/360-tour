import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { TaskCounter, UX_VIEWPORTS, controlsOnScreen, type UxViewport } from "./helpers/ux-census";

/*
 * P2 · Order panel and catalog: the counts the plan sets (docs/plans/ux-simplification-plan.md),
 * measured the way the click audit did, at iPad landscape and phone size. On a phone, opening the
 * order sheet ("View order") is the one extra tap the plan allows, so it is not counted.
 */

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(300);
}

/** The order panel: beside the catalog on iPad, in the bottom sheet on a phone. */
async function orderPanel(page: Page, size: UxViewport): Promise<Locator> {
  if (size === "ipad") return page.getByRole("complementary", { name: "Order", exact: true });
  await page.getByRole("button", { name: /open the order/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
  test.describe(size, () => {
    test.use({ viewport: UX_VIEWPORTS[size] });

    test("checkout shows at most 22 controls at the start and 30 with a line open", async ({ page }) => {
      await open(page, "?role=cashier");
      expect(await controlsOnScreen(page)).toBeLessThanOrEqual(22);
      await expect(page.getByRole("button", { name: "Filters" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^About / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Frequent/i })).toHaveCount(0);

      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await expectAtMostSentences(panel, 1);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await expect(panel.getByRole("textbox", { name: "Discount" })).toBeInViewport();
      expect(await controlsOnScreen(page)).toBeLessThanOrEqual(30);
      await expect(panel.getByRole("radio", { name: "%" })).toHaveCount(0);
      await expectAtMostSentences(panel, 1);
    });

    test("search finds an item on another tab with no extra taps", async ({ page }) => {
      await open(page, "?role=cashier");
      // A spa service, searched from the Rooms tab (and not in Frequent).
      await page.getByRole("tab", { name: "Rooms", exact: true }).click();
      const count = new TaskCounter();
      await count.type(page.getByRole("searchbox", { name: "Search all items" }), "Thai massage 90", "search");
      await count.tap(page.getByRole("button", { name: /^Thai massage 90.*Add to order/ }), "Thai massage 90 tile");
      expect(count.taps, count.log.join("\n")).toBe(1);
      const panel = await orderPanel(page, size);
      await expect(panel.getByRole("button", { name: /^Thai massage 90/ })).toBeVisible();
    });

    test("no search result offers the query as a custom item", async ({ page }) => {
      await open(page, "?role=cashier");
      await page.getByRole("searchbox", { name: "Search all items" }).fill("Champagne");
      await expect(page.getByText("No item matches “Champagne”.")).toBeVisible();
      await page.getByRole("button", { name: "Add as custom item" }).click();
      await expect(page.getByRole("dialog", { name: "Custom item" }).getByRole("textbox", { name: "Name" })).toHaveValue("Champagne");
    });

    test("over-limit discount to approval: 5 taps, 1 typed, 0 scrolls", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      const count = new TaskCounter();
      await count.tap(panel.getByRole("button", { name: /^Thai massage 60/ }), "row");
      await count.type(panel.getByRole("textbox", { name: "Discount" }), "15%", "discount");
      // Echoed before anything is sent.
      await expect(panel.getByTestId("discount-echo")).toHaveText("15% = ฿180 · Over your 10% limit");
      const ask = panel.getByRole("group", { name: "Ask a manager" });
      await expectAtMostSentences(panel, 1);
      await count.tap(ask.getByRole("button", { name: "Service delay" }), "reason chip");
      await expect(ask.getByRole("textbox", { name: "Reason" })).toHaveValue("Service delay");
      await count.tap(ask.getByRole("button", { name: "Send 15% (฿180) to manager" }), "Send");
      // The request shows in place on the line; nothing on the order changes yet.
      const waiting = panel.locator('[data-approval-status="pending"]');
      await expect(waiting).toHaveCount(1);
      await expect(waiting).toContainText("Waiting for a manager · ฿180 discount");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await expectAtMostSentences(panel, 1);

      await page.evaluate(() => window.fixture.setRole("manager"));
      await page.waitForTimeout(300);
      await count.tap(page.getByTestId("approvals-button"), "Approvals");
      const request = page.getByRole("dialog", { name: "Approvals" }).getByTestId("approval-request");
      await expect(request).toContainText("Mint asks for a ฿180 discount (15%)");
      await expect(request).toContainText("“Service delay”");
      await count.tap(request.getByRole("button", { name: "Approve" }), "Approve");
      await expect(page.getByTestId("toast")).toHaveText("Approved 15% discount on #1043");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,020");

      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 5, typed: 1, scrolls: 0 });
    });

    test("an order with nothing due closes in one tap", async ({ page }) => {
      await open(page, "?role=manager&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await panel.getByRole("textbox", { name: "Discount" }).fill("100%");
      await panel.getByRole("button", { name: "Apply 100% (฿1,200)" }).click();
      await expect(panel.getByTestId("order-due")).toHaveText("฿0");
      const count = new TaskCounter();
      await count.tap(panel.getByRole("button", { name: "Close order · nothing due" }), "Close order");
      await expect(page.getByRole("article", { name: "Receipt" })).toBeVisible();
      expect(count.taps).toBe(1);
    });

    test("Clear and Discard live in the order's ⋯, and Discard names the order first", async ({ page }) => {
      await open(page, "?role=manager&scenario=spa");
      const panel = await orderPanel(page, size);
      await expect(panel.getByRole("button", { name: "Clear order" })).toHaveCount(0);
      await panel.getByRole("button", { name: "More order actions" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Clear order", "Discard order…"]);
      await page.getByRole("menuitem", { name: "Discard order…" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm.getByRole("heading")).toHaveText("Discard order #1043?");
      await confirm.getByRole("button", { name: "Keep" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
    });

    test("a cashier's ⋯ has Clear only", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, size);
      await panel.getByRole("button", { name: "More order actions" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Clear order"]);
    });
  });
}

test.describe("customer dialog", () => {
  test.use({ viewport: UX_VIEWPORTS.ipad });

  test("lists customers to link, with no Details per result and no archived toggle", async ({ page }) => {
    await open(page, "?role=manager");
    await page.getByRole("button", { name: "Add customer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Search customers" }).fill("Anna");
    await expect(dialog.getByRole("list", { name: "Customers" }).getByRole("button")).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: /^View or edit/ })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /archived/ })).toHaveCount(0);
    await expectAtMostSentences(dialog, 1);
  });
});
