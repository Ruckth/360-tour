import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { branchStorageKeys } from '../../src/components/admin/branch/branch-selection';
import { signedInBackend } from './backend';
import { expect, test } from './fixtures';

const stock = api.commerce.stock;
const purchasing = api.commerce.purchasing;
const firstPage = { cursor: null, numItems: 25 };

async function setupStockOwner(page: import('@playwright/test').Page) {
  const owner = await signedInBackend(page);
  const branch = (await owner.query(api.branches.branches.list)).find(b => b.key === 'koh-samui');
  if (!branch) throw new Error('The integration seed must provide the Koh Samui branch.');
  const branchId = branch._id;
  const access = await owner.query(api.auth.staffAccess.myAccess);
  const manager = (await owner.query(stock.listGrants, { branchId, paginationOpts: firstPage })).page.find(row => row.email === access.email);
  if (!manager) throw new Error('The integration owner must have a staff grant.');
  await owner.mutation(stock.setGrant, {
    branchId, staffGrantId: manager.staffGrantId, expectedRevision: manager.stockGrant?.revision ?? 0,
    roles: { requester: true, approver: true, buyer: true, receiver: true, lead: true },
  });
  const policy = await owner.query(stock.branchPolicy, { branchId });
  await owner.mutation(stock.setBranchPolicy, { branchId, directOrder: true, directReceipt: true, expectedRevision: policy?.revision ?? 0 });
  await page.evaluate(({ storageKey, branchId }) => sessionStorage.setItem(storageKey, branchId), {
    storageKey: branchStorageKeys(access.email).session, branchId,
  });
  return { owner, branchId };
}

