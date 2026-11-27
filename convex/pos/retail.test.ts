// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import { resolveCommerceSettings, writeStockMovement } from '../commerce/model';
import schema from '../schema';
import { resortTodayIso } from '../shared/time';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const retail = api.pos.retail;
const payments = api.pos.commands;
const deviceKey = 'retail-test-payment-device-01';
const tabKey = 'retail-test-tab-position';

afterEach(() => vi.useRealTimers());

async function stockFixture(initialQuantity: number, lotExpiry?: number) {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'stockowner@example.com', emailVerified: true, tokenIdentifier: 'retail-test-owner' });
  const data = await t.run(async ctx => {
    const primary = await seedTestBranch(ctx);
    const branchId = await seedTestBranch(ctx, 'phuket');
    const categoryId = await ctx.db.insert('productCategories', { name: 'Retail', sort: 0 });
    const productId = await ctx.db.insert('products', { categoryId, name: 'Travel pouch', status: 'active', vatProfile: 'standard', options: [], minPrice: 30000, maxPrice: 30000, variantCount: 1, sort: 0, revision: 0 });
    const variantId = await ctx.db.insert('productVariants', { productId, label: 'Blue', sku: 'POUCH', normalizedSku: 'pouch', productName: 'Travel pouch', productStatus: 'active', searchText: 'Travel pouch Blue POUCH', price: 30000, status: 'active', optionValueIds: [], revision: 0 });
    const settings = resolveCommerceSettings(null);
    await ctx.db.insert('commerceSettings', { key: 'default', ...settings, paymentsMode: 'attempts', saleSwitches: { ...settings.saleSwitches, products: 'everyone' } });
    if (lotExpiry) await ctx.db.insert('stockTracking', { variantId, enabledBy: 'seed', enabledAt: Date.now() });
    const lotReceipt = lotExpiry ? { code: '2026-A', expiresAt: lotExpiry } : undefined;
    await writeStockMovement(ctx, { branchId: primary, variantId, delta: 12, kind: 'opening', actor: 'seed', sourceKey: 'primary-opening', lotReceipt });
    if (initialQuantity) await writeStockMovement(ctx, { branchId, variantId, delta: initialQuantity, kind: 'opening', actor: 'seed', sourceKey: 'sales-opening', lotReceipt });
    return { primary, branchId, variantId };
  });
  const { tillId } = await owner.mutation(api.commerce.paymentCutover.acknowledge, { deviceKey, loadedMode: 'attempts', loadedRevision: 0 });
  const load = { tillId, deviceKey, loadedMode: 'attempts' as const, loadedRevision: 0 };
  return { t, owner, ...data, tillId, load };
}

