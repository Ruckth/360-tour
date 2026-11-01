import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1360, height: 950 } });
async function open(page: import('@playwright/test').Page, query = '') {
  await page.goto(`/tests/browser/checkout.html${query}`);
  await page.locator('[data-fixture-ready]').waitFor();
}
test('direct discard keeps the selected order read only and restores it through Discarded', async ({ page }) => {
  await open(page, '?lines=1');
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const selected = dialog.locator('li').filter({ has: page.locator('[aria-current="true"]') });
  await selected.getByRole('button', { name: /^Discard Order/ }).click();
  await expect(dialog.getByText(/discarded\. Contents/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to orders' }).click();
  await dialog.getByRole('radio', { name: 'Discarded', exact: true }).click();
  await dialog.locator('[aria-current="true"]').click();
  await expect(page.getByRole('complementary', { name: 'Order', exact: true }).getByText(/^Read only\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add booking', exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Order", exact: true }).locator("li").filter({ has: page.locator("p.font-medium") }).getByText(/^Layout check item 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Discarded', exact: true }).click();
  await dialog.getByRole('button', { name: /^Restore Order/ }).click();
  await dialog.getByRole('button', { name: 'Restore order', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open restored order' }).click();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toBeEnabled();
});
test('restore reviews competing sources and removes only explicitly selected conflicts', async ({ page }) => {
  await open(page, '?scenario=source-conflict');
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Discarded', exact: true }).click();
  await dialog.getByRole('button', { name: /^Restore Order/ }).click();
  await expect(dialog.getByText(/Thai massage 90 is now on Order/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore without 1 conflicting row' }).click();
  await dialog.getByRole('button', { name: 'Open restored order' }).click();
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await expect(order.getByRole('button', { name: /^Retained tea/ })).toBeVisible();
  await expect(order.getByRole('button', { name: /^Thai massage 90/ })).toHaveCount(0);
  await order.getByText('Order history', { exact: true }).click();
  await expect(order.getByText(/Taken off when restoring/)).toBeVisible();
});
test('fee rows state service was not given and cannot change quantity or price', async ({ page }) => {
  await open(page, '?scenario=fee');
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await expect(order.getByText('No-show fee · Thai massage 90', { exact: true })).toBeVisible();
  await expect(order.getByText(/Appointment fee · service not given/)).toBeVisible();
  await expect(order.getByRole('button', { name: 'One more', exact: true })).toHaveCount(0);
  await order.getByRole('button', { name: /^No-show fee/ }).click();
  await expect(order.getByRole('button', { name: 'Apply price', exact: true })).toHaveCount(0);
  await expect(order.getByRole('button', { name: 'Remove fee', exact: true })).toBeVisible();
});
test('receipt pages older financial amendments while preserving the original tender', async ({ page }) => {
  await open(page, '?scenario=history');
  await expect(page.locator('.pos-receipt')).toContainText('Card');
  await page.getByText('Browse all financial history', { exact: true }).click();
  const ledger = page.getByRole('region', { name: 'All payment amendments', exact: true });
  await expect(ledger.locator('li')).toHaveCount(20);
  await ledger.getByRole('button', { name: 'Load older payment amendments' }).click();
  await expect(ledger.locator('li')).toHaveCount(26);
  await expect(ledger).toContainText('Tender correction 1');
  await expect(page.locator('.pos-receipt')).toContainText('Card');
  await expect(page.locator('.pos-receipt')).not.toContainText('Transfer');
});
