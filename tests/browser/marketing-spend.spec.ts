import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const shots = "/private/tmp/r3b-spend-shots";
async function audit(page: Page, width: number, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const dialog of await page.getByRole("dialog").all()) {
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(901);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
for (const theme of ["light", "dark"]) for (const width of [390, 820, 1180, 1440]) {
  for (const scenario of ["normal", "no-spend"]) test(`add spend ${scenario} ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/marketing-dashboard.html?case=${scenario}&theme=${theme}`);
    const trigger = page.getByRole("button", { name: "Add spend", exact: true }).first();
    await trigger.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add spend", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox")).toBeVisible();
    await expect(dialog.getByPlaceholder("12,000")).toBeFocused();
    await dialog.getByRole("combobox").click();
    const option = page.getByRole("option").last();
    const campaignName = await option.textContent();
    await option.click();
    await expect(dialog.getByRole("combobox")).toContainText(campaignName!);
    const amount = dialog.getByPlaceholder("12,000");
    await dialog.getByRole("button", { name: "Add spend", exact: true }).click();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await amount.fill("12.5");
    await dialog.getByRole("button", { name: "Add spend", exact: true }).click();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Enter the amount in whole baht.", { exact: true })).toBeVisible();
    await audit(page, width, `add-${scenario}-${width}-${theme}`);
    if (width === 390) { const box = (await dialog.boundingBox())!; expect(Math.round(box.y + box.height)).toBe(900); }
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click(); await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click(); await amount.fill("12000");
    await dialog.getByRole("button", { name: "Add spend", exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = JSON.parse((await page.locator("body").getAttribute("data-spend"))!);
    expect(saved[0]).toMatchObject({ amount: 12000, from: "2026-10-08", to: "2026-11-06" });
  });
  for (const scenario of ["normal", "empty"]) test(`sections ${scenario} ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/marketing-spend.html?case=${scenario}&theme=${theme}`);
    await expect(page.getByText(scenario === "empty" ? "No refusals in the last 30 days." : "Not used: the direct offer was better", { exact: true })).toBeVisible();
    await audit(page, width, `refusals-${scenario}-${width}-${theme}`);
    await page.getByRole("button", { name: /^November escape/ }).locator("visible=true").first().focus(); await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(scenario === "empty" ? "No spend yet. Add it when the invoice arrives." : "฿2,000 over budget", { exact: true })).toBeVisible();
    await sheet.getByRole("heading", { name: /^Spend/ }).scrollIntoViewIfNeeded();
    await audit(page, width, `campaign-${scenario}-${width}-${theme}`);
    const add = sheet.getByRole("button", { name: "Add spend" }); await add.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add spend", exact: true });
    await expect(dialog).toContainText("Enter what November escape cost.");
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await audit(page, width, `campaign-add-${scenario}-${width}-${theme}`);
    await dialog.getByPlaceholder("12,000").fill("500");
    await dialog.getByRole("button", { name: "Add spend", exact: true }).click();
    await expect(dialog).toBeHidden(); await expect(add).toBeFocused();
    expect(JSON.parse((await page.locator("body").getAttribute("data-spend"))!)).toMatchObject({ campaignId: "c1", amount: 500, from: "2026-11-01", to: "2026-11-09" });
  });
}