it('adds a product exactly once, fixes the branch, and forbids cross-branch edits', async () => {
  const { t, owner, branchId, primary, variantId } = await stockFixture(8);
  const args = { branchId, variantId, quantity: 2, expectedPrice: 30000, clientKey: 'retail-add-key-0001' };
  const result = await owner.mutation(retail.add, args);
  await expect(owner.mutation(retail.add, args)).resolves.toEqual(result);
  await expect(owner.mutation(retail.add, { ...args, quantity: 3 })).rejects.toThrow('changed product or quantity');
  await expect(owner.mutation(retail.add, { ...args, orderId: result.orderId, branchId: primary, clientKey: 'retail-add-key-0002' })).rejects.toThrow('different branch');
  await expect(owner.mutation(retail.add, { ...args, orderId: result.orderId, expectedPrice: 1, clientKey: 'retail-add-key-0003' })).rejects.toThrow('price changed');
  await expect(owner.query(retail.browse, { branchId, search: 'POUCH', paginationOpts: { cursor: null, numItems: 24 } })).resolves.toMatchObject({ page: [{ variantId, onHand: 8 }] });
  expect(await t.run(ctx => ctx.db.get(result.lineId))).toMatchObject({ qty: 2, unitPrice: 30000 });
  expect(await t.run(ctx => ctx.db.get(result.orderId))).toMatchObject({ stockBranchId: branchId, due: 60000 });

  const identity = { email: 'another.branch@example.com', emailVerified: true, tokenIdentifier: 'branch-test-staff' };
  await t.run(ctx => ctx.db.insert('staffGrants', { email: identity.email, role: 'manager', tokenIdentifier: identity.tokenIdentifier, branchIds: [primary], createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'stockowner@example.com' }));
  const other = t.withIdentity(identity);
  await expect(other.query(api.pos.orders.getOrder, { orderId: result.orderId })).resolves.toBeNull();
  const orderNumber = (await t.run(ctx => ctx.db.get(result.orderId)))!.orderNumber;
  await expect(other.query(api.pos.orders.findOrderByNumber, { orderNumber })).resolves.toBeNull();
  await expect(other.query(api.pos.orders.restoreCheck, { orderId: result.orderId })).resolves.toBeNull();
  await expect(other.query(api.pos.staffApprovals.forOrder, { orderId: result.orderId })).rejects.toThrow('Order not found');
  await expect(other.query(api.pos.sourceReads.listAttachable, { orderId: result.orderId })).rejects.toThrow('Order not found');
  await expect(other.query(api.pos.sourceReads.attachLookupStatus, { orderId: result.orderId })).rejects.toThrow('Order not found');
  const lifecycle = { orderId: result.orderId, expectedRevision: 1, idempotencyKey: 'another-branch-lifecycle' };
  await expect(other.mutation(payments.discardOrder.discardOrder, lifecycle)).rejects.toThrow('Order not found');
  await expect(other.mutation(payments.restoreOrder.restoreOrder, lifecycle)).rejects.toThrow('Order not found');
  const history = { orderId: result.orderId, paginationOpts: { cursor: null, numItems: 20 } };
  await expect(other.query(api.pos.orders.orderHistory, history)).rejects.toThrow('Order not found');
  for (const ledger of [api.pos.orderHistoryPages.audit, api.pos.orderHistoryPages.corrections,
    api.pos.orderHistoryPages.bookingRefunds, api.pos.orderHistoryPages.appointmentRefunds, api.pos.orderHistoryPages.orderRefunds]) {
    await expect(other.query(ledger, history)).rejects.toThrow('Order not found');
  }
  const otherOrders = await other.query(api.pos.orders.listOrders, { filter: 'unpaid', paginationOpts: history.paginationOpts });
  expect(otherOrders.page).toHaveLength(0);
  await expect(other.mutation(retail.add, { ...args, orderId: result.orderId, branchId: primary, clientKey: 'retail-add-key-0004' })).rejects.toThrow('Order not found');
});

it('checks sellable stock on quantity increases and releases the branch when the product is removed', async () => {
  const { t, owner, branchId, primary, variantId } = await stockFixture(3, Date.now() + 86_400_000);
  const { orderId, lineId } = await owner.mutation(retail.add, {
    branchId, variantId, quantity: 2, expectedPrice: 30000, clientKey: 'retail-quantity-test',
  });
  await expect(owner.mutation(payments.updateLine.updateLine, { lineId, qtyChange: 2 })).rejects.toThrow('not enough sellable stock');
  await owner.mutation(payments.updateLine.updateLine, { lineId, qtyChange: 1 });
  expect(await t.run(ctx => ctx.db.get(lineId))).toMatchObject({ qty: 3 });
  await owner.mutation(payments.removeLine.removeLine, { lineId });
  expect((await t.run(ctx => ctx.db.get(orderId)))?.stockBranchId).toBeUndefined();
  await owner.mutation(retail.add, {
    branchId: primary, orderId, variantId, quantity: 1, expectedPrice: 30000, clientKey: 'retail-new-branch',
  });
  expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ stockBranchId: primary });
});

