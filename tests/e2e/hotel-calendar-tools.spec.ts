import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("hotel staff can read the phone calendar key and open maintenance with a keyboard", async ({ page }) => {
  test.setTimeout(60_000);
  await signedInBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/hotel");
  const tools = page.getByRole("button", { name: "More calendar tools" });
  await chooseBranchIfPrompted(page, tools);
  await expect(tools).toBeEnabled();

  const key = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Key$/ }) });
  const summary = key.locator("summary");
  await summary.click();
  for (const label of ["Paid", "Pending · dashed border", "Confirmed · balance due", "Cancelled", "Host block", "OTA block"]) {
    await expect(key.getByText(label, { exact: true })).toBeVisible();
  }
  await summary.click();
  await expect(key.getByText("OTA block")).toBeHidden();

  await tools.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More calendar tools" });
  await expect(menu).toBeVisible();
  for (const name of ["View", "Add", "Channels", "Maintenance"]) {
    await expect(menu.getByRole("group", { name })).toBeVisible();
  }
  await page.keyboard.press("End");
  const cleanup = menu.getByRole("menuitem", { name: /Clean up old bookings/ });
  await expect(cleanup).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Clean up test bookings" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tools).toBeFocused();
});
