import { expect, test, type Page } from "./fixtures";


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

test("home quick booking uses the solid Book button to focus the first available check-in", async ({ page }) => {
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
  const firstAvailableDay = page.getByRole("grid").locator("button:not(:disabled)").first();
  await expect(firstAvailableDay).toBeFocused();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(form.getByTestId("booking-check-in")).toHaveAttribute("data-selected-date", "");
  await expect(form.getByTestId("booking-check-out")).toHaveAttribute("data-selected-date", "");
});

test("home quick booking still routes selected dates into booking", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/");

  await pickFirstAvailableRange(page);

  const form = page.getByTestId("home-quick-booking-form");
  await form.getByRole("button", { name: "Book" }).click();

  await expect(page).toHaveURL(/\/booking\?checkin=\d{4}-\d{2}-\d{2}&checkout=\d{4}-\d{2}-\d{2}/);
});

test("tablet header keeps the villa booking action visible and secondary navigation reachable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Book", exact: true })).toBeInViewport();
  expect((await header.boundingBox())!.height).toBeLessThan(90);
  await header.getByRole("button", { name: "Toggle menu" }).click();
  await expect(header.getByRole("link", { name: "Experiences", exact: true })).toBeVisible();
  await header.getByRole("link", { name: "Book", exact: true }).click();
  await expect(page).toHaveURL(/\/booking$/);
  await expect(header.getByRole("button", { name: "Toggle menu" })).toHaveAttribute("aria-expanded", "false");
});

test("short mobile viewports can scroll the navigation to Book", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const menu = header.getByRole("button", { name: "Toggle menu" });
  const book = header.getByRole("link", { name: "Book", exact: true });

  await expect(page.getByTestId("booking-check-in")).toBeVisible();
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await header.boundingBox())!.height).toBeLessThanOrEqual(320);
  const menuLinkCount = await header.getByRole("link").count() - 1; // The brand link precedes the toggle.
  for (let index = 0; index < menuLinkCount; index++) {
    await page.keyboard.press("Tab");
  }
  await expect(book).toBeFocused();
  await expect(book).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/booking$/);
});