it('keeps an open approval in its original scope when an existing order is claimed for retail', async () => {
  const { t, owner, branchId, primary, variantId } = await stockFixture(8);
  const serviceId = await t.run(ctx => ctx.db.insert('services', {
    slug: 'retail-approval-service', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 30000, currency: 'THB', staffIds: [], status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const identities = {
    cashier: { email: 'retail.approval.cashier@example.com', emailVerified: true, tokenIdentifier: 'retail-approval-cashier' },
    manager: { email: 'retail.approval.manager@example.com', emailVerified: true, tokenIdentifier: 'retail-approval-manager' },
  };
  for (const role of ['cashier', 'manager'] as const) {
    const { email, tokenIdentifier } = identities[role];
    await t.run(ctx => ctx.db.insert('staffGrants', {
      role, email, tokenIdentifier, branchIds: [primary], createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'stockowner@example.com',
    }));
  }
  const cashier = t.withIdentity(identities.cashier);
  const manager = t.withIdentity(identities.manager);
  const { orderId, lineId } = await cashier.mutation(payments.addItem.addItem, { item: { kind: 'service', serviceId } });
  const approvals = api.pos.staffApprovals;
  const { requestId } = await cashier.mutation(approvals.create, {
    orderId, payload: { kind: 'discount', lineId, discount: { type: 'percent', value: 3000 } }, reason: 'Discount request',
  });
  const add = { orderId, branchId, variantId, quantity: 1, expectedPrice: 30000, clientKey: 'retail-prior-approval' };
  await expect(owner.mutation(retail.add, add)).rejects.toThrow('Resolve the manager request before choosing a selling branch');
  await manager.mutation(approvals.reject, { requestId });
  await owner.mutation(retail.add, add);
  await expect(manager.query(approvals.detail, { requestId })).resolves.toBeNull();
});

it('checks stock before an instruction and settles once at the pinned branch', async () => {
  const { t, owner, branchId, primary, variantId, tillId, load } = await stockFixture(1);
  const { orderId } = await owner.mutation(retail.add, { branchId, variantId, quantity: 2, expectedPrice: 30000, clientKey: 'stock-review-cart' });
  const order = await t.run(ctx => ctx.db.get(orderId));
  const opened = await owner.mutation(payments.startPaymentAttempt.startPaymentAttempt, {
    orderId, tillId, tabKey, load, clientKey: 'payment-stock-review', expectedRevision: order!.revision, expectedDue: 60000,
    businessDate: resortTodayIso(), customers: [], vouchers: [], legs: [{ key: 'card', method: 'card', amount: 60000 }],
  });
  expect(opened.status).toBe('ready');
  if (opened.status !== 'ready') return;
  const attempt = { attemptId: opened.attempt.attemptId, ownerRevision: opened.attempt.ownerRevision, tillId, tabKey };
  const instruction = { ...attempt, load, legKey: 'card' };
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, instruction)).resolves.toMatchObject({ status: 'confirm_stock', shortages: [{ variantId, quantity: 2, onHand: 1 }] });
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...instruction, stockInHand: true })).resolves.toMatchObject({ status: 'confirm_stock' });
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...instruction, stockReview: [{ variantId, quantity: 1, onHandSeen: 1 }] })).resolves.toMatchObject({ status: 'confirm_stock' });
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...instruction, stockReview: [{ variantId, quantity: 2, onHandSeen: 1 }] })).resolves.toMatchObject({ status: 'instruct' });
  await expect(owner.mutation(payments.recordPaymentLeg.recordPaymentLeg, { ...attempt, legKey: 'card', outcome: 'taken', reference: 'sample authorization' })).resolves.toMatchObject({ status: 'recorded' });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, attempt)).resolves.toMatchObject({ status: 'settled', replayed: false });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, attempt)).resolves.toMatchObject({ status: 'settled', replayed: true });
  const outcome = await t.run(async ctx => {
    const stock = (branch: typeof branchId) => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branch)).unique();
    return { selling: await stock(branchId), original: await stock(primary), movement: await ctx.db.query('stockMovements').withIndex('by_sourceKey', q => q.eq('sourceKey', `sale:${orderId}:${variantId}`)).unique() };
  });
  expect(outcome.selling).toMatchObject({ onHand: -1, needsRecount: true });
  expect(outcome.original).toMatchObject({ onHand: 12 });
  expect(outcome.movement).toMatchObject({ branchId, before: 1, after: -1, delta: -2 });
});

