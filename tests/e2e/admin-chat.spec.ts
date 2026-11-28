import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "./fixtures";

test("@smoke admin route requires real sign-in and stays isolated from public shell", async ({ page }) => {
  await page.goto("/admin/chats");

  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open concierge chat" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

for (const path of ["/admin/chat", "/admin/unknown"]) {
  test(`${path} redirects to admin chats`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/admin\/chats$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
}

test("authorized admin entry opens Today", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/today$/);
  await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Needs you/ }).click();
  const search = page.getByRole("textbox", { name: "Search chats" });
  await search.fill("Guest e2e search");
  await expect(search).toHaveValue("Guest e2e search");
  await expect(page.getByRole("tablist", { name: "Chat queue" })).toBeVisible();
});

test.describe("phone inbox", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("browser Back restores the queue search, assignment, and focused row", async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/admin/chats?assignment=unassigned&q=Scenario%20guest");
    await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
    const row = page.locator("#admin-chat-list").getByRole("button", { name: /^Website · Scenario guest/ });
    await expect(row).toBeVisible();
    await row.tap();
    await expect(page.getByTestId("admin-chat-detail-dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("admin-chat-detail-dialog")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Search chats" })).toHaveValue("Scenario guest");
    await expect(page.getByRole("button", { name: "Clear assignment filter" })).toBeVisible();
    await expect(row).toBeFocused();
  });
});

test("invalid staff bookmark offers recovery within Staff bookings", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/admin/staff/unknown");
  await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
  await expect(page).toHaveURL(/\/admin\/staff\/unknown$/);
  const recovery = page.getByRole("region", { name: "This Staff bookings page doesn’t exist" });
  await expect(recovery.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/admin/staff/calendar");
});
