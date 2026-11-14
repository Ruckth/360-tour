import { expect, test } from "@playwright/test";

for (const { width, font } of [
  { width: 320, font: 16 },
  { width: 390, font: 16 },
  { width: 1280, font: 16 },
  { width: 390, font: 32 },
]) {
  test(`${width}px / ${font}px text: inbox facts and follow-up actions fit together`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/inbox.html");
    await page.locator("[data-fixture-ready]").waitFor();
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
    if (width < 640) {
      await page.getByRole("button", { name: "Chat details", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Chat details", exact: true }).getByText("AI paused", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    } else await expect(page.getByText("AI paused", { exact: true })).toBeVisible();
    await expect(page.getByText("AI on", { exact: true })).toHaveCount(0);
    await expect(page.getByText(initialTask, { exact: false })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Message could not be delivered");
    await expect(page.getByText(/reply window.*(ends|closes)/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Edit follow-up", "Complete follow-up", "Done · No reply needed", "More chat actions"]) {
      const control = page.getByRole("button", { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844.5);
      await control.click({ trial: true });
    }
    await page.getByRole("button", { name: "More chat actions" }).click();
    const menu = page.getByRole("menu", { name: "More chat actions" });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width + 0.5);
    for (const control of await menu.getByRole("menuitem").all()) {
      await control.scrollIntoViewIfNeeded();
      await control.click({ trial: true });
      expect(await control.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const box = await control.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844.5);
    }
  });
}

const initialTask = "Check the accessible room with housekeeping and update the guest before arrival.";

test("direct task edit can be cancelled; Complete then Add starts empty without losing the reply draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/inbox.html");
  await page.getByRole("button", { name: "Edit follow-up", exact: true }).click();
  const input = page.getByRole("textbox", { name: "What needs to be done?" });
  await expect(input).toHaveValue(initialTask);
  await input.fill("A cancelled edit");
  await input.press("Escape");
  await expect(page.getByText(initialTask, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Complete follow-up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit follow-up", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More chat actions" })).toBeFocused();
  await page.getByRole("button", { name: "More chat actions" }).click();
  await page.getByRole("menuitem", { name: "Add follow-up", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await input.press("Escape");
  await expect(page.getByRole("textbox", { name: /reply/i })).toHaveValue("An unsent reply is retained.");
});

test("a closed reply window preserves the failed-send and draft warnings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/inbox.html?closed");
  await expect(page.getByText("WhatsApp reply window has ended", { exact: true })).toBeVisible();
  await expect(page.getByText("The last reply was not sent. Your draft is kept.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Message could not be delivered" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete follow-up" })).toBeVisible();
});