async function openRetailPayment(fixture: Awaited<ReturnType<typeof stockFixture>>, key: string, split = false) {
  const { t, owner, branchId, variantId, tillId, load } = fixture;
  const { orderId } = await owner.mutation(retail.add, {
    branchId, variantId, quantity: 2, expectedPrice: 30000, clientKey: 'retail-' + key,
  });
  const order = await t.run(ctx => ctx.db.get(orderId));
  const status = await owner.mutation(payments.startPaymentAttempt.startPaymentAttempt, {
    orderId, tillId, tabKey, load, clientKey: 'payment-' + key, expectedRevision: order!.revision, expectedDue: 60000,
    businessDate: resortTodayIso(), customers: [], vouchers: [],
    legs: split
      ? [{ key: 'card', method: 'card', amount: 30000 }, { key: 'cash', method: 'cash', amount: 30000 }]
      : [{ key: 'card', method: 'card', amount: 60000 }],
  });
  if (status.status !== 'ready') throw new Error(JSON.stringify(status));
  return { orderId, attempt: { attemptId: status.attempt.attemptId, ownerRevision: status.attempt.ownerRevision, tillId, tabKey } };
}

it('requires current selling-branch access for an authorized return and its payouts', async () => {
  const fixture = await stockFixture(8);
  const { t, owner, branchId, primary, load } = fixture;
  const { orderId, attempt } = await openRetailPayment(fixture, 'return-branch-scope');
  await owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...attempt, load, legKey: 'card' });
  await owner.mutation(payments.recordPaymentLeg.recordPaymentLeg, { ...attempt, legKey: 'card', outcome: 'taken' });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, attempt)).resolves.toMatchObject({ status: 'settled' });
  const receipt = await owner.query(api.pos.orders.getOrder, { orderId });
  if (!receipt) throw new Error('Expected the settled receipt.');
  const identity = { email: 'return.branch@example.com', emailVerified: true, tokenIdentifier: 'retail-return-manager' };
  const grantId = await t.run(ctx => ctx.db.insert('staffGrants', {
    email: identity.email, tokenIdentifier: identity.tokenIdentifier, role: 'manager', branchIds: [branchId],
    createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'stockowner@example.com',
  }));
  const manager = t.withIdentity(identity);
  const tillId = 'branch-return-desk';
  const returns = api.pos.commands.returnItems;
  const authorized = await manager.mutation(returns.authorize, {
    orderId, tillId, reason: 'Wrong size', clientKey: 'branch-return-request',
    expectedRevision: receipt.order.revision, expectedCorrectionRevision: receipt.paymentRecord.correctionRevision,
    parts: [{ kind: 'line', lineId: receipt.lines[0]._id, units: 1, disposition: 'sellable' }],
  });
  expect(authorized.status).toBe('authorized');
  await t.run(ctx => ctx.db.patch(grantId, { branchIds: [primary] }));
  const control = { returnId: authorized.returnId, tillId, operatorRevision: authorized.operatorRevision };
  await expect(manager.query(returns.get, { returnId: control.returnId })).resolves.toBeNull();
  await expect(manager.query(returns.get, { orderId, tillId })).rejects.toThrow('Order not found');
  await expect(manager.mutation(returns.claim, control)).rejects.toThrow('Return not found');
  await expect(manager.mutation(returns.recordPayout, { ...control, destinationKey: authorized.claims[0].key, outcome: 'given' }))
    .rejects.toThrow('Return not found');
  await expect(owner.query(returns.get, { returnId: control.returnId })).resolves.toMatchObject({ status: 'authorized' });
});

