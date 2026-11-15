import { expect, test, type Locator, type Page } from "@playwright/test";
import { openMoneyDraft } from "./helpers/money-drafts";

test.use({ hasTouch: true, isMobile: true, timezoneId: "Asia/Bangkok", viewport: { width: 390, height: 844 } });
async function dismiss(page: Page, dialog: Locator, via: string) {
  if (via === "X") await dialog.getByRole("button", { name: "Close", exact: true }).click();
  else if (via === "Escape") await page.keyboard.press("Escape");
  else await page.mouse.click(5, 5);
}
async function methodTargets(group: Locator, count: number) {
  const methods = group.getByRole("radio");
  await expect(methods).toHaveCount(count);
  for (const method of await methods.all()) {
    const { box, text } = await method.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return { box: element.getBoundingClientRect().toJSON(), text: range.getBoundingClientRect().toJSON() };
    });
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(text.left).toBeGreaterThanOrEqual(box.left + 3);
    expect(text.right).toBeLessThanOrEqual(box.right - 3);
  }
}
for (const via of ["X", "Escape", "outside"]) {
  test(`follow-up ${via} prompts for a changed draft and Save closes without a prompt`, async ({ page }) => {
    await page.goto("/tests/browser/inbox.html");
    const edit = page.getByRole("button", { name: "Edit follow-up", exact: true });
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "Staff follow-up", exact: true });
    const input = dialog.getByRole("textbox", { name: "What needs to be done?" });
    await input.fill("Check the arrival time");
    await dismiss(page, dialog, via);
    const prompt = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(input).toHaveValue("Check the arrival time");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(prompt).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.click();
    await expect(input).toHaveValue("Check the arrival time");
    await dismiss(page, dialog, via);
    await expect(dialog).toBeHidden();
    await expect(prompt).toHaveCount(0);
  });
  for (const scenario of ["stay-pay", "appointment-pay"] as const) {
    test(`${scenario} ${via} prompts for method changes and successful recording bypasses the prompt`, async ({ page }) => {
      await openMoneyDraft(page, scenario);
      const dialog = page.getByRole("dialog", { name: "Record a payment taken elsewhere", exact: true });
      const methods = dialog.getByRole("radiogroup", { name: scenario === "stay-pay" ? "Paid by" : "Payment method", exact: true });
      await expect(methods).toHaveAttribute("data-variant", "segmented");
      await expect(methods).toHaveAttribute("data-tone", "subtle");
      await methods.getByRole("radio", { name: "Card", exact: true }).click();
      await methodTargets(methods, 5);
      await dismiss(page, dialog, via);
      const prompt = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
      await expect(prompt).toBeVisible();
      await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(methods.getByRole("radio", { name: "Card", exact: true })).toBeChecked();
      await dialog.getByRole("button", { name: /^Record ฿/ }).click();
      await expect(dialog).toBeHidden();
      await expect(prompt).toHaveCount(0);
      const submission = await page.locator("body").getAttribute("data-submission");
      expect(JSON.parse(submission!)).toMatchObject({ method: "card", expectedRevision: scenario === "stay-pay" ? 7 : 4 });
      await openMoneyDraft(page, scenario === "stay-pay" ? "stay-refund" : "appointment-refund");
      const refunds = page.getByRole("radiogroup", { name: scenario === "stay-pay" ? "Given back by" : "Refund method", exact: true });
      await methodTargets(refunds, 6);
      await page.setViewportSize({ width: 1180, height: 820 });
      await methodTargets(refunds, 6);
    });
  }
}
for (const width of [360, 390]) {
  test(`${width}px chat header has exactly two rows and a visible status action at row 2 right`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/chats.html?path=/admin/chats&session=chat-anna");
    const header = page.getByTestId("chat-header");
    const name = page.getByTestId("chat-header-name");
    const meta = page.getByTestId("chat-header-meta");
    const action = header.getByRole("button", { name: "No reply needed", exact: true });
    await expect(action.getByText("No reply needed", { exact: true })).toBeVisible();
    await expect(header.getByText("Needs you", { exact: true }).locator("visible=true")).toHaveCount(1);
    const first = (await name.boundingBox())!, second = (await meta.boundingBox())!, button = (await action.boundingBox())!;
    expect(first.height).toBe(44);
    expect(second.height).toBe(44);
    expect(second.y).toBe(first.y + first.height + 8);
    expect(button.y).toBe(second.y);
    expect(button.x + button.width).toBeCloseTo(second.x + second.width, 0);
    for (const label of ["Back to chats", "Chat details", "More chat actions"]) {
      const box = (await name.getByRole("button", { name: label, exact: true }).boundingBox())!;
      expect(box.y).toBe(first.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await openMoneyDraft(page, "stay-pay");
    await methodTargets(page.getByRole("radiogroup", { name: "Paid by", exact: true }), 5);
    await openMoneyDraft(page, "stay-refund");
    await methodTargets(page.getByRole("radiogroup", { name: "Given back by", exact: true }), 6);
  });
}
