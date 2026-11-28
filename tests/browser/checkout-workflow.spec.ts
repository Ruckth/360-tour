import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1360, height: 950 } });
async function open(page: import('@playwright/test').Page, query = '') {
  await page.goto(`/tests/browser/checkout.html${query}`);
  await page.locator('[data-fixture-ready]').waitFor();
}

test('catalog search Enter adds a unique match and ignores ambiguous, composing and held Enter', async ({ page }) => {
  await open(page);
  const search = page.getByRole('searchbox', { name: 'Search all items' });
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await search.fill('Thai massage');
  const matches = page.getByRole('group', { name: 'Results for Thai massage' });
  await expect(matches.getByRole('button')).toHaveCount(2);
  await search.press('Enter');
  await expect(order.getByText('No items yet')).toBeVisible();

  await search.fill('Foot spa');
  await expect(search).toHaveAccessibleDescription('Press Enter to add this item.');
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(order.getByText('No items yet')).toBeVisible();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(order.getByRole('button', { name: /^Foot spa 45/ })).toBeVisible();
  await expect(order.getByRole('button', { name: 'Cash ฿600', exact: true })).toBeEnabled();
  await expect(search).toBeFocused();
});

test('catalog search Enter opens the duration picker and waits for an explicit choice', async ({ page }) => {
  await open(page, '?scenario=catalog-duration');
  const search = page.getByRole('searchbox', { name: 'Search all items' });
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await search.fill('Foot spa');
  await expect(search).toHaveAccessibleDescription('Press Enter to choose a duration.');
  await page.keyboard.down('Enter');
  const durations = page.getByRole('group', { name: 'Foot spa 45 duration' });
  await expect(durations.getByRole('button', { name: /^45 min/ })).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(durations).toBeVisible();
  await expect(order.getByText('No items yet')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(durations.getByRole('button', { name: /^60 min/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(order.getByRole('button', { name: 'Cash ฿800', exact: true })).toBeEnabled();
});

test('discard from the order\'s ⋯ asks first, keeps the order read only and restores it through Discarded', async ({ page }) => {
  await open(page, '?lines=1');
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await order.getByRole('button', { name: 'More order actions' }).click();
  await page.getByRole('menuitem', { name: 'Discard order…' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: /^Discard order #\d+\?$/ })).toBeVisible();
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(order.getByText(/^Read only\./)).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(page.getByRole('button', { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add booking', exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Order", exact: true }).locator("li").filter({ has: page.locator("p.font-medium") }).getByText(/^Layout check item 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Discarded', exact: true }).click();
  await dialog.getByRole('button', { name: /^Restore Order/ }).click();
  await dialog.getByRole('button', { name: 'Restore order', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open restored order' }).click();
  await expect(page.getByRole('button', { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toBeEnabled();
});
test('restore reviews competing sources and removes only explicitly selected conflicts', async ({ page }) => {
  await open(page, '?scenario=source-conflict');
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Discarded', exact: true }).click();
  await dialog.getByRole('button', { name: /^Restore Order/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Order or receipt number' })).toHaveCount(0);
  await expect(dialog.getByText(/Thai massage 90 is now on Order/)).toBeVisible();
  const review = dialog.getByRole('region', { name: 'Restore order' });
  await expect(review.getByRole('heading', { name: 'Keep', exact: true }).locator('..')).toContainText('Retained tea');
  await expect(review.getByRole('heading', { name: 'Remove', exact: true }).locator('..')).toContainText('Thai massage 90');
  await dialog.getByRole('button', { name: 'Restore without 1 conflicting row' }).click();
  await dialog.getByRole('button', { name: 'Open restored order' }).click();
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await expect(order.getByRole('button', { name: /^Retained tea/ })).toBeVisible();
  await expect(order.getByRole('button', { name: /^Thai massage 90/ })).toHaveCount(0);
  await order.getByText('History', { exact: true }).click();
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
  const history = page.getByTestId('receipt-history');
  await history.getByText('History', { exact: true }).click();
  await history.getByRole('tab', { name: 'Payments' }).click();
  const ledger = page.getByRole('region', { name: 'Payment corrections', exact: true });
  await expect(ledger.locator('li')).toHaveCount(20);
  await ledger.getByRole('button', { name: 'Load older payment corrections' }).click();
  await expect(ledger.locator('li')).toHaveCount(26);
  await expect(ledger).toContainText('Tender correction 1');
  await expect(page.locator('.pos-receipt')).toContainText('Card');
  await expect(page.locator('.pos-receipt')).not.toContainText('Transfer');
});
test('a service row takes an optional date and time, each cleared on its own, and pays with both blank', async ({ page }) => {
  await open(page, '?scenario=unscheduled');
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await order.getByRole('button', { name: /^Thai massage 90/ }).click();
  // Therapist, date and time fold into one Schedule row.
  await order.getByRole('button', { name: /^Schedule/ }).click();
  await expect(order.getByText('Date (optional)', { exact: true })).toBeVisible();
  await expect(order.getByText('Time (optional)', { exact: true })).toBeVisible();
  await expect(order.getByRole('button', { name: 'Now', exact: true })).toHaveCount(0);
  const schedule = order.getByRole('button', { name: /^Schedule/ });
  await expect(schedule).toContainText('Any therapist · Not scheduled');
  await order.getByLabel('Service time').fill('15:45');
  await expect(schedule).toContainText('15:45 · date not set');
  await order.getByRole('button', { name: 'Clear service time' }).click();
  await expect(schedule).toContainText('Not scheduled');
  await expect(order.getByLabel('Service time')).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true })).toBeEnabled();
});
test('a paid unscheduled service is linked to its appointment from the receipt, which stays as issued', async ({ page }) => {
  await open(page, '?scenario=unscheduled-paid');
  const receipt = page.locator('.pos-receipt');
  await expect(receipt).not.toContainText('Not scheduled');
  await expect(page.getByTestId('receipt-items')).toContainText('Not scheduled');
  // What prints: screen-only controls (a line's Refund, which a linked row loses) are left out.
  const printed = () => receipt.evaluate((el) => { const paper = el.cloneNode(true) as HTMLElement; paper.querySelectorAll('[data-screen-only]').forEach((node) => node.remove()); return paper.textContent; });
  const issued = await printed();
  // Link sits on the receipt line; the only matching appointment opens straight on its review.
  await page.getByTestId('receipt-items').getByRole('button', { name: 'Link appointment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('link-review')).toContainText('Appointment: unpaid ฿1,600 → paid ฿1,600 by Order #1043');
  await expect(dialog.getByRole('button', { name: 'Confirm link' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Guest booked the prepaid massage');
  await dialog.getByRole('button', { name: 'Confirm link' }).click();
  await expect(page.getByTestId('receipt-items').getByTestId('line-link')).toHaveText('Linked · SVC-0002');
  const history = page.getByTestId('receipt-history');
  await history.getByText('History', { exact: true }).click();
  await history.getByRole('tab', { name: 'Payments' }).click();
  await expect(history.getByText('Row linked after payment · #1', { exact: true })).toBeVisible();
  expect(await printed()).toBe(issued);
});
