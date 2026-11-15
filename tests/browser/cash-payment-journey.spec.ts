import { expect, test } from "@playwright/test";
import { recordExactCash } from "../support/exact-cash-payment";

test.use({ viewport: { width: 1360, height: 950 } });

test("the cash receipt journey selects amount-labelled actions and issues one receipt", async ({ page }) => {
  await page.goto("/tests/browser/staff-roles.html?role=manager&scenario=spa");
  await page.locator("[data-fixture-ready]").waitFor();
  const order = page.getByRole("complementary", { name: "Order", exact: true });
  await recordExactCash(order);
  const receipt = page.getByRole("article", { name: "Receipt", exact: true });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("Thai massage 60");
  await expect(receipt).toContainText("฿1,200");
  await expect(receipt).toContainText("Cash");
  await expect(receipt).toHaveCount(1);
});
