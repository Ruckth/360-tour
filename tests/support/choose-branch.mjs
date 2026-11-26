/** Select a branch when the first-visit chooser appears before the expected page content.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} target
 * @param {number} [timeout]
 */
export async function chooseBranchIfPrompted(page, target, timeout) {
  const chooser = page.getByRole("heading", { name: "Choose a branch to start", exact: true });
  await target.or(chooser).first().waitFor({ state: "visible", timeout });
  if (await chooser.isVisible()) {
    await page.getByRole("listitem").getByRole("button").first().click();
    await chooser.waitFor({ state: "hidden", timeout });
  }
}
