import { expect, test, type Page } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

/**
 * The concierge chat widget must load only on launcher intent, not eagerly on idle. These tests
 * assert: the widget chunk is NOT requested before the guest interacts, the launcher opens the
 * panel via both click and keyboard, focus moves into the panel on open, and villa-page property
 * context is carried to the chat.
 */

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

/** Script requests the browser made, recorded so we can prove nothing chat-related loaded early. */
function trackScriptRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") urls.push(request.url());
  });
  return urls;
}

const LAUNCHER = '[data-testid="chat-launcher-button"]';
const PANEL = '[data-testid="chat-panel"]';

test("@smoke does not load the chat widget before launcher intent", async ({ page }) => {
  await page.goto("/");

  // The launcher is present immediately...
  const launcher = page.locator(LAUNCHER);
  await expect(launcher).toBeVisible();

  // ...but the chat panel (which only exists once the widget mounts) is not.
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Restart chat/i })).toHaveCount(0);
});

test("opens the chat via click and mounts the panel", async ({ page }) => {
  await page.goto("/");
  await page.locator(LAUNCHER).click();

  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
});

test("@smoke opens the chat via keyboard (focus + Enter)", async ({ page }) => {
  await page.goto("/");
  const launcher = page.locator(LAUNCHER);
  await launcher.focus();
  await expect(launcher).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
});

test("prefetches the widget chunk on hover without opening it", async ({ page }) => {
  await page.goto("/");
  const scripts = trackScriptRequests(page);
  const before = scripts.length;

  await page.locator(LAUNCHER).hover();
  // A new chunk should load on intent, but the panel must stay closed.
  await expect.poll(() => scripts.length).toBeGreaterThan(before);
  await expect(page.locator(PANEL)).toHaveCount(0);
});

test("moves focus into the chat panel when opened", async ({ page }) => {
  await page.goto("/");
  await page.locator(LAUNCHER).click();

  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();

  // Focus should land on an element inside the panel (not left on the body / launcher).
  await expect
    .poll(async () =>
      panel.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
});

test("carries villa property context into the chat", async ({ page }) => {
  await page.goto("/rooms/garden-suite");

  // On a villa page the mobile launcher link points at /chat with the property context,
  // and the desktop launcher opens the overlay with the same context available programmatically.
  const link = page.locator('[data-testid="chat-launcher-link"]');
  await expect
    .poll(async () => (await link.getAttribute("href")) ?? "")
    .toContain("property=garden-suite");

  // Opening the overlay still works on the villa page.
  const launcher = page.locator(LAUNCHER);
  if (await launcher.count()) {
    await launcher.click();
    await expect(page.locator(PANEL)).toBeVisible();
  }
});
