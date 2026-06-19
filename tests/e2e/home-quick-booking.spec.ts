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

test("home quick booking renders the solid book button and keeps validation", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "light");
  });
  await page.goto("/");

  const form = page.getByTestId("home-quick-booking-form");
  const bookButton = form.getByRole("button", { name: "Book" });
  const solidButton = page.getByTestId("home-book-solid-button");

  await expect(bookButton).toBeVisible();
  await expect(solidButton).toBeVisible();
  await expect(solidButton).toHaveCSS("backdrop-filter", "none");
  await expect(
    solidButton.evaluate((node) => {
      const button = getComputedStyle(node);
      const before = getComputedStyle(node, "::before");
      const after = getComputedStyle(node, "::after");
      return {
        afterBackground: after.backgroundImage,
        afterContent: after.content,
        buttonBackground: button.backgroundImage,
        buttonBackgroundHasAlpha: button.backgroundColor.includes(" / ") || button.backgroundColor.includes("rgba("),
        beforeBackground: before.backgroundImage,
        beforeContent: before.content,
      };
    }),
  ).resolves.toEqual({
    afterBackground: "none",
    afterContent: "none",
    buttonBackground: "none",
    buttonBackgroundHasAlpha: false,
    beforeBackground: "none",
    beforeContent: "none",
  });

  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await expect(solidButton).toBeVisible();

  await bookButton.click();
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
