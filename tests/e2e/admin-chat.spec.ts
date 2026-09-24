import { expect, test } from "@playwright/test";

test("admin route shows setup state and stays isolated from public shell", async ({ page }) => {
  await page.goto("/admin/chats");

  await expect(page.getByText("Admin setup")).toBeVisible();
  await expect(page.getByText("Clerk is required for admin")).toBeVisible();
  await expect(page.getByText("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open concierge chat" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

for (const path of ["/admin", "/admin/chat", "/admin/unknown", "/admin/staff/unknown"]) {
  test(`${path} redirects to admin chats`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/admin\/chats$/);
    await expect(page.getByText("Admin setup")).toBeVisible();
  });
}
