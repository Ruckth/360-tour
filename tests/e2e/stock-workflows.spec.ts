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
  const supplier = await owner.mutation(purchasing.addSupplier, { branchId, name: `Local supplier ${token}`, confirmSimilar: true, operationKey: crypto.randomUUID() });
  const draft = await owner.mutation(purchasing.saveOrder, {
    branchId, supplierId: supplier.id as Id<'suppliers'>, lines: [{ variantId, quantity: 12, unitCost: 7000 }], operationKey: crypto.randomUUID(),
  });
  const orderId = draft.id as Id<'purchaseOrders'>;
  const path = `/admin/stock/purchasing/orders/${orderId}`;

  for (const viewport of [{ width: 320, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(path);
    const nav = page.getByRole('navigation', { name: 'Stock pages' });
    await expect(nav.getByRole('link')).toHaveCount(5);
    await expect(nav.getByRole('link', { name: 'Purchasing' })).toHaveAttribute('aria-current', 'page');
    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(pageOverflows).toBe(false);
    const navLinks = nav.getByRole('link');
    await navLinks.first().focus();
    for (let index = 1; index < 5; index++) {
      await page.keyboard.press('Tab');
      await expect(navLinks.nth(index)).toBeFocused();
    }
    const links = await nav.getByRole('link').evaluateAll(items => items.map(item => {
      const { x, y, width, height } = item.getBoundingClientRect();
      return { x, y, width, height, tabIndex: (item as HTMLElement).tabIndex };
    }));
    expect(links.every(link => link.x >= 0 && link.x + link.width <= viewport.width && link.height >= 44 && link.tabIndex === 0)).toBe(true);
    const issue = page.getByRole('button', { name: 'Issue order', exact: true });
    await expect(issue).toBeInViewport({ ratio: 1 });
    await test.info().attach(`stock-layout-${viewport.width}`, { contentType: 'application/json', body: JSON.stringify({ viewport, links, issue: await issue.boundingBox() }) });
  }
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const form = page.getByRole('dialog', { name: /Receive delivery/ });
  const rejected = form.getByLabel('Rejected (optional)');
  const reason = form.getByLabel('Rejection details (optional)');
  await expect(reason).toHaveCount(0);
  await rejected.fill('1');
  await reason.fill('Damaged packaging');
  await rejected.fill('0');
  await expect(reason).toHaveCount(0);
  await rejected.fill('1');
  await expect(reason).toHaveValue('Damaged packaging');
  await rejected.fill('0');
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
  await row.getByRole('link', { name: 'Open lots', exact: true }).click();
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
  await adjustDialog.getByText('Damaged', { exact: true }).click();
  await expect(adjustDialog.getByRole('radio', { name: 'Damaged', exact: true })).toBeChecked();
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
  await page.getByLabel('Actions for selected item').getByRole('button', { name: 'Request 1', exact: true }).click();

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

test('purchasing searches posted documents and restores filtered queues from detail', async ({ page }) => {
  test.setTimeout(60_000);
  const { owner, branchId } = await setupStockOwner(page);
  const token = crypto.randomUUID().slice(0, 8);
  const productId = await owner.mutation(stock.saveProduct, {
    branchId, name: `Purchasing stock ${token}`, vatProfile: 'standard',
    variants: [{ label: 'Default', sku: `PUR-${token}`, price: 10000, status: 'active' }],
  });
  const product = await owner.query(stock.getProduct, { branchId, productId });
  const variantId = product?.variants[0]?._id;
  if (!variantId) throw new Error('The saved product needs its first variant.');
  const supplierName = `Purchasing supplier ${token}`;
  const supplierId = (await owner.mutation(purchasing.addSupplier, {
    branchId, name: supplierName, confirmSimilar: true, operationKey: crypto.randomUUID(),
  })).id as Id<'suppliers'>;
  const deliveryReference = `INV-${token}`;
  const receipt = await owner.mutation(purchasing.receiveWithoutOrder, {
    branchId, supplierId, deliveryReference, reason: 'Walk-in delivery',
    lines: [{ variantId, accepted: 1 }], operationKey: crypto.randomUUID(),
  });
  const request = await owner.mutation(purchasing.saveRequest, {
    branchId, lines: [{ variantId, quantity: 3 }], operationKey: crypto.randomUUID(),
  });
  const draft = await owner.mutation(purchasing.saveOrder, {
    branchId, supplierId, lines: [{ variantId, quantity: 3, unitCost: 7000 }], operationKey: crypto.randomUUID(),
  });
  if (!draft.reference || !request.reference || !receipt.reference) throw new Error('Seeded purchasing documents need printable references.');
  const hub = '/admin/stock/purchasing';

  await page.goto(`${hub}?tab=orders&orderFilter=item&variantId=nope`);
  await expect(page.getByRole('button', { name: 'Pick item…' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Order filter' })).toContainText('Filter by item');
  await page.goto(`${hub}?tab=requests&requestFilter=item&requestVariantId=${supplierId}`);
  await expect(page.getByRole('button', { name: 'Pick item…' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Request filter' })).toContainText('Filter by item');

  const unusedSupplierName = `Empty queue supplier ${token}`;
  const unusedSupplier = await owner.mutation(purchasing.addSupplier, {
    branchId, name: unusedSupplierName, confirmSimilar: true, operationKey: crypto.randomUUID(),
  });
  await page.goto(`${hub}?tab=orders&orderFilter=supplier&supplierId=${unusedSupplier.id}`);
  await expect(page.getByRole('button', { name: unusedSupplierName, exact: true })).toBeVisible();
  await expect(page.getByText('No purchase orders match this view.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Purchase reference' }).fill(draft.reference);
  await page.getByRole('link', { name: draft.reference, exact: true }).click();
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Purchase reference' }).fill('');
  await expect(page.getByRole('button', { name: unusedSupplierName, exact: true })).toBeVisible();

  await page.goto(`${hub}?tab=requests&requestFilter=mine`);
  await page.getByRole('link', { name: request.reference, exact: true }).click();
  await page.getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Request filter' })).toHaveText('My requests');
  await expect(page.getByRole('tab', { name: 'Requests' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('searchbox', { name: 'Purchase reference' }).fill(draft.reference);
  await expect(page.getByRole('link', { name: draft.reference, exact: true })).toBeVisible();

  await page.goto(`${hub}?tab=orders&orderFilter=draft`);
  await page.getByRole('link', { name: draft.reference, exact: true }).click();
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Order filter' })).toHaveText('Draft orders');
  await expect(page.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true');

  await owner.mutation(purchasing.issuePurchaseOrder, {
    orderId: draft.id as Id<'purchaseOrders'>, expectedRevision: draft.revision!, operationKey: crypto.randomUUID(),
  });
  await page.getByRole('button', { name: 'Receive delivery', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Receive delivery/ });
  const search = sheet.getByRole('searchbox', { name: 'Search open orders' });
  await search.fill(token);
  await sheet.getByRole('button', { name: new RegExp(draft.reference) }).click();
  const quantity = sheet.getByLabel('Accepted now');
  await quantity.fill('2');
  await search.fill(draft.reference);
  await expect(sheet.getByRole('button', { name: new RegExp(draft.reference) })).toBeVisible();
  await expect(quantity).toHaveValue('2');
  await quantity.fill('');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toBeHidden();

  await page.goto(`${hub}?tab=receipts`);
  await page.getByRole('searchbox', { name: 'Receipt or delivery reference' }).fill(deliveryReference);
  const receiptLink = page.getByRole('link', { name: receipt.reference, exact: true });
  await expect(receiptLink.locator('..')).toContainText(supplierName);
  await receiptLink.click();
  await page.getByRole('link', { name: 'Receipts', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Receipt or delivery reference' })).toHaveValue(deliveryReference);
  await expect(receiptLink).toBeVisible();
});

test('Stock sections stay keyboard reachable with an expanded sidebar, icon rail and phone header', async ({ page }) => {
  await setupStockOwner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/stock/balances');
  const local = page.getByRole('navigation', { name: 'Stock pages', includeHidden: true });
  await expect(local).toBeHidden();
  await expect(page.getByTestId('approvals-button')).toBeVisible();
  const sidebarActivity = page.locator('[data-stock-pages]').getByRole('link', { name: 'Activity' });
  await sidebarActivity.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/stock\/activity/);
  await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first().click();
  await expect(local.getByRole('link')).toHaveCount(5);
  await expect(local.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 390, height: 844 });
  await local.getByRole('link', { name: 'Balances' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/stock\/balances/);
  await expect(page.locator('header')).toContainText('Koh Samui');
});
