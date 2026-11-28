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
      await expect(page.getByTestId("chat-header-meta").getByText("AI paused", { exact: true })).toBeVisible();
      await expect(page.getByTestId("chat-header-meta").getByText(/ · /)).toBeAttached();
      await page.getByRole("button", { name: "Chat details", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Chat details", exact: true }).getByText("AI paused", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    } else await expect(page.getByText("AI paused", { exact: true }).locator("visible=true")).toBeVisible();
    await expect(page.getByText("AI on", { exact: true })).toHaveCount(0);
    await expect(page.getByText(initialTask, { exact: false })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Message could not be delivered");
    await expect(page.getByText(/reply window.*(ends|closes)/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Edit follow-up", "Complete follow-up", "No reply needed", "More chat actions"]) {
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
  const discard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard", exact: true }).click();
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

test("the reply counter appears near the limit and pasted text is capped", async ({ page }) => {
  await page.goto("/tests/browser/inbox.html");
  const input = page.getByRole("textbox", { name: /reply/i });
  await expect(page.getByText(/of 1,000 characters/)).toHaveCount(0);
  await input.fill("a".repeat(920));
  await expect(page.getByText("920 of 1,000 characters")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /reply/i })).toHaveAccessibleDescription(/920 of 1,000 characters/);
  await input.selectText();
  await page.keyboard.insertText("b".repeat(1001));
  await expect(input).toHaveValue("b".repeat(1000));
  await expect(page.getByText("1000 of 1,000 characters")).toBeVisible();
});

test("the closed window opens a single addressed email draft", async ({ page }) => {
  await page.goto("/tests/browser/inbox.html?closed");
  await expect(page.getByRole("link", { name: "Open email draft" })).toHaveAttribute("href", "mailto:guest%2Bchat@example.com");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
});

test("typing leaves automation on and explicit takeover updates the header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/inbox.html?automation");
  const meta = page.getByTestId("chat-header-meta");
  const takeover = page.getByRole("button", { name: "Take over from AI" });
  await expect(meta.getByText("AI on", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /reply/i }).fill("Typing leaves AI on");
  await expect(meta.getByText("AI on", { exact: true })).toBeVisible();
  await takeover.click();
  await expect(meta.getByText("AI paused", { exact: true })).toBeVisible();
});

test("an overdue follow-up preserves its Bangkok time when reopened for editing", async ({ page }) => {
  await page.goto("/tests/browser/inbox.html?overdue");
  await expect(page.getByText("Overdue · 2026-11-11 14:59 Bangkok time")).toBeVisible();
  await page.getByRole("button", { name: "Edit follow-up" }).click();
  await expect(page.getByLabel("Due at (Bangkok time)")).toHaveValue("2026-11-11T14:59");
});
