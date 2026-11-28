import { expect, test } from "@playwright/test";

for (const choice of ["ไม่ ขอบคุณ", "อนุญาต"]) {
  test(`short Thai room keeps consent and booking visible and hands focus over after ${choice}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/th/rooms/pool-villa");

    const banner = page.getByRole("dialog", { name: "ตัวเลือกการวัดผล" });
    const booking = page.locator('a[href="/th/booking?unit=pool-villa"]').filter({ visible: true }).last();
    await expect(banner).toBeVisible();
    await expect(booking).toBeVisible();
    await expect.poll(async () => {
      const bounds = await banner.boundingBox();
      const bar = await booking.boundingBox();
      return Boolean(bounds && bar && bounds.y + bounds.height <= bar.y);
    }).toBe(true);

    const decision = banner.getByRole("button", { name: choice, exact: true });
    await decision.focus();
    await page.keyboard.press("Enter");
    await expect(banner).toBeHidden();
    await expect(booking).toBeFocused();
    await expect(booking).toBeInViewport();
  });
}