test('staff can receive a partial tracked purchase order on a phone and inspect its balance on desktop', async ({ page }) => {
  test.setTimeout(60_000);
  const { owner, branchId } = await setupStockOwner(page);

  const token = crypto.randomUUID().slice(0, 8);
  const sku = `STOCK-${token}`;
  const name = `Travel pouch ${token}`;
  const productId = await owner.mutation(stock.saveProduct, {
    branchId, name, vatProfile: 'standard', variants: [{ label: 'Blue', sku, price: 12000, status: 'active' }],
  });
  const product = await owner.query(stock.getProduct, { branchId, productId });
  const variantId = product?.variants[0]?._id;
  if (!variantId) throw new Error('The saved product needs its first variant.');
  await owner.mutation(api.commerce.stockExpansion.enableLotTracking, { branchId, variantId });
  const supplier = await owner.mutation(purchasing.addSupplier, { branchId, name: `Local supplier ${token}`, operationKey: crypto.randomUUID() });
  const draft = await owner.mutation(purchasing.saveOrder, {
    branchId, supplierId: supplier.id as Id<'suppliers'>, lines: [{ variantId, quantity: 12, unitCost: 7000 }], operationKey: crypto.randomUUID(),
  });
  const orderId = draft.id as Id<'purchaseOrders'>;
  const path = `/admin/stock/purchasing/orders/${orderId}`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const form = page.getByRole('dialog', { name: /Receive delivery/ });
  await form.getByLabel('Accepted now').fill('5');
  await form.getByLabel('Delivery reference / invoice #').fill(`SLIP-${token}`);
  await expect(form.getByLabel('Lot code (required for accepted units)')).toBeVisible();
  await form.getByRole('button', { name: /Post receipt.*5 accepted/ }).click();
  await expect(form.getByText(`Enter a lot code for ${name}.`)).toBeVisible();
  await expect(form.getByLabel('Accepted now')).toHaveValue('5');
  await form.getByLabel('Lot code (required for accepted units)').fill(`LOT-${token}`);
  await form.getByLabel('Lot expiry date (required)').click();
  await expect(page.getByRole('grid')).toBeVisible();
  const expires = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const expiryDay = page.locator(`[data-day="${expires}"] button`);
  if (!await expiryDay.isVisible()) await page.getByRole('button', { name: /next month/i }).click();
  await expiryDay.click();
  await form.getByRole('button', { name: /Post receipt.*5 accepted/ }).click();
  await expect(form).toBeHidden();
  const posted = await owner.query(purchasing.order, { orderId });
  expect(posted.lines[0]).toMatchObject({ accepted: 5, due: 7 });
  expect(posted.order.status).toBe('partially_received');
  await expect(owner.query(api.commerce.stockExpansion.lotBalances, { branchId, variantId }))
    .resolves.toMatchObject({ onHand: 5, lots: [{ code: `LOT-${token}`, onHand: 5 }] });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/admin/stock/balances?q=${encodeURIComponent(sku)}`);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('5');
  await expect(row).toContainText('7');
  const balances = await owner.query(stock.listBalances, { branchId, search: sku, paginationOpts: firstPage });
  expect(balances.page).toEqual(expect.arrayContaining([expect.objectContaining({ variantId, onHand: 5, onOrder: 7 })]));
  await row.getByRole('link', { name: 'Count', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Lots & expiry' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(`LOT-${token}`, { exact: true })).toBeVisible();
});

test('bad adjust shows inline preview error without crashing and balance-to-request prefill consumes URL flags for Back', async ({ page }) => {
  test.setTimeout(60_000);
  const { owner, branchId } = await setupStockOwner(page);

  const token = crypto.randomUUID().slice(0, 8);
  const sku = `ADJ-${token}`;
  const name = `Sun lotion ${token}`;
  const productId = await owner.mutation(stock.saveProduct, {
    branchId, name, vatProfile: 'standard', variants: [{ label: '100 ml', sku, price: 25000, status: 'active' }],
  });
  const product = await owner.query(stock.getProduct, { branchId, productId });
  const variantId = product?.variants[0]?._id;
  if (!variantId) throw new Error('The saved product needs its first variant.');

  await owner.mutation(stock.postOperation, {
    branchId, kind: 'opening', operationKey: crypto.randomUUID(), reason: 'Opening stock', reasonCode: 'opening_stock',
    lines: [{ variantId, quantity: 3, expectedRevision: 0 }],
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/admin/stock/balances?q=${encodeURIComponent(sku)}`);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();

  // 1. Over-on-hand adjust decrease renders inline preview feedback instead of crashing the route
  await row.getByRole('button', { name: 'Adjust', exact: true }).click();
  const adjustDialog = page.getByRole('dialog', { name: /Adjust stock/ });
  await expect(adjustDialog).toBeVisible();
  const qtyInput = adjustDialog.getByLabel(/Quantity to remove/);
  const noteInput = adjustDialog.getByLabel(/Note/);
  await qtyInput.fill('10');
  await noteInput.fill('Damaged on shelf');
  await expect(adjustDialog.getByRole('alert')).toBeVisible();
  await expect(qtyInput).toHaveValue('10');
  await expect(noteInput).toHaveValue('Damaged on shelf');

  // Recover with a valid decrease and verify updated balance
  await qtyInput.fill('2');
  await expect(adjustDialog).toContainText('3 → 1');
  await adjustDialog.getByRole('button', { name: 'Save adjustment', exact: true }).click();
  await expect(adjustDialog).toBeHidden();
  await expect(row).toContainText('1');

  // 2. Balances -> Request stock prefills real variant and strips one-shot URL flags so browser Back stays clean
  await row.getByLabel(`Select ${name} 100 ml`).check();
  await page.getByLabel('Actions for selected item').getByRole('button', { name: 'Request stock', exact: true }).click();

  const requestDialog = page.getByRole('dialog', { name: /Request stock/ });
  await expect(requestDialog).toBeVisible();
  await expect(requestDialog).toContainText(name);
  await expect(requestDialog).toContainText('Items (1/50)');
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname === '/admin/stock/purchasing' && !url.searchParams.has('new') && !url.searchParams.has('variants');
  }).toBe(true);

  await requestDialog.getByRole('button', { name: 'Save & submit for approval', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/purchasing\/requests\//);
  await expect(page.getByText(name)).toBeVisible();

  // Browser Back returns to Purchasing without reopening the one-shot Request dialog
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/stock\/purchasing/);
  await expect(page.getByRole('dialog', { name: /Request stock/ })).toHaveCount(0);
});
