import { expect, test, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";
import { TaskCounter, UX_VIEWPORTS, type UxViewport } from "./helpers/ux-census";

/*
 * P2b · Open orders (docs/plans/ux-simplification-plan.md, P2's last bullet): a cashier reopens an
 * earlier open order from a list instead of typing its number, and Save & close is gone.
 *   before: Orders, type the number, Open = 2 taps, 1 typed
 *   after:  Orders, tap the row          = 2 taps, 0 typed
 * The number field stays under the list for today's paid receipts, which the list doesn't show;
 * its path is measured here too, as the before baseline.
 */

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(300);
}

/** The order's name: in the order panel beside the catalog on iPad, in the top strip on a phone. */
const orderTitle = (page: Page, size: UxViewport) =>
  size === "ipad" ? page.getByRole("complementary", { name: "Order", exact: true }).getByTestId("order-panel-title") : page.getByTestId("order-title");

for (const size of Object.keys(UX_VIEWPORTS) as UxViewport[]) {
  test.describe(size, () => {
    test.use({ viewport: UX_VIEWPORTS[size] });

    test("a cashier reopens an earlier open order in 2 taps, 0 typed", async ({ page }) => {
      // On Order #1043; Order #1042 (Somchai, 3 items, ฿780) was started earlier.
      await open(page, "?role=cashier&scenario=spa");
      await expect(orderTitle(page, size)).toHaveText("Order #1043");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: "Orders", exact: true }), "Orders");
      const dialog = page.getByRole("dialog", { name: "Orders" });
      const list = dialog.getByRole("list", { name: "Open orders" });
      await expect(list.getByRole("button")).toHaveCount(2);
      await expect(list.getByRole("listitem").first()).toContainText("Order #1043");
      await expect(list.getByRole("listitem").first().getByText("Current", { exact: true })).toBeVisible();
      const earlier = list.getByRole("button", { name: /^Order #1042/ });
      await expect(earlier.getByText("Somchai Prasert", { exact: true })).toBeVisible();
      await expect(earlier.getByText("3 items", { exact: true })).toBeVisible();
      await expect(earlier.getByText(/^Updated /)).toBeVisible();
      await expect(earlier).toHaveAccessibleName(/^Order #1042, Somchai Prasert, updated .+, 3 items, ฿780 due$/);
      await expect(earlier).toContainText("฿780");
      await expectAtMostSentences(dialog, 2);
      await count.tap(earlier, "Order #1042 row");
      await expect(dialog).toHaveCount(0);
      await expect(orderTitle(page, size)).toHaveText("Order #1042");
      expect({ taps: count.taps, typed: count.typed, scrolls: count.scrolls }, count.log.join("\n")).toEqual({ taps: 2, typed: 0, scrolls: 0 });
    });

    test("before: typing the number took 2 taps and 1 typed field", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      const count = new TaskCounter();
      await count.tap(page.getByRole("button", { name: "Orders", exact: true }), "Orders");
      const dialog = page.getByRole("dialog", { name: "Orders" });
      await count.type(dialog.getByRole("textbox", { name: "Order or receipt number" }), "1042", "order number");
      await count.tap(dialog.getByRole("button", { name: "Go", exact: true }), "Go");
      await expect(orderTitle(page, size)).toHaveText("Order #1042");
      expect({ taps: count.taps, typed: count.typed }, count.log.join("\n")).toEqual({ taps: 2, typed: 1 });
    });

    test("Save & close is gone; New order and Orders leave the order", async ({ page }) => {
      await open(page, "?role=cashier&scenario=spa");
      if (size === "phone") {
        await page.getByRole("button", { name: /open the order/ }).click();
        const sheet = page.getByRole("dialog");
        await expect(sheet.getByTestId("order-panel-title")).toHaveText("Order #1043");
        await expect(sheet.getByRole("button", { name: "Save & close" })).toHaveCount(0);
        await sheet.getByRole("button", { name: "Close order", exact: true }).click();
        await expect(sheet).toHaveCount(0);
      }
      await expect(page.getByRole("button", { name: "Save & close" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Orders", exact: true })).toBeInViewport();
      // On a phone, New order sits in the header's ⋯.
      if (size === "phone") {
        await page.getByRole("button", { name: "More checkout actions" }).click();
        await page.getByRole("menuitem", { name: "New order" }).click();
      } else await page.getByRole("button", { name: "New order", exact: true }).click();
      await expect(orderTitle(page, size)).toHaveText("New order");
      // The order left behind is still open, at the top of Orders.
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      await expect(page.getByRole("list", { name: "Open orders" }).getByRole("button").first()).toContainText("Order #1043");
    });
  });
}

test.describe("managers", () => {
  test.use({ viewport: UX_VIEWPORTS.ipad });

  test("keep the full Orders browser", async ({ page }) => {
    await open(page, "?role=manager&scenario=spa");
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Orders" });
    await expect(dialog.getByRole("radio")).toHaveText(["Unpaid", "Paid", "Returned", "Discarded", "Voided"]);
    await expect(dialog.getByRole("list", { name: "Unpaid orders" })).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Open orders" })).toHaveCount(0);
    await dialog.getByRole("radio", { name: "Returned" }).click();
    await expect(dialog.getByText("No returned orders yet.")).toBeVisible();
  });
});
