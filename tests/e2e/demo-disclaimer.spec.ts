import { expect, test } from "@playwright/test";

test("demo disclaimer appears once per browser session on public pages", async ({ page }) => {
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Demo website only" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This website is a product demo");

  await page.getByRole("button", { name: "I understand" }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Demo website only" })).toHaveCount(0);
});

test("demo disclaimer stays out of admin pages", async ({ page }) => {
  await page.goto("/admin/chats");

  await expect(page.getByRole("heading", { name: /Admin|Clerk is required for admin/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Demo website only" })).toHaveCount(0);
});

test("demo disclaimer uses localized copy", async ({ page }) => {
  await page.goto("/th");

  const dialog = page.getByRole("dialog", { name: "เว็บไซต์ตัวอย่างเท่านั้น" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("เว็บไซต์นี้เป็นเดโมสำหรับสาธิตสินค้า");
});