it('holds tracked stock before arming, excludes competing payment and transfers, and releases or consumes precisely', async () => {
  vi.useFakeTimers();
  const fixture = await stockFixture(2, Date.now() + 60 * 60_000);
  const { t, owner, branchId, variantId, load } = fixture;
  const first = await openRetailPayment(fixture, 'checkout-1', true);
  const second = await openRetailPayment(fixture, 'checkout-2');

  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...first.attempt, load, legKey: 'card' }))
    .resolves.toMatchObject({ status: 'instruct' });
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...second.attempt, load, legKey: 'card' }))
    .resolves.toMatchObject({ status: 'refused', code: 'stock_unavailable' });
  await expect(t.run(ctx => writeStockMovement(ctx, {
    branchId, variantId, delta: -1, kind: 'transfer_out', sourceKey: 'blocked-transfer', actor: 'stock',
  }))).rejects.toThrow('held for another order');

  await owner.mutation(payments.recordPaymentLeg.recordPaymentLeg, { ...first.attempt, legKey: 'card', outcome: 'declined' });
  expect(await t.run(ctx => ctx.db.query('stockReservations').take(1))).toMatchObject([{ state: 'active' }]);
  await expect(owner.mutation(payments.cancelPaymentAttempt.cancelPaymentAttempt, first.attempt))
    .resolves.toMatchObject({ status: 'cancelled' });
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...second.attempt, load, legKey: 'card' }))
    .resolves.toMatchObject({ status: 'instruct' });
  await expect(owner.mutation(payments.recordPaymentLeg.recordPaymentLeg, { ...second.attempt, legKey: 'card', outcome: 'taken' }))
    .resolves.toMatchObject({ status: 'recorded' });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, second.attempt))
    .resolves.toMatchObject({ status: 'settled', replayed: false });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, second.attempt))
    .resolves.toMatchObject({ status: 'settled', replayed: true });
  const reservations = await t.run(ctx => ctx.db.query('stockReservations').take(3));
  expect(reservations).toMatchObject([
    { orderId: first.orderId, branchId, variantId, quantity: 2, state: 'released' },
    { orderId: second.orderId, branchId, variantId, quantity: 2, state: 'consumed' },
  ]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('won’t arm stock whose lots expire during the hold and won’t turn expired Checkout holds into negative stock', async () => {
  vi.useFakeTimers();
  const near = await stockFixture(2, Date.now() + 5 * 60_000);
  const soon = await openRetailPayment(near, 'soon-expiring');
  await expect(near.owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...soon.attempt, load: near.load, legKey: 'card' }))
    .resolves.toMatchObject({ status: 'refused', code: 'INSUFFICIENT_STOCK' });
  expect(await near.t.run(ctx => ctx.db.query('stockReservations').take(1))).toEqual([]);
  await near.t.finishAllScheduledFunctions(vi.runAllTimers);

  const fixture = await stockFixture(2);
  const { t, owner, branchId, variantId, load } = fixture;
  const opened = await openRetailPayment(fixture, 'expired-protection');
  await expect(owner.mutation(payments.armPaymentLeg.armPaymentLeg, { ...opened.attempt, load, legKey: 'card' }))
    .resolves.toMatchObject({ status: 'instruct' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run(ctx => writeStockMovement(ctx, {
    branchId, variantId, delta: -2, kind: 'transfer_out', sourceKey: 'after-hold-expiry', actor: 'stock',
  }));
  await owner.mutation(payments.recordPaymentLeg.recordPaymentLeg, { ...opened.attempt, legKey: 'card', outcome: 'taken' });
  await expect(owner.mutation(payments.settleOrder.settlePaymentAttempt, { ...opened.attempt, stockInHand: true }))
    .resolves.toMatchObject({ status: 'refused', code: 'stock_unavailable' });
  expect(await t.run(ctx => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q =>
    q.eq('variantId', variantId).eq('branchId', branchId)).unique())).toMatchObject({ onHand: 0 });
});
