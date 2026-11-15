import { expect, test } from "@playwright/test";

test("single-day arrivals fill a free lane below a continuing stay; overflow lists only hidden events", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/tests/browser/desk-calendar-lanes.html");
  const friday = page.getByRole("gridcell", { name: /Friday.*November 13|Friday.*13 November/ });
  await expect(friday.getByRole("button", { name: /Friday arrival in free lane/ })).toBeVisible();
  await expect(friday.locator('[data-slot="event-calendar-more"]')).toHaveCount(0);
  const saturday = page.getByRole("gridcell", { name: /Saturday.*November 14|Saturday.*14 November/ });
  await expect(saturday.getByRole("button", { name: /Saturday first arrival/ })).toBeVisible();
  await saturday.locator('[data-slot="event-calendar-more"]').click();
  const more = page.getByRole("dialog");
  await expect(more).toContainText("Saturday overflow arrival");
  await expect(more).not.toContainText("Saturday first arrival");
  await expect(more).not.toContainText("Long stay");
});


test("automatic month rows grow and repeat a continuous stay on the next week", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/tests/browser/desk-calendar-lanes.html?auto=1");
  const bars = page.locator('[data-slot="event-calendar-month-bar-overlay"] [data-slot="event-calendar-event"]').filter({ hasText: "Long stay" });
  await expect(bars).toHaveCount(2);
  for (const bar of await bars.all()) await expect(bar).toBeVisible();
  await expect(page.locator('[data-slot="event-calendar-more"]')).toHaveCount(0);
  const heights = await page.locator('[data-slot="event-calendar-month-row"]').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(88);
});
