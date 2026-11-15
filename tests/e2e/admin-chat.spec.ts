import { expect, test } from "./fixtures";

test("@smoke admin route requires real sign-in and stays isolated from public shell", async ({ page }) => {
  await page.goto("/admin/chats");

  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open concierge chat" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

for (const path of ["/admin", "/admin/chat", "/admin/unknown", "/admin/staff/unknown"]) {
  test(`${path} redirects to admin chats`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/admin\/chats$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
}
