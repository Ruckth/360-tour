import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };
import { expect, test } from "./fixtures";

/**
 * Browser acceptance for guest audit rows G19–G36 that depend on real routing, focus or layout.
 * Rule permutations live in the focused Vitest files named in each test.
 */

test.describe("G19 services empty-state reset", () => {
  for (const [prefix, messages] of [["", en], ["/th", th]] as const) {
    test(`one action clears query and category, Back restores them (${prefix || "en"})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/services?category=Wellness&q=no-match-xyz`);
      await expect(page.getByRole("status")).toHaveText(messages.ServiceCatalog.empty);
      await page.getByRole("link", { name: messages.ServiceCatalog.showAll, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/services$`));
      await expect(page.locator("article").first()).toBeVisible();
      await expect(page.getByRole("textbox", { name: messages.ServiceCatalog.search, exact: true })).toHaveValue("");
      await page.goBack();
      await expect(page).toHaveURL(/category=Wellness&q=no-match-xyz/);
      await expect(page.getByRole("link", { name: messages.ServiceCatalog.showAll, exact: true })).toBeVisible();
    });
  }
});
