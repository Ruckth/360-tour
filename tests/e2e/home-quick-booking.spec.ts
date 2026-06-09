import { expect, test, type Page } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

async function pickFirstAvailableRange(page: Page) {
  const form = page.getByTestId("home-quick-booking-form");
  await form.getByTestId("booking-check-in").click();

  const availableDays = page
    .getByRole("dialog")
    .locator("button:not(:disabled)")
    .filter({ hasText: /^\d+$/ });

  await availableDays.nth(0).click();
  await availableDays.nth(1).click();
}

test("home quick booking renders the liquid metal book button and keeps validation", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "light");
  });
  await page.goto("/");

  const form = page.getByTestId("home-quick-booking-form");
  await expect(form.getByRole("button", { name: "Book" })).toBeVisible();
  await expect(page.getByTestId("home-book-metal-fx")).toBeVisible();
  await expect(page.getByTestId("home-book-metal-fx")).toHaveAttribute("data-theme", "light");

  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await expect(page.getByTestId("home-book-metal-fx")).toHaveAttribute("data-theme", "dark");

  await form.getByRole("button", { name: "Book" }).click();
  await expect(form.getByRole("alert")).toContainText("Choose your arrival and checkout dates.");
});

test("home quick booking falls back to the normal gold submit button without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (contextId === "webgl" || contextId === "experimental-webgl") return null;
      return getContext.call(this, contextId as never, options as never);
    };
  });

  await page.goto("/");

  const form = page.getByTestId("home-quick-booking-form");
  await expect(page.getByTestId("home-book-metal-fx")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Book" })).toBeVisible();

  await form.getByRole("button", { name: "Book" }).click();
  await expect(form.getByRole("alert")).toContainText("Choose your arrival and checkout dates.");
});

test("home quick booking still routes selected dates into booking", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/");

  await pickFirstAvailableRange(page);

  const form = page.getByTestId("home-quick-booking-form");
  await form.getByRole("button", { name: "Book" }).click();

  await expect(page).toHaveURL(/\/booking\?checkin=\d{4}-\d{2}-\d{2}&checkout=\d{4}-\d{2}-\d{2}/);
});
