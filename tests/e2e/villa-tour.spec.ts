import { expect, test } from "./fixtures";


test("@smoke villa detail page renders gallery, 360 entry, and chat trigger", async ({ page }) => {
  await page.goto("/rooms/pool-villa");

  await expect(page.getByRole("heading", { name: "Tideglass Pool Residence" })).toBeVisible();
  await expect(page.getByText("Private paradise with infinity pool")).toBeVisible();
  await expect(page.getByRole("button", { name: /Explore 360|Explore in 360/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore in 360" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open concierge chat" })).toBeVisible();
});

test("@smoke home villa 360 opens the tour overlay without leaving home", async ({ page }) => {
  await page.goto("/");

  const poolCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Tideglass Pool Residence" }) });
  await poolCard.getByRole("button", { name: "Explore 360" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByTestId("tour-viewer")).toContainText("Tideglass Pool Residence");
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

  const viewerBox = await page.getByTestId("tour-viewer").boundingBox();
  const viewport = page.viewportSize();
  expect(viewerBox).toMatchObject({
    x: 0,
    y: 0,
    width: viewport?.width,
    height: viewport?.height,
  });
});

test("home villa actions preserve the locale and book the selected villa directly", async ({ page }) => {
  await page.goto("/th");
  const card = page.getByRole("article").filter({ has: page.locator('a[href="/th/rooms/pool-villa"]') });
  const villaName = await card.getByRole("heading").innerText();
  const book = card.locator('a[href="/th/booking?unit=pool-villa"]');
  await expect(book).toBeVisible();
  await book.click();
  await expect(page).toHaveURL(/\/th\/booking\?unit=pool-villa$/);
  await expect(page.getByRole("button", { pressed: true })).toContainText(villaName);
});

test("mobile villa chat trigger targets the property chat page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/rooms/pool-villa");

  const chatLink = page.getByRole("link", { name: "Open concierge chat" });
  await expect(chatLink).toBeVisible();
  await expect(chatLink).toHaveAttribute(
    "href",
    "/chat?property=pool-villa&returnTo=%2Frooms%2Fpool-villa",
  );

  await page.goto("/chat?property=pool-villa&returnTo=%2Frooms%2Fpool-villa");
  await expect(page).toHaveURL((url) => {
    expect(url.pathname).toBe("/chat");
    expect(url.searchParams.get("property")).toBe("pool-villa");
    expect(url.searchParams.get("returnTo")).toBe("/rooms/pool-villa");
    return true;
  });
  await expect(page.getByRole("button", { name: /Restart chat - Tideglass Pool Residence concierge/i })).toBeVisible();
});


for (const width of [390, 1280]) {
  test(`room tour keeps one gallery action and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/rooms/pool-villa");

    const opener = page.getByRole("button", { name: /^Explore (in )?360$/ });
    await expect(opener).toHaveCount(1);
    await opener.evaluate((element) => element.addEventListener("mousedown", (event) => event.preventDefault()));
    await opener.click();

    const dialog = page.getByRole("dialog", { name: "Tideglass Pool Residence 360 tour" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("button", { name: "Close tour" })).toBeVisible({ timeout: 20_000 });
    for (const key of ["Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}

test("a direct tour keeps Escape available without an opener", async ({ page }) => {
  await page.goto("/rooms/pool-villa?tour=1");
  const dialog = page.getByRole("dialog", { name: "Tideglass Pool Residence 360 tour" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/rooms\/pool-villa$/);
});


test("an unavailable tour keeps keyboard focus inside its recovery dialog", async ({ page }) => {
  await page.route(/\/assets\/TourViewer-[^/]+\.js$/, (route) => route.abort());
  await page.goto("/rooms/pool-villa?tour=1");

  const dialog = page.getByRole("dialog", { name: "Tideglass Pool Residence 360 tour" });
  const retry = dialog.getByRole("button", { name: "Try again" });
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(dialog.getByRole("alert")).toHaveText("This room could not be loaded.");
  await expect(retry).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(retry).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/rooms\/pool-villa$/);
});
