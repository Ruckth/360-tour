import { expect, test } from './fixtures';

test('@smoke homepage formats direct savings from basis points', async ({ page }) => {
  await page.goto('/');
  const savings = page.getByText('Direct Savings', { exact: true }).locator('..');
  await expect(savings).toContainText('15%');
  await expect(savings).not.toContainText('1500%');
});


test('mobile villa price shows both rate labels and matches the room booking bar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Tideglass Pool Residence' }) });
  const rate = card.getByTestId('villa-card-rate');
  await expect(rate.getByText('Standard rate', { exact: true })).toBeVisible();
  await expect(rate.getByText('Direct Rate', { exact: true })).toBeVisible();
  await expect(rate).toContainText('฿7,225');

  await page.goto('/rooms/pool-villa');
  await expect(page.getByTestId('mobile-sticky-rate')).toContainText('฿7,225');
});
