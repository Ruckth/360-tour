import { expect, test } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

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
