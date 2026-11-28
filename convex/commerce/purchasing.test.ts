// @vitest-environment edge-runtime
import { omit } from 'convex-helpers';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect, it } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { readBudget } from '../lib/readBudget';
import schema from '../schema';
import { deliveryKey, draftChanges, HISTORY_MAX_CHANGES, readIncoming, readOrderLines, receiptLotCount } from './private/purchasingCore';
import { writeStockMovement } from './private/stockLedger';
import { seedTestBranch } from '../testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const p = api.commerce.purchasing;
const all = { requester: true, approver: true, buyer: true, receiver: true, lead: true };
const none = { requester: false, approver: false, buyer: false, receiver: false, lead: false };
let keySeq = 0;
const key = () => `op-key-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const page = { paginationOpts: { numItems: 25, cursor: null } };

async function code(promise: Promise<unknown>) {
  try { await promise; } catch (error) {
    if (error instanceof ConvexError) return (error.data as { code: string }).code;
    throw error;
  }
  throw new Error('Expected a ConvexError');
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const otherBranchId = await seedTestBranch(ctx, 'phuket');
    const now = Date.now();
    const grants: Record<string, Id<'staffGrants'>> = {};
    for (const [name, roles] of [['ann', all], ['ben', all], ['cat', { ...none, requester: true }]] as const) {
      grants[name] = await ctx.db.insert('staffGrants', {
        email: `${name}@example.com`, role: 'manager', tokenIdentifier: name, branchIds: [branchId, otherBranchId],
        createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
      });
      await ctx.db.insert('stockGrants', { staffGrantId: grants[name], branchId, roles, revision: 1, changedBy: 'owner', changedAt: now });
    }
    await ctx.db.insert('stockBranchPolicies', { branchId, directOrder: true, directReceipt: true, revision: 1, changedBy: 'owner', changedAt: now });
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 1 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Sunscreen', status: 'active', vatProfile: 'standard', options: [], minPrice: 100, maxPrice: 100, variantCount: 2, sort: 1, revision: 1,
    } as never);
    const variant = (label: string, sku: string) => ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label, sku, price: 100, status: 'active', revision: 1, productName: 'Sunscreen', productStatus: 'active',
    });
    return { branchId, otherBranchId, grants, variantId: await variant('50 ml', 'SUN-50'), otherVariantId: await variant('100 ml', 'SUN-100') };
  });
  const as = (name: string) => t.withIdentity({ email: `${name}@example.com`, emailVerified: true, tokenIdentifier: name });
  const ann = as('ann'), ben = as('ben'), cat = as('cat');
  const supplierId = (await ann.mutation(p.addSupplier, { branchId: ids.branchId, name: 'Coastal Supply', phone: '0800', operationKey: key() })).id as Id<'suppliers'>;
  const onHand = (variantId = ids.variantId) => t.run(async ctx =>
    (await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', ids.branchId)).unique())?.onHand ?? 0);
  const onOrder = async (variantId = ids.variantId) => (await ann.query(p.incoming, { branchId: ids.branchId, variantIds: [variantId] }))[0].quantity;

  async function directOrder(quantity: number, lines?: { variantId: Id<'productVariants'>; quantity: number }[]) {
    const draft = await ann.mutation(p.saveOrder, {
      branchId: ids.branchId, supplierId, lines: lines ?? [{ variantId: ids.variantId, quantity, unitCost: 5_000 }], operationKey: key(),
    });
    const orderId = draft.id as Id<'purchaseOrders'>;
    await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() });
    return orderId;
  }
  async function receive(orderId: Id<'purchaseOrders'>, accepted: number, extra: Record<string, unknown> = {}) {
    const detail = await ann.query(p.order, { orderId });
    return ann.mutation(p.receivePurchaseOrder, {
      orderId, expectedIssuedRevision: detail.order.issuedRevision,
      lines: [{ orderLineId: detail.lines[0]._id, accepted }], operationKey: key(), ...extra,
    });
  }
  async function approvedRequest(qty: number) {
    const draft = await ann.mutation(p.saveRequest, { branchId: ids.branchId, lines: [{ variantId: ids.variantId, quantity: qty }], operationKey: key() });
    const requestId = draft.id as Id<'purchaseRequests'>;
    const submitted = await ann.mutation(p.submitRequestForApproval, { requestId, expectedRevision: draft.revision!, operationKey: key() });
    await ben.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: submitted.revision!, operationKey: key() });
    return requestId;
  }
  return { t, ...ids, ann, ben, cat, supplierId, onHand, onOrder, directOrder, receive, approvedRequest };
}

it('blocks self-approval and supports send back, resubmit and approval by another approver', async () => {
  const { ann, ben, branchId, variantId } = await setup();
  const draft = await ann.mutation(p.saveRequest, { branchId, needBy: '2026-12-01', lines: [{ variantId, quantity: 12 }], operationKey: key() });
  const requestId = draft.id as Id<'purchaseRequests'>;
  expect(draft.reference).toMatch(/^PR-\d{6}-[A-Z2-9]{5}$/);
  let rev = (await ann.mutation(p.submitRequestForApproval, { requestId, expectedRevision: draft.revision!, operationKey: key() })).revision!;
  expect(await code(ann.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: rev, operationKey: key() }))).toBe('SELF_APPROVAL');
  expect(await code(ben.mutation(p.sendBackPurchaseRequest, { requestId, expectedRevision: rev, reason: ' ', operationKey: key() }))).toBe('REASON_REQUIRED');
  rev = (await ben.mutation(p.sendBackPurchaseRequest, { requestId, expectedRevision: rev, reason: 'Order 10', operationKey: key() })).revision!;
  rev = (await ann.mutation(p.saveRequest, { branchId, requestId, expectedRevision: rev, lines: [{ variantId, quantity: 10 }], operationKey: key() })).revision!;
  rev = (await ann.mutation(p.submitRequestForApproval, { requestId, expectedRevision: rev, operationKey: key() })).revision!;
  await ben.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: rev, operationKey: key() });
  const detail = await ann.query(p.request, { requestId });
  expect(detail.request).toMatchObject({ status: 'approved', mine: true, lastReason: 'Order 10' });
  expect(detail.lines[0]).toMatchObject({ approvedQuantity: 10, available: 10 });
  const history = await ann.query(p.history, { branchId, entity: 'request', entityId: requestId, ...page });
  expect(history.page.map(event => event.action)).toEqual(['approved', 'resubmitted', 'edited', 'send_back', 'submitted', 'created']);
});

it('limits requesters to their own requests', async () => {
  const { ann, cat, branchId, variantId } = await setup();
  await ann.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 1 }], operationKey: key() });
  const mine = await cat.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 2 }], operationKey: key() });
  expect(await code(cat.query(p.requests, { branchId, view: { kind: 'all' }, ...page }))).toBe('STOCK_FORBIDDEN');
  const own = await cat.query(p.requests, { branchId, view: { kind: 'item', variantId }, ...page });
  expect(own.page.map(row => row._id)).toEqual([mine.id]);
  expect((await ann.query(p.requests, { branchId, view: { kind: 'all' }, ...page })).page).toHaveLength(2);
  expect(await code(cat.mutation(p.saveOrder, { branchId, supplierId: (await ann.query(p.suppliers, { branchId, status: 'active', ...page })).page[0]._id,
    lines: [{ variantId, quantity: 1 }], operationKey: key() }))).toBe('STOCK_FORBIDDEN');
  const suppliers = await cat.query(p.suppliers, { branchId, status: 'active', ...page });
  expect('phone' in suppliers.page[0]).toBe(false);
});

it('allocates one approval across competing orders and releases cancelled units only while open', async () => {
  const { ann, branchId, variantId, supplierId, receive, approvedRequest } = await setup();
  const requestId = await approvedRequest(10);
  const requestLineId = (await ann.query(p.request, { requestId })).lines[0]._id;
  const draft = () => ann.mutation(p.saveOrder, { branchId, supplierId, requestId, lines: [{ variantId, quantity: 6, requestLineId }], operationKey: key() });
  const [first, second] = [await draft(), await draft()];
  await ann.mutation(p.issuePurchaseOrder, { orderId: first.id as Id<'purchaseOrders'>, expectedRevision: first.revision!, operationKey: key() });
  const secondOrderId = second.id as Id<'purchaseOrders'>;
  const secondOrder = await ann.query(p.order, { orderId: secondOrderId });
  await expect(ann.mutation(p.issuePurchaseOrder, { orderId: secondOrderId, expectedRevision: second.revision!, operationKey: key() }))
    .rejects.toMatchObject({ data: { code: 'ALLOCATION_CHANGED', lines: [{ orderLineId: secondOrder.lines[0]._id, available: 4 }] } });
  expect((await ann.query(p.order, { orderId: secondOrderId })).order.status).toBe('draft');
  const orderId = first.id as Id<'purchaseOrders'>;
  await receive(orderId, 4);
  const order = await ann.query(p.order, { orderId });
  await ann.mutation(p.amendPurchaseOrder, { orderId, expectedRevision: order.order.revision, reason: 'Supplier short', lines: [{ orderLineId: order.lines[0]._id, due: 0 }], operationKey: key() })
    .then(() => { throw new Error('expected close remainder'); }, error => expect((error as ConvexError<{ code: string }>).data.code).toBe('USE_CLOSE_REMAINDER'));
  await ann.mutation(p.closePurchaseOrderRemainder, { orderId, expectedRevision: order.order.revision, reason: 'Supplier short', operationKey: key() });
  let line = (await ann.query(p.request, { requestId })).lines[0];
  expect(line).toMatchObject({ committedQuantity: 4, available: 6 });
  const request = (await ann.query(p.request, { requestId })).request;
  await ann.mutation(p.closePurchaseRequest, { requestId, expectedRevision: request.revision, reason: 'Enough stock', operationKey: key() });
  line = (await ann.query(p.request, { requestId })).lines[0];
  expect(line.available).toBe(0);
  expect((await ann.query(p.order, { orderId })).order.status).toBe('closed_short');
});

it('runs 12 ordered → 5 received → 2 corrected → 9 due, then closes and corrects the last units', async () => {
  const { ann, directOrder, receive, onHand, onOrder } = await setup();
  const orderId = await directOrder(12);
  expect(await onOrder()).toBe(12);
  const receipt = await receive(orderId, 5, { deliveryReference: 'inv-001' });
  expect(await onHand()).toBe(5);
  expect(await onOrder()).toBe(7);
  const detail = await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> });
  const receiptLineId = detail.lines[0]._id;
  expect(await ann.query(p.correctionPreview, { receiptLineId, quantity: 2 })).toMatchObject({ onHandAfter: 3, dueAfter: 9 });
  await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 2, reason: 'Overcounted', operationKey: key() });
  expect(await onHand()).toBe(3);
  expect(await onOrder()).toBe(9);
  let order = await ann.query(p.order, { orderId });
  expect(order.lines[0]).toMatchObject({ accepted: 3, due: 9, corrected: 2 });
  await ann.mutation(p.closePurchaseOrderRemainder, { orderId, expectedRevision: order.order.revision, reason: 'Stop', operationKey: key() });
  expect(await onOrder()).toBe(0);
  await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 3, reason: 'Wrong item', operationKey: key() });
  order = await ann.query(p.order, { orderId });
  expect(order.order.status).toBe('cancelled');
  expect(order.lines[0]).toMatchObject({ accepted: 0, due: 0 });
  expect(await onOrder()).toBe(0);
  expect(await code(ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Again', operationKey: key() }))).toBe('EXCEEDS_ELIGIBLE');
});

it('returns corrected units on a fully received order to On order and routes negative corrections through a reconciliation report', async () => {
  const { t, ann, branchId, variantId, directOrder, receive, onHand, onOrder } = await setup();
  const orderId = await directOrder(4);
  const receipt = await receive(orderId, 4);
  expect((await ann.query(p.order, { orderId })).order.status).toBe('received');
  // A sale takes 3 of the 4 units.
  await t.run(async ctx => {
    const level = (await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branchId)).unique())!;
    await ctx.db.patch(level._id, { onHand: 1 });
  });
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  // Without a count the correction posts nothing and opens a report on the original receipt movement.
  const blocked = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 2, reason: 'Overcount', operationKey: key() });
  if (blocked.outcome !== 'reported') throw new Error('expected a report');
  expect(blocked).toMatchObject({ blockedBy: 'negative_stock', requestedQuantity: 2, onHand: 1 });
  expect('movementIds' in blocked).toBe(false);
  expect(await onHand()).toBe(1);
  const report = await t.run(ctx => ctx.db.get(blocked.reportId));
  expect(report).toMatchObject({ status: 'open', requestedQuantity: 2, reason: 'Overcount', reviewedRevision: blocked.stockRevision });
  const override = { countedOnHand: 0, stockRevision: blocked.stockRevision };
  // The count alone is not enough: the lead must post against the report for the same quantity.
  expect(await code(ann.mutation(p.correctReceipt, { receiptLineId, quantity: 2, reason: 'Overcount', negativeOverride: override, operationKey: key() })))
    .toBe('STOCK_RECONCILIATION_REQUIRED');
  expect(await code(ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Overcount', reportId: blocked.reportId, negativeOverride: override, operationKey: key() })))
    .toBe('STOCK_REPORT_MISMATCH');
  expect(await code(ann.mutation(p.correctReceipt, {
    receiptLineId, quantity: 2, reason: 'Overcount', reportId: blocked.reportId, negativeOverride: { ...override, stockRevision: override.stockRevision - 1 }, operationKey: key(),
  }))).toBe('STOCK_CHANGED');
  expect(await onHand()).toBe(1);
  const posted = await ann.mutation(p.correctReceipt, {
    receiptLineId, quantity: 2, reason: 'Overcount', reportId: blocked.reportId, negativeOverride: override, operationKey: key(),
  });
  if (posted.outcome !== 'posted') throw new Error('expected a posting');
  expect(posted.resolvedReportId).toBe(blocked.reportId);
  expect(posted.movementIds).toHaveLength(1);
  expect(await onHand()).toBe(-1);
  expect(await onOrder()).toBe(2);
  expect((await ann.query(p.order, { orderId })).order.status).toBe('partially_received');
  const level = await t.run(ctx => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branchId)).unique());
  expect(level?.needsRecount).toBe(true);
  expect(await t.run(ctx => ctx.db.get(blocked.reportId))).toMatchObject({ status: 'resolved' });
  const adjustment = (await ann.query(p.receiptAdjustments, { receiptId: receipt.id as Id<'supplierReceipts'>, ...page })).page[0];
  expect(adjustment).toMatchObject({ countedOnHand: 0, negativeOverride: true });
  // A resolved report cannot authorize another negative posting.
  expect(await code(ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Again', reportId: blocked.reportId, negativeOverride: override, operationKey: key() })))
    .toBe('STOCK_REPORT_MISMATCH');
  // Core's generic movement correction cannot bypass the purchasing counters.
  expect(await code(ann.mutation(api.commerce.stock.postCorrection, {
    branchId, movementId: (report as { movementId: Id<'stockMovements'> }).movementId, quantity: 1, expectedRevision: level!.revision, reason: 'Bypass', operationKey: key(),
  }))).toBe('STOCK_CORRECTION_SOURCE');
});

it('replays exact payloads, rejects changed payloads and revoked access, and caps lines', async () => {
  const { t, ann, ben, branchId, grants, directOrder, onHand } = await setup();
  const orderId = await directOrder(10);
  const detail = await ann.query(p.order, { orderId });
  const args = { orderId, expectedIssuedRevision: 1, lines: [{ orderLineId: detail.lines[0]._id, accepted: 3 }], operationKey: 'receipt-key-1' };
  const first = await ann.mutation(p.receivePurchaseOrder, args);
  await ann.mutation(p.receivePurchaseOrder, { ...args, operationKey: 'receipt-key-2' });
  expect(await ann.mutation(p.receivePurchaseOrder, args)).toEqual(first);
  expect(await onHand()).toBe(6);
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...args, lines: [{ ...args.lines[0], accepted: 2 }] }))).toBe('OPERATION_KEY_REUSED');
  expect(await code(ben.mutation(p.receivePurchaseOrder, { ...args, lines: [{ ...args.lines[0], accepted: 5 }], operationKey: key() }))).toBe('OVER_RECEIPT');
  await t.run(async ctx => {
    const grant = (await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', grants.ann)).unique())!;
    await ctx.db.patch(grant._id, { roles: none });
  });
  expect(await code(ann.mutation(p.receivePurchaseOrder, args))).toBe('STOCK_FORBIDDEN');
  expect(await code(ann.query(p.history, { branchId, entity: 'order', entityId: orderId, ...page }))).toBe('STOCK_FORBIDDEN');
  const variants = await t.run(async ctx => {
    const productId = (await ctx.db.query('products').first())!._id;
    return Promise.all(Array.from({ length: 51 }, (_, i) => ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label: `V${i}`, price: 1, status: 'active', revision: 1,
    })));
  });
  const supplierId = (await ben.query(p.suppliers, { branchId, status: 'active', ...page })).page[0]._id;
  const lines = variants.map(variantId => ({ variantId, quantity: 1 }));
  expect(await code(ben.mutation(p.saveOrder, { branchId, supplierId, lines, operationKey: key() }))).toBe('TOO_MANY_LINES');
  const ok = await ben.mutation(p.saveOrder, { branchId, supplierId, lines: lines.slice(0, 50), operationKey: key() });
  expect((await ben.query(p.order, { orderId: ok.id as Id<'purchaseOrders'> })).lines).toHaveLength(50);
});

it('keeps held excess outside On hand until accepted by a linked order or declined', async () => {
  const { ann, branchId, variantId, supplierId, directOrder, receive, onHand } = await setup();
  const orderId = await directOrder(10);
  await receive(orderId, 10, { held: [{ variantId, quantity: 2, reason: 'Excess' }] });
  expect(await onHand()).toBe(10);
  expect((await ann.query(p.order, { orderId })).order.status).toBe('received');
  let holds = await ann.query(p.holds, { branchId, status: 'open', ...page });
  expect(holds.page).toHaveLength(1);
  const holdId = holds.page[0]._id;
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, forHoldId: holdId, lines: [{ variantId, quantity: 2 }], operationKey: key() });
  const linked = draft.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId: linked, expectedRevision: draft.revision!, operationKey: key() });
  const line = (await ann.query(p.order, { orderId: linked })).lines[0];
  await ann.mutation(p.receivePurchaseOrder, { orderId: linked, expectedIssuedRevision: 1, lines: [{ orderLineId: line._id, accepted: 2, holdId }], operationKey: key() });
  expect(await onHand()).toBe(12);
  holds = await ann.query(p.holds, { branchId, status: 'accepted', ...page });
  expect(holds.page[0]).toMatchObject({ acceptedQuantity: 2 });
  // A second hold is declined and On hand stays unchanged.
  const other = await directOrder(1);
  await receive(other, 1, { held: [{ variantId, quantity: 3, reason: 'Substitute' }] });
  const open = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  await ann.mutation(p.declineHeldGoods, { holdId: open._id, expectedRevision: open.revision, reason: 'Sent back with driver', operationKey: key() });
  expect(await onHand()).toBe(13);
  expect((await ann.query(p.holds, { branchId, status: 'open', ...page })).page).toHaveLength(0);
});

it('bounds supplier returns, reverses them, and confirms duplicate delivery references', async () => {
  const { ann, directOrder, receive, onHand } = await setup();
  const orderId = await directOrder(12);
  const receipt = await receive(orderId, 5, { deliveryReference: 'INV-77' });
  expect(await code(receive(orderId, 1, { deliveryReference: 'inv 77' }))).toBe('DUPLICATE_DELIVERY');
  await receive(orderId, 1, { deliveryReference: 'inv 77', confirmDuplicate: { receiptId: receipt.id as Id<'supplierReceipts'>, reason: 'Second truck' } });
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const ret = await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 2, reason: 'Damaged', operationKey: key() });
  expect(await onHand()).toBe(4);
  const order = await ann.query(p.order, { orderId });
  expect(order.lines[0]).toMatchObject({ accepted: 6, returned: 2, due: 6 });
  expect(await code(ann.mutation(p.correctReceipt, { receiptLineId, quantity: 4, reason: 'Too many', operationKey: key() }))).toBe('EXCEEDS_ELIGIBLE');
  await ann.mutation(p.reverseReturn, { adjustmentId: ret.id as Id<'supplierReceiptAdjustments'>, quantity: 2, reason: 'Never left', operationKey: key() });
  expect(await onHand()).toBe(6);
  const detail = await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> });
  expect(detail.lines[0]).toMatchObject({ returned: 0, eligible: 5 });
  const adjustments = await ann.query(p.receiptAdjustments, { receiptId: receipt.id as Id<'supplierReceipts'>, ...page });
  expect(adjustments.page.map(a => a.kind).sort()).toEqual(['return_reversal', 'supplier_return']);
});

it('blocks new issues for archived items or inactive suppliers while issued orders stay receivable', async () => {
  const { t, ann, branchId, variantId, supplierId, directOrder, receive, onHand } = await setup();
  const issued = await directOrder(3);
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, lines: [{ variantId, quantity: 1 }], operationKey: key() });
  await t.run(ctx => ctx.db.patch(variantId, { status: 'archived' }));
  expect(await code(ann.mutation(p.issuePurchaseOrder, { orderId: draft.id as Id<'purchaseOrders'>, expectedRevision: draft.revision!, operationKey: key() }))).toBe('ITEM_INACTIVE');
  await t.run(ctx => ctx.db.patch(variantId, { status: 'active' }));
  const supplier = (await ann.query(p.suppliers, { branchId, status: 'active', ...page })).page[0];
  await ann.mutation(p.editSupplier, { branchId, supplierId, expectedRevision: supplier.revision, name: supplier.name, status: 'inactive', operationKey: key() });
  expect(await code(ann.mutation(p.issuePurchaseOrder, { orderId: draft.id as Id<'purchaseOrders'>, expectedRevision: draft.revision!, operationKey: key() }))).toBe('SUPPLIER_INACTIVE');
  await receive(issued, 3);
  expect(await onHand()).toBe(3);
});

it('requires a reason and an explicit bypass to receive without an order while orders are open', async () => {
  const { ann, branchId, variantId, otherVariantId, directOrder, onHand } = await setup();
  await directOrder(5);
  const base = { branchId, lines: [{ variantId, accepted: 2 }] };
  expect(await code(ann.mutation(p.receiveWithoutOrder, { ...base, reason: '', operationKey: key() }))).toBe('REASON_REQUIRED');
  expect(await code(ann.mutation(p.receiveWithoutOrder, { ...base, reason: 'Walk-in', operationKey: key() }))).toBe('OPEN_ORDERS_MATCH');
  await ann.mutation(p.receiveWithoutOrder, { ...base, reason: 'Walk-in', bypassOpenOrders: true, operationKey: key() });
  await ann.mutation(p.receiveWithoutOrder, { branchId, lines: [{ variantId: otherVariantId, accepted: 1 }], reason: 'Sample', operationKey: key() });
  expect(await onHand()).toBe(2);
  expect(await onHand(otherVariantId)).toBe(1);
});

it('keys each return and reversal by its own command, so return → reverse → return posts the second stock-out once', async () => {
  const { t, ann, directOrder, receive, onHand } = await setup();
  const orderId = await directOrder(5);
  const receipt = await receive(orderId, 5);
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const first = await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 2, reason: 'Damaged', operationKey: key() });
  expect(await onHand()).toBe(3);
  await ann.mutation(p.reverseReturn, { adjustmentId: first.id as Id<'supplierReceiptAdjustments'>, quantity: 2, reason: 'Never left', operationKey: key() });
  expect(await onHand()).toBe(5);
  // Same quantity and reason as the first return: a counter-derived key would collide and silently replay it.
  const args = { receiptLineId, quantity: 2, reason: 'Damaged', operationKey: key() };
  const second = await ann.mutation(p.supplierReturn, args);
  expect(second.movementIds![0]).not.toBe(first.movementIds![0]);
  expect(await onHand()).toBe(3);
  expect(await ann.mutation(p.supplierReturn, args)).toEqual(second);
  expect(await onHand()).toBe(3);
  const movements = await t.run(ctx => ctx.db.query('stockMovements').collect());
  expect(movements.filter(m => m.kind === 'supplier_return').map(m => m.delta)).toEqual([-2, -2]);
  expect(new Set(movements.map(m => m.sourceKey)).size).toBe(movements.length);
});

it('redacts supplier contact snapshots and supplier history for staff without the buyer grant', async () => {
  const { ann, cat, t, branchId, grants, supplierId, directOrder, receive } = await setup();
  const orderId = await directOrder(3);
  const receipt = await receive(orderId, 1);
  // cat may read the branch but is not a buyer.
  await t.run(async ctx => {
    const grant = (await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', grants.cat)).unique())!;
    await ctx.db.patch(grant._id, { roles: { ...none, receiver: true } });
  });
  expect((await ann.query(p.order, { orderId })).order.supplier).toEqual({ name: 'Coastal Supply', phone: '0800' });
  expect((await cat.query(p.order, { orderId })).order.supplier).toEqual({ name: 'Coastal Supply' });
  expect((await cat.query(p.orderRevision, { orderId, revision: 1 })).supplier).toEqual({ name: 'Coastal Supply' });
  expect((await cat.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).receipt.supplier).toEqual({ name: 'Coastal Supply' });
  expect((await cat.query(p.orderReceipts, { orderId, ...page })).page[0].supplier).toEqual({ name: 'Coastal Supply' });
  expect((await cat.query(p.orders, { branchId, view: { kind: 'phase', phase: 'open' }, ...page })).page[0].supplier).toEqual({ name: 'Coastal Supply' });
  expect(await code(cat.query(p.history, { branchId, entity: 'supplier', entityId: supplierId, ...page }))).toBe('STOCK_FORBIDDEN');
  expect((await ann.query(p.history, { branchId, entity: 'supplier', entityId: supplierId, ...page })).page).toHaveLength(1);
});

it('authorizes first, replays deleted draft commands exactly, and hides deleted drafts from detail reads', async () => {
  const { t, ann, branchId, grants, variantId, supplierId } = await setup();
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, lines: [{ variantId, quantity: 1 }], operationKey: key() });
  const orderId = draft.id as Id<'purchaseOrders'>;
  const del = { orderId, expectedRevision: draft.revision!, operationKey: key() };
  const deleted = await ann.mutation(p.deletePurchaseOrderDraft, del);
  expect(await ann.mutation(p.deletePurchaseOrderDraft, del)).toEqual(deleted);
  expect(await code(ann.mutation(p.deletePurchaseOrderDraft, { ...del, operationKey: key() }))).toBe('ORDER_NOT_FOUND');
  expect(await code(ann.query(p.order, { orderId }))).toBe('ORDER_NOT_FOUND');
  expect(await code(ann.query(p.orderReceipts, { orderId, ...page }))).toBe('ORDER_NOT_FOUND');

  const request = await ann.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 1 }], operationKey: key() });
  const requestId = request.id as Id<'purchaseRequests'>;
  const remove = { requestId, expectedRevision: request.revision!, operationKey: key() };
  const removed = await ann.mutation(p.removeRequest, remove);
  expect(await ann.mutation(p.removeRequest, remove)).toEqual(removed);
  expect(await code(ann.query(p.request, { requestId }))).toBe('REQUEST_NOT_FOUND');
  expect((await ann.query(p.requests, { branchId, view: { kind: 'mine' }, ...page })).page).toHaveLength(0);

  // Revoked access fails before replay, so it cannot read back the earlier result.
  await t.run(async ctx => {
    const grant = (await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', grants.ann)).unique())!;
    await ctx.db.patch(grant._id, { roles: none });
  });
  expect(await code(ann.mutation(p.deletePurchaseOrderDraft, del))).toBe('STOCK_FORBIDDEN');
  expect(await code(ann.mutation(p.removeRequest, remove))).toBe('STOCK_FORBIDDEN');
});

it('posts per-line lot evidence for tracked receipts and traces returns, reversals and corrections to the receipt lots', async () => {
  const { t, ann, branchId, variantId, directOrder, onHand } = await setup();
  await t.run(ctx => ctx.db.insert('stockTracking', { variantId, enabledBy: 'owner', enabledAt: Date.now() }));
  const orderId = await directOrder(10);
  const orderLineId = (await ann.query(p.order, { orderId })).lines[0]._id;
  const base = { orderId, expectedIssuedRevision: 1 };
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, lines: [{ orderLineId, accepted: 4 }], operationKey: key() }))).toBe('STOCK_LOT_REQUIRED');
  expect(await code(ann.mutation(p.receivePurchaseOrder, {
    ...base, lines: [{ orderLineId, accepted: 0, rejected: 1, rejectReason: 'Torn', lotReceipt: { code: 'A1', expiresAt: Date.now() + 86_400_000 } }], operationKey: key(),
  }))).toBe('INVALID_LOT_EVIDENCE');
  const expiresAt = Date.now() + 30 * 86_400_000;
  const receipt = await ann.mutation(p.receivePurchaseOrder, { ...base, lines: [{ orderLineId, accepted: 4, lotReceipt: { code: ' A1 ', expiresAt } }], operationKey: key() });
  const lot = (await t.run(ctx => ctx.db.query('stockLots').collect()))[0];
  expect(lot).toMatchObject({ code: 'A1', expiresAt });
  const lotOnHand = () => t.run(async ctx => (await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId', q => q.eq('branchId', branchId).eq('lotId', lot._id)).unique())?.onHand);
  expect(await lotOnHand()).toBe(4);

  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  expect(await code(ann.mutation(p.supplierReturn, { receiptLineId, quantity: 2, reason: 'Damaged', lotAllocations: [{ lotId: lot._id, quantity: 1 }], operationKey: key() })))
    .toBe('INVALID_LOT_EVIDENCE');
  const ret = await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 2, reason: 'Damaged', lotAllocations: [{ lotId: lot._id, quantity: 2 }], operationKey: key() });
  expect(await lotOnHand()).toBe(2);
  await ann.mutation(p.reverseReturn, { adjustmentId: ret.id as Id<'supplierReceiptAdjustments'>, quantity: 2, reason: 'Never left', operationKey: key() });
  expect(await lotOnHand()).toBe(4);
  // The reversal restored the receipt's lot eligibility: every accepted unit can be corrected again.
  await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 4, reason: 'Wrong item', operationKey: key() });
  expect(await lotOnHand()).toBe(0);
  expect(await onHand()).toBe(0);

  // Receive without an order carries the same evidence.
  await ann.mutation(p.receiveWithoutOrder, {
    branchId, reason: 'Walk-in', bypassOpenOrders: true, lines: [{ variantId, accepted: 3, lotAllocations: [{ lotId: lot._id, quantity: 3 }] }], operationKey: key(),
  });
  expect(await lotOnHand()).toBe(3);
});

it('accepts held goods only on their own order or a linked replacement, and rechecks the link at issue', async () => {
  const { ann, branchId, variantId, otherVariantId, supplierId, directOrder, receive } = await setup();
  const first = await directOrder(2);
  await receive(first, 2, { held: [{ variantId, quantity: 2, reason: 'Excess' }] });
  const hold = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  const unrelated = await directOrder(2);
  const line = (await ann.query(p.order, { orderId: unrelated })).lines[0];
  expect(await code(ann.mutation(p.receivePurchaseOrder, {
    orderId: unrelated, expectedIssuedRevision: 1, lines: [{ orderLineId: line._id, accepted: 2, holdId: hold._id }], operationKey: key(),
  }))).toBe('HOLD_MISMATCH');
  expect(await code(ann.mutation(p.saveOrder, { branchId, supplierId, forHoldId: hold._id, lines: [{ variantId: otherVariantId, quantity: 1 }], operationKey: key() })))
    .toBe('LINK_MISMATCH');
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, forHoldId: hold._id, lines: [{ variantId, quantity: 2 }], operationKey: key() });
  await ann.mutation(p.declineHeldGoods, { holdId: hold._id, expectedRevision: hold.revision, reason: 'Driver took it back', operationKey: key() });
  expect(await code(ann.mutation(p.issuePurchaseOrder, { orderId: draft.id as Id<'purchaseOrders'>, expectedRevision: draft.revision!, operationKey: key() })))
    .toBe('LINK_NOT_FOUND');
});

it('links a follow-up receipt only for the explicitly chosen item and the corrected quantity, once', async () => {
  const { ann, branchId, variantId, otherVariantId, directOrder } = await setup();
  const orderId = await directOrder(5, [{ variantId, quantity: 5 }, { variantId: otherVariantId, quantity: 5 }]);
  const detail = await ann.query(p.order, { orderId });
  const [lineA, lineB] = detail.lines;
  const receipt = await ann.mutation(p.receivePurchaseOrder, { orderId, expectedIssuedRevision: 1, lines: [{ orderLineId: lineA._id, accepted: 5 }], operationKey: key() });
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const correction = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 2, reason: 'Wrong item', operationKey: key() });
  if (correction.outcome !== 'posted') throw new Error('expected a posting');
  const adjustmentId = correction.adjustmentId;
  const followUp = { adjustmentId, variantId, quantity: 2 };
  const base = { orderId, expectedIssuedRevision: 1 };
  // Reject-only, unrelated positive lines on the same order, short or mismatched quantities cannot close it.
  expect(await code(ann.mutation(p.receivePurchaseOrder, {
    ...base, followUp, reason: 'Still wrong', lines: [{ orderLineId: lineA._id, accepted: 0, rejected: 2, rejectReason: 'Still wrong' }], operationKey: key(),
  }))).toBe('FOLLOW_UP_EMPTY');
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, followUp, lines: [{ orderLineId: lineB._id, accepted: 3 }], operationKey: key() })))
    .toBe('FOLLOW_UP_EMPTY');
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, followUp, lines: [{ orderLineId: lineA._id, accepted: 1 }], operationKey: key() })))
    .toBe('FOLLOW_UP_EMPTY');
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, followUp: { ...followUp, quantity: 1 }, lines: [{ orderLineId: lineA._id, accepted: 1 }], operationKey: key() })))
    .toBe('FOLLOW_UP_QUANTITY');
  // A walk-in delivery with no supplier is not the corrected order's source.
  expect(await code(ann.mutation(p.receiveWithoutOrder, {
    branchId, reason: 'Walk-in', bypassOpenOrders: true, followUp, lines: [{ variantId, accepted: 2 }], operationKey: key(),
  }))).toBe('LINK_MISMATCH');
  // The goods were actually the other item: the receiver names it explicitly.
  const linked = await ann.mutation(p.receivePurchaseOrder, {
    ...base, followUp: { ...followUp, variantId: otherVariantId }, lines: [{ orderLineId: lineB._id, accepted: 2 }], operationKey: key(),
  });
  const after = await ann.query(p.receiptAdjustments, { receiptId: receipt.id as Id<'supplierReceipts'>, ...page });
  expect(after.page[0]).toMatchObject({ followUpReceiptId: linked.id });
  expect(after.page[0].followUpBranchId).toBeUndefined();
  expect((await ann.query(p.receipt, { receiptId: linked.id as Id<'supplierReceipts'> })).receipt.followUp)
    .toEqual({ adjustmentId, variantId: otherVariantId, quantity: 2 });
  const sourceHistory = await ann.query(p.history, { branchId, entity: 'receipt', entityId: receipt.id, ...page });
  expect(sourceHistory.page[0]).toMatchObject({ action: 'follow_up_received', relatedId: linked.id });
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, followUp, lines: [{ orderLineId: lineA._id, accepted: 2 }], operationKey: key() })))
    .toBe('FOLLOW_UP_CLOSED');
});

it('links a cross-branch follow-up only for staff with the stock lead grant at the source, without leaking it', async () => {
  const { t, ann, ben, branchId, otherBranchId, grants, variantId, supplierId, directOrder, receive } = await setup();
  await t.run(async ctx => {
    const now = Date.now();
    await ctx.db.insert('stockBranchPolicies', { branchId: otherBranchId, directOrder: true, directReceipt: true, revision: 1, changedBy: 'owner', changedAt: now });
    for (const name of ['ann', 'ben'] as const) {
      await ctx.db.insert('stockGrants', { staffGrantId: grants[name], branchId: otherBranchId, roles: { ...none, receiver: true }, revision: 1, changedBy: 'owner', changedAt: now });
    }
    const benSource = (await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', grants.ben)).unique())!;
    await ctx.db.patch(benSource._id, { roles: { ...all, lead: false } });
  });
  const orderId = await directOrder(4);
  const receipt = await receive(orderId, 4);
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const correction = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 4, reason: 'Delivered to Phuket', operationKey: key() });
  if (correction.outcome !== 'posted') throw new Error('expected a posting');
  const followUp = { adjustmentId: correction.adjustmentId, variantId, quantity: 4 };
  const direct = { branchId: otherBranchId, supplierId, reason: 'Misrouted delivery', bypassOpenOrders: true, lines: [{ variantId, accepted: 4 }] };
  // Ben receives at Phuket but is not a stock lead at the source: the correction reads as missing.
  const denied = await ben.mutation(p.receiveWithoutOrder, { ...direct, followUp, operationKey: key() }).catch((error: ConvexError<{ code: string; message: string }>) => error.data);
  expect(denied).toEqual({ code: 'LINK_NOT_FOUND', message: 'That correction is not waiting for a follow-up receipt.' });
  const args = { ...direct, followUp, operationKey: key() };
  const linked = await ann.mutation(p.receiveWithoutOrder, args);
  expect(await ann.mutation(p.receiveWithoutOrder, args)).toEqual(linked);
  const source = await ann.query(p.receiptAdjustments, { receiptId: receipt.id as Id<'supplierReceipts'>, ...page });
  expect(source.page[0]).toMatchObject({ followUpReceiptId: linked.id, followUpBranchId: otherBranchId });
  const level = await t.run(ctx => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', otherBranchId)).unique());
  expect(level?.onHand).toBe(4);
  expect(await code(ann.mutation(p.receiveWithoutOrder, { ...direct, followUp, operationKey: key() }))).toBe('FOLLOW_UP_CLOSED');
  await t.run(async ctx => {
    const sourceGrant = (await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', grants.ann)).unique())!;
    await ctx.db.patch(sourceGrant._id, { roles: { ...all, lead: false } });
  });
  expect(await code(ann.mutation(p.receiveWithoutOrder, args))).toBe('LINK_NOT_FOUND');
});

it('reports a correction after goods were sold since the PO, and requires a fresh review when stock moves again', async () => {
  const { t, ann, branchId, variantId, directOrder, receive, onHand } = await setup();
  const sell = (units: number) => t.run(ctx => writeStockMovement(ctx, {
    branchId, variantId, delta: -units, kind: 'sale', sourceKey: `test:sale:${key()}`, actor: 'pos',
  }));
  const orderId = await directOrder(6);
  const receipt = await receive(orderId, 6);
  await sell(5);
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const preview = await ann.query(p.correctionPreview, { receiptLineId, quantity: 3 });
  expect(preview).toMatchObject({ onHand: 1, onHandAfter: -2, negative: true, blockedBy: 'negative_stock', reportId: null });
  const blocked = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 3, reason: 'Short-shipped', operationKey: key() });
  if (blocked.outcome !== 'reported') throw new Error('expected a report');
  expect(blocked.stockRevision).toBe(preview.stockRevision);
  expect((await ann.query(p.correctionPreview, { receiptLineId, quantity: 3 })).reportId).toBe(blocked.reportId);
  // Another sale after the review: the reviewed revision no longer matches, so the override is refused.
  await sell(1);
  const stale = { receiptLineId, quantity: 3, reason: 'Short-shipped', reportId: blocked.reportId, negativeOverride: { countedOnHand: 0, stockRevision: blocked.stockRevision } };
  expect(await code(ann.mutation(p.correctReceipt, { ...stale, operationKey: key() }))).toBe('STOCK_CHANGED');
  expect(await onHand()).toBe(0);
  // Reviewing again refreshes the same report with the new revision; then the override posts and resolves it.
  const again = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 3, reason: 'Short-shipped', operationKey: key() });
  if (again.outcome !== 'reported') throw new Error('expected a report');
  expect(again.reportId).toBe(blocked.reportId);
  const posted = await ann.mutation(p.correctReceipt, { ...stale, negativeOverride: { countedOnHand: 0, stockRevision: again.stockRevision }, operationKey: key() });
  expect(posted).toMatchObject({ outcome: 'posted', resolvedReportId: blocked.reportId });
  expect(await onHand()).toBe(-3);
});

it('finds and refreshes an open correction report behind resolved reports on the receipt movement', async () => {
  const { t, ann, branchId, variantId, directOrder, receive } = await setup();
  const orderId = await directOrder(2);
  const receipt = await receive(orderId, 2);
  const line = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0];
  const reportId = await t.run(async ctx => {
    const base = { branchId, movementId: line.movementId!, actor: 'a-reporter', actorLabel: 'Reporter', createdAt: Date.now(), reason: 'Short', revision: 1 };
    for (let i = 0; i < 22; i++) await ctx.db.insert('stockProblemReports', { ...base, status: 'resolved' });
    await writeStockMovement(ctx, { branchId, variantId, delta: -2, kind: 'sale', sourceKey: 'sale:report-test', actor: 'pos' });
    return ctx.db.insert('stockProblemReports', { ...base, actor: 'z-reporter', status: 'open' });
  });
  const receiptLineId = line._id;
  expect(await ann.query(p.correctionPreview, { receiptLineId, quantity: 1 })).toMatchObject({ reportId });
  expect(await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Recount requested', operationKey: key() }))
    .toMatchObject({ outcome: 'reported', reportId });
  expect(await t.run(ctx => ctx.db.get(reportId))).toMatchObject({ revision: 2, reason: 'Recount requested' });
});

it('keeps tracked lots non-negative: a correction of sold receipt lots opens a lot reconciliation report', async () => {
  const { t, ann, branchId, variantId, directOrder, onHand } = await setup();
  await t.run(ctx => ctx.db.insert('stockTracking', { variantId, enabledBy: 'owner', enabledAt: Date.now() }));
  const orderId = await directOrder(4);
  const orderLineId = (await ann.query(p.order, { orderId })).lines[0]._id;
  const receipt = await ann.mutation(p.receivePurchaseOrder, {
    orderId, expectedIssuedRevision: 1, lines: [{ orderLineId, accepted: 4, lotReceipt: { code: 'L1', expiresAt: Date.now() + 30 * 86_400_000 } }], operationKey: key(),
  });
  await t.run(ctx => writeStockMovement(ctx, { branchId, variantId, delta: -3, kind: 'sale', sourceKey: 'test:sale:lots', actor: 'pos' }));
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  const blocked = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 2, reason: 'Overcount', operationKey: key() });
  expect(blocked).toMatchObject({ outcome: 'reported', blockedBy: 'lot_reconciliation', onHand: 1 });
  if (blocked.outcome !== 'reported') throw new Error('expected a report');
  // Even a counted override cannot push a lot below zero; the report stays open for lot reconciliation.
  const overridden = await ann.mutation(p.correctReceipt, {
    receiptLineId, quantity: 2, reason: 'Overcount', reportId: blocked.reportId, negativeOverride: { countedOnHand: 0, stockRevision: blocked.stockRevision }, operationKey: key(),
  });
  expect(overridden).toMatchObject({ outcome: 'reported', blockedBy: 'lot_reconciliation', reportId: blocked.reportId });
  expect(await onHand()).toBe(1);
  const lots = await t.run(ctx => ctx.db.query('stockLotBalances').collect());
  expect(lots.every(lot => lot.onHand >= 0)).toBe(true);
  // One unit is still in the receipt lot, so a one-unit correction posts.
  expect(await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Overcount', operationKey: key() })).toMatchObject({ outcome: 'posted' });
});

it('exposes acceptable holds on the amended original order and a linked replacement, and records the accepting order', async () => {
  const { ann, branchId, variantId, supplierId, directOrder, receive, onHand } = await setup();
  const original = await directOrder(6);
  await receive(original, 4, { held: [{ variantId, quantity: 3, reason: 'Substitute pack' }] });
  const hold = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  // Amend the open original to keep 1 unit due: the hold is acceptable there, on that line, up to the due units.
  let detail = await ann.query(p.order, { orderId: original });
  await ann.mutation(p.amendPurchaseOrder, { orderId: original, expectedRevision: detail.order.revision, reason: 'Keep one', lines: [{ orderLineId: detail.lines[0]._id, due: 1 }], operationKey: key() });
  detail = await ann.query(p.order, { orderId: original });
  expect(detail.acceptableHolds).toEqual([{ holdId: hold._id, holdRevision: hold.revision, orderLineId: detail.lines[0]._id, variantId, remaining: 3, due: 1, link: 'own_order' }]);
  const own = await ann.mutation(p.receivePurchaseOrder, {
    orderId: original, expectedIssuedRevision: detail.order.issuedRevision, lines: [{ orderLineId: detail.lines[0]._id, accepted: 1, holdId: hold._id }], operationKey: key(),
  });
  let row = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  expect(row).toMatchObject({ acceptedQuantity: 1, acceptedOrderId: original, acceptedReceiptId: own.id, orderId: original });
  expect((await ann.query(p.order, { orderId: original })).acceptableHolds).toEqual([]);
  // A linked replacement takes the rest; its detail lists the hold although it was received on the original.
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, forHoldId: hold._id, lines: [{ variantId, quantity: 2 }], operationKey: key() });
  const replacement = draft.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId: replacement, expectedRevision: draft.revision!, operationKey: key() });
  const linked = await ann.query(p.order, { orderId: replacement });
  expect(linked.holds.map(h => h._id)).toEqual([hold._id]);
  const [acceptable] = linked.acceptableHolds;
  expect(acceptable).toMatchObject({ holdId: hold._id, orderLineId: linked.lines[0]._id, remaining: 2, due: 2, link: 'replacement' });
  const rest = await ann.mutation(p.receivePurchaseOrder, {
    orderId: replacement, expectedIssuedRevision: 1, lines: [{ orderLineId: acceptable.orderLineId, accepted: 2, holdId: acceptable.holdId }], operationKey: key(),
  });
  row = (await ann.query(p.holds, { branchId, status: 'accepted', ...page })).page[0];
  expect(row).toMatchObject({ status: 'accepted', acceptedQuantity: 3, acceptedOrderId: replacement, acceptedReceiptId: rest.id, orderId: original });
  expect(await onHand()).toBe(7);
  const history = await ann.query(p.history, { branchId, entity: 'hold', entityId: hold._id, ...page });
  expect(history.page.map(event => event.action)).toEqual(['accepted', 'partially_accepted']);
  expect(history.page[0].changes).toEqual([
    { field: 'acceptedQuantity', before: 1, after: 3 },
    { field: 'acceptedOn', before: null, after: (await ann.query(p.order, { orderId: replacement })).order.reference },
    { field: 'acceptedReceipt', before: null, after: rest.reference },
  ]);
  // A declined hold is never offered and cannot be resolved twice.
  const other = await directOrder(2);
  await receive(other, 1, { held: [{ variantId, quantity: 1, reason: 'Substitute' }] });
  const declined = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  await ann.mutation(p.declineHeldGoods, { holdId: declined._id, expectedRevision: declined.revision, reason: 'Returned', operationKey: key() });
  expect((await ann.query(p.order, { orderId: other })).acceptableHolds).toEqual([]);
  expect(await code(ann.mutation(p.declineHeldGoods, { holdId: declined._id, expectedRevision: declined.revision + 1, reason: 'Again', operationKey: key() }))).toBe('HOLD_NOT_OPEN');
});

it('pages printable revisions and receipt adjustments', async () => {
  const { ann, directOrder, receive } = await setup();
  const orderId = await directOrder(10);
  for (const due of [9, 8]) {
    const detail = await ann.query(p.order, { orderId });
    await ann.mutation(p.amendPurchaseOrder, { orderId, expectedRevision: detail.order.revision, reason: `Due ${due}`, lines: [{ orderLineId: detail.lines[0]._id, due }], operationKey: key() });
  }
  const first = await ann.query(p.orderRevisions, { orderId, paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page.map(row => row.revision)).toEqual([3, 2]);
  const second = await ann.query(p.orderRevisions, { orderId, paginationOpts: { numItems: 2, cursor: first.continueCursor } });
  expect(second.page.map(row => row.revision)).toEqual([1]);
  const receipt = await receive(orderId, 5);
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  for (let i = 0; i < 3; i++) await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 1, reason: `Damaged ${i}`, operationKey: key() });
  const adjustments = await ann.query(p.receiptAdjustments, { receiptId: receipt.id as Id<'supplierReceipts'>, paginationOpts: { numItems: 2, cursor: null } });
  expect(adjustments.page.map(row => row.reason)).toEqual(['Damaged 2', 'Damaged 1']);
  expect(adjustments.isDone).toBe(false);
});

it('records concise before/after changes for request and order draft edits', async () => {
  const { ann, branchId, variantId, otherVariantId, supplierId } = await setup();
  const request = await ann.mutation(p.saveRequest, { branchId, needBy: '2026-12-01', lines: [{ variantId, quantity: 2 }], operationKey: key() });
  await ann.mutation(p.saveRequest, {
    branchId, requestId: request.id as Id<'purchaseRequests'>, expectedRevision: request.revision, needBy: '2026-12-05', note: 'x'.repeat(300),
    lines: [{ variantId, quantity: 3 }, { variantId: otherVariantId, quantity: 1 }], operationKey: key(),
  });
  const requestEdit = (await ann.query(p.history, { branchId, entity: 'request', entityId: request.id, ...page })).page[0];
  expect(requestEdit.action).toBe('edited');
  expect(requestEdit.changes).toEqual([
    { field: 'needBy', before: '2026-12-01', after: '2026-12-05' },
    { field: 'note', before: null, after: `${'x'.repeat(119)}…` },
    { field: 'lines[Sunscreen · 50 ml (SUN-50)].quantity', before: 2, after: 3 },
    { field: 'lines[Sunscreen · 100 ml (SUN-100)]', before: null, after: 1 },
  ]);
  const order = await ann.mutation(p.saveOrder, { branchId, supplierId, lines: [{ variantId, quantity: 2, unitCost: 100 }, { variantId: otherVariantId, quantity: 1 }], operationKey: key() });
  await ann.mutation(p.saveOrder, {
    branchId, supplierId, orderId: order.id as Id<'purchaseOrders'>, expectedRevision: order.revision, supplierReference: 'Q-9',
    lines: [{ variantId, quantity: 2, unitCost: 120 }], operationKey: key(),
  });
  const orderEdit = (await ann.query(p.history, { branchId, entity: 'order', entityId: order.id, ...page })).page[0];
  expect(orderEdit.changes).toEqual([
    { field: 'supplierReference', before: null, after: 'Q-9' },
    { field: 'lines[Sunscreen · 50 ml (SUN-50)].unitCost', before: 100, after: 120 },
    { field: 'lines[Sunscreen · 100 ml (SUN-100)]', before: 1, after: null },
  ]);
});

it('bounds draft edit history to a fixed number of changes', () => {
  const item = (i: number) => ({ productName: 'P', variantLabel: `V${i}` });
  const changes = draftChanges({ before: {}, after: {} }, {
    before: [], after: Array.from({ length: 50 }, (_, i) => ({ variantId: `v${i}`, item: item(i), quantity: i + 1 })),
  });
  expect(changes).toHaveLength(HISTORY_MAX_CHANGES);
  expect(changes[changes.length - 1]).toEqual({ field: 'changes.omitted', before: null, after: 50 - (HISTORY_MAX_CHANGES - 1) });
});

it('rejects order totals beyond safe integers and issues with current supplier and item details', async () => {
  const { t, ann, branchId, variantId, supplierId } = await setup();
  expect(await code(ann.mutation(p.saveOrder, {
    branchId, supplierId, lines: [{ variantId, quantity: 1_000_000, unitCost: 100_000_000_00 }], operationKey: key(),
  }))).toBe('TOTAL_TOO_LARGE');
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, lines: [{ variantId, quantity: 2, unitCost: 100 }], operationKey: key() });
  const supplier = (await ann.query(p.suppliers, { branchId, status: 'active', ...page })).page[0];
  await ann.mutation(p.editSupplier, { branchId, supplierId, expectedRevision: supplier.revision, name: 'Coastal Supply Co', phone: '0900', operationKey: key() });
  await t.run(ctx => ctx.db.patch(variantId, { label: '50 ml tube' }));
  const orderId = draft.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() });
  const copy = await ann.query(p.orderRevision, { orderId, revision: 1 });
  expect(copy.supplier).toEqual({ name: 'Coastal Supply Co', phone: '0900' });
  expect(copy.lines[0].item.variantLabel).toBe('50 ml tube');
  const detail = await ann.query(p.order, { orderId });
  expect(detail.order.supplier.name).toBe('Coastal Supply Co');
  const issued = detail.order;
  expect(await code(ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: issued.revision, reason: 'Price', lines: [{ orderLineId: detail.lines[0]._id, due: 1_000_000, unitCost: 100_000_000_00 }], operationKey: key(),
  }))).toBe('TOTAL_TOO_LARGE');
});

it('meters purchasing line and On order reads against the invocation read budget', async () => {
  const { t, ben, branchId, supplierId, variantId } = await setup();
  const variants = await t.run(async ctx => {
    const productId = (await ctx.db.query('products').first())!._id;
    return Promise.all(Array.from({ length: 50 }, (_, i) => ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label: `M${i}`, price: 1, status: 'active', revision: 1,
    })));
  });
  const draft = await ben.mutation(p.saveOrder, { branchId, supplierId, lines: variants.map(id => ({ variantId: id, quantity: 1 })), operationKey: key() });
  expect(await t.run(async ctx => {
    const lines = await readOrderLines(ctx, draft.id as Id<'purchaseOrders'>);
    await readIncoming(ctx, branchId, variantId);
    const { documents, ranges } = readBudget(ctx);
    return { lines: lines.length, documents, ranges };
  })).toEqual({ lines: 50, documents: 50, ranges: 2 });
});

it('receives undercounted units linked to the original order receipt, separate from the wrong-item follow-up', async () => {
  const { ann, branchId, variantId, otherVariantId, directOrder, onHand } = await setup();
  const orderId = await directOrder(5, [{ variantId, quantity: 5 }, { variantId: otherVariantId, quantity: 5 }]);
  const [lineA, lineB] = (await ann.query(p.order, { orderId })).lines;
  const base = { orderId, expectedIssuedRevision: 1 };
  const original = await ann.mutation(p.receivePurchaseOrder, { ...base, deliveryReference: 'INV-9', lines: [{ orderLineId: lineA._id, accepted: 3 }], operationKey: key() });
  const receiptId = original.id as Id<'supplierReceipts'>;
  const undercount = { receiptId };
  // Items not on the original, links on another order, and combined follow-up links are refused.
  expect(await code(ann.mutation(p.receivePurchaseOrder, { ...base, undercount, lines: [{ orderLineId: lineB._id, accepted: 1 }], operationKey: key() }))).toBe('UNDERCOUNT_ITEM');
  const other = await directOrder(2);
  const otherLine = (await ann.query(p.order, { orderId: other })).lines[0];
  expect(await code(ann.mutation(p.receivePurchaseOrder, { orderId: other, expectedIssuedRevision: 1, undercount, lines: [{ orderLineId: otherLine._id, accepted: 1 }], operationKey: key() })))
    .toBe('LINK_MISMATCH');
  const receiptLineId = (await ann.query(p.receipt, { receiptId })).lines[0]._id;
  const correction = await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Wrong item', operationKey: key() });
  if (correction.outcome !== 'posted') throw new Error('expected a posting');
  expect(await code(ann.mutation(p.receivePurchaseOrder, {
    ...base, undercount, followUp: { adjustmentId: correction.adjustmentId, variantId, quantity: 1 }, lines: [{ orderLineId: lineA._id, accepted: 1 }], operationKey: key(),
  }))).toBe('LINK_CONFLICT');
  // The same delivery reference needs no duplicate confirmation for its own missing units.
  const missing = await ann.mutation(p.receivePurchaseOrder, { ...base, undercount, deliveryReference: 'inv 9', lines: [{ orderLineId: lineA._id, accepted: 2 }], operationKey: key() });
  expect(await onHand()).toBe(4);
  const detail = await ann.query(p.receipt, { receiptId: missing.id as Id<'supplierReceipts'> });
  expect(detail.receipt).toMatchObject({ undercountOf: receiptId, undercountOfReference: original.reference });
  expect(detail.receipt.duplicateOfReceiptId).toBeUndefined();
  expect((await ann.query(p.history, { branchId, entity: 'receipt', entityId: receiptId, ...page })).page[0])
    .toMatchObject({ action: 'missing_units_received', relatedId: missing.id });
  // The wrong-item correction stays open for its own follow-up, and the supplement is reversible like any receipt.
  expect((await ann.query(p.receiptAdjustments, { receiptId, ...page })).page[0].followUpReceiptId).toBeUndefined();
  await ann.mutation(p.correctReceipt, { receiptLineId: detail.lines[0]._id, quantity: 2, reason: 'Counted twice', operationKey: key() });
  expect(await onHand()).toBe(2);
});

it('receives missing units of a supplierless direct delivery without the open-order bypass, matching supplier and item', async () => {
  const { ann, branchId, variantId, otherVariantId, supplierId, directOrder, onHand } = await setup();
  await directOrder(5);
  const walkIn = await ann.mutation(p.receiveWithoutOrder, { branchId, reason: 'Walk-in', bypassOpenOrders: true, lines: [{ variantId, accepted: 2 }], operationKey: key() });
  const undercount = { receiptId: walkIn.id as Id<'supplierReceipts'> };
  const base = { branchId, reason: 'Missed in count', undercount };
  expect(await code(ann.mutation(p.receiveWithoutOrder, { ...base, supplierId, lines: [{ variantId, accepted: 1 }], operationKey: key() }))).toBe('LINK_MISMATCH');
  expect(await code(ann.mutation(p.receiveWithoutOrder, { ...base, lines: [{ variantId: otherVariantId, accepted: 1 }], operationKey: key() }))).toBe('UNDERCOUNT_ITEM');
  const missing = await ann.mutation(p.receiveWithoutOrder, { ...base, lines: [{ variantId, accepted: 1 }], operationKey: key() });
  expect(await onHand()).toBe(3);
  expect((await ann.query(p.receipt, { receiptId: missing.id as Id<'supplierReceipts'> })).receipt).toMatchObject({ kind: 'direct', undercountOf: walkIn.id });
});

it('keeps one outstanding replacement per hold from the source supplier and applies the owned hold without a holdId', async () => {
  const { t, ann, branchId, variantId, supplierId, directOrder, receive, onHand } = await setup();
  const otherSupplier = (await ann.mutation(p.addSupplier, { branchId, name: 'Island Goods', operationKey: key() })).id as Id<'suppliers'>;
  const original = await directOrder(4);
  await receive(original, 4, { held: [{ variantId, quantity: 2, reason: 'Substitute pack' }] });
  const hold = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  const draft = (supplier = supplierId) => ann.mutation(p.saveOrder, { branchId, supplierId: supplier, forHoldId: hold._id, lines: [{ variantId, quantity: 3 }], operationKey: key() });
  expect(await code(draft(otherSupplier))).toBe('SUPPLIER_MISMATCH');
  const first = await draft();
  expect(await code(draft())).toBe('REPLACEMENT_EXISTS');
  // Editing the same draft is not a second commitment.
  const edited = await ann.mutation(p.saveOrder, {
    branchId, supplierId, orderId: first.id as Id<'purchaseOrders'>, expectedRevision: first.revision, forHoldId: hold._id, lines: [{ variantId, quantity: 3 }], operationKey: key(),
  });
  const replacement = first.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId: replacement, expectedRevision: edited.revision!, operationKey: key() });
  expect(await code(draft())).toBe('REPLACEMENT_EXISTS');
  const line = (await ann.query(p.order, { orderId: replacement })).lines[0];
  // No holdId: the 2 held units are applied first, the third unit is new goods; attribution stays on the hold and line.
  const result = await ann.mutation(p.receivePurchaseOrder, { orderId: replacement, expectedIssuedRevision: 1, lines: [{ orderLineId: line._id, accepted: 3 }], operationKey: key() });
  expect(await onHand()).toBe(7);
  const accepted = (await ann.query(p.holds, { branchId, status: 'accepted', ...page })).page[0];
  expect(accepted).toMatchObject({ _id: hold._id, acceptedQuantity: 2, acceptedOrderId: replacement, acceptedReceiptId: result.id, orderId: original });
  expect((await ann.query(p.receipt, { receiptId: result.id as Id<'supplierReceipts'> })).lines[0]).toMatchObject({ holdId: hold._id, holdQuantity: 2, accepted: 3 });
  // Open holds stay visible on the original order behind more than 50 resolved ones.
  await t.run(async ctx => {
    const source = (await ctx.db.get(hold._id))!;
    for (let i = 0; i < 55; i++) await ctx.db.insert('purchaseHolds', { ...omitSystem(source), status: 'declined', revision: 2 });
    await ctx.db.insert('purchaseHolds', { ...omitSystem(source), status: 'open', acceptedQuantity: 0, revision: 1 });
  });
  const detail = await ann.query(p.order, { orderId: original });
  expect(detail.holds.filter(row => row.status === 'open')).toHaveLength(1);
});

it('corrects new goods before held acceptance, then reopens the accepted hold with linked history', async () => {
  const { ann, branchId, variantId, supplierId, directOrder, receive, onHand, onOrder } = await setup();
  const original = await directOrder(1);
  await receive(original, 1, { held: [{ variantId, quantity: 2, reason: 'Excess' }] });
  const holdId = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0]._id;
  const draft = await ann.mutation(p.saveOrder, {
    branchId, supplierId, forHoldId: holdId, lines: [{ variantId, quantity: 3 }], operationKey: key(),
  });
  const orderId = draft.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() });
  const receipt = await receive(orderId, 3);
  const receiptId = receipt.id as Id<'supplierReceipts'>;
  const receiptLineId = (await ann.query(p.receipt, { receiptId })).lines[0]._id;
  const correct = { receiptLineId, quantity: 1, reason: 'Counted twice' };
  await ann.mutation(p.correctReceipt, { ...correct, operationKey: key() });
  expect((await ann.query(p.holds, { branchId, status: 'accepted', ...page })).page[0]).toMatchObject({ _id: holdId, acceptedQuantity: 2 });
  const args = { ...correct, operationKey: key() };
  const correction = await ann.mutation(p.correctReceipt, args);
  expect(await ann.mutation(p.correctReceipt, args)).toEqual(correction);
  expect((await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0]).toMatchObject({ _id: holdId, acceptedQuantity: 1 });
  expect((await ann.query(p.receipt, { receiptId })).lines[0]).toMatchObject({ holdId, holdQuantity: 2, accepted: 3, corrected: 2 });
  expect(await onOrder()).toBe(2);
  expect(await onHand()).toBe(2);
  const events = await ann.query(p.history, { branchId, entity: 'hold', entityId: holdId, ...page });
  expect(events.page[0]).toMatchObject({ action: 'acceptance_corrected', relatedId: correction.id });
  expect(events.page.map(event => event.action)).toEqual(['acceptance_corrected', 'accepted']);
});

it.each(['draft', 'open'] as const)('keeps a historical replacement closed when the same hold has a %s replacement', async phase => {
  const { ann, branchId, variantId, supplierId, directOrder, receive, onHand, onOrder } = await setup();
  const original = await directOrder(1);
  await receive(original, 1, { held: [{ variantId, quantity: 3, reason: 'Excess' }] });
  const holdId = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0]._id;
  const draft = (quantity: number) => ann.mutation(p.saveOrder, {
    branchId, supplierId, forHoldId: holdId, lines: [{ variantId, quantity }], operationKey: key(),
  });
  const issue = (order: Awaited<ReturnType<typeof draft>>) => ann.mutation(p.issuePurchaseOrder, {
    orderId: order.id as Id<'purchaseOrders'>, expectedRevision: order.revision!, operationKey: key(),
  });
  const first = await draft(1);
  await issue(first);
  const orderId = first.id as Id<'purchaseOrders'>;
  const receipt = await receive(orderId, 1);
  const second = await draft(2);
  if (phase === 'open') await issue(second);
  const hold = (await ann.query(p.holds, { branchId, status: 'open', ...page })).page[0];
  expect(hold.acceptedQuantity).toBe(1);
  await ann.mutation(p.declineHeldGoods, { holdId, expectedRevision: hold.revision, reason: 'Returned excess', operationKey: key() });
  const receiptLineId = (await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> })).lines[0]._id;
  expect(await ann.query(p.correctionPreview, { receiptLineId, quantity: 1 })).toMatchObject({ dueBefore: 0, dueAfter: 0, remainderClosed: true });
  await ann.mutation(p.correctReceipt, { receiptLineId, quantity: 1, reason: 'Counted twice', operationKey: key() });
  const historical = await ann.query(p.order, { orderId });
  expect(historical.order).toMatchObject({ phase: 'closed', dueUnits: 0 });
  expect(historical.lines[0]).toMatchObject({ accepted: 0, corrected: 1, cancelled: 1 });
  expect((await ann.query(p.holds, { branchId, status: 'declined', ...page })).page[0]).toMatchObject({ _id: holdId, acceptedQuantity: 0, resolution: 'Returned excess' });
  expect(await onOrder()).toBe(phase === 'open' ? 2 : 0);
  expect(await onHand()).toBe(1);
});

it('posts held goods without a received line on direct and purchase order receipts', async () => {
  const { ann, branchId, variantId, directOrder, receive, onHand, onOrder } = await setup();
  const orderId = await directOrder(3);
  const held = [{ variantId, quantity: 2, reason: 'Check size' }];
  const receipts = [
    await ann.mutation(p.receiveWithoutOrder, { branchId, reason: 'Held for review', lines: [], held, operationKey: key() }),
    await receive(orderId, 0, { lines: [], held }),
  ];
  for (const [index, result] of receipts.entries()) {
    expect(result.movementIds).toEqual([]);
    const receipt = await ann.query(p.receipt, { receiptId: result.id as Id<'supplierReceipts'> });
    expect(receipt.receipt).toMatchObject({ kind: index === 0 ? 'direct' : 'order', acceptedUnits: 0, heldUnits: 2 });
    expect(receipt.lines).toEqual([]);
  }
  const holds = await ann.query(p.holds, { branchId, status: 'open', ...page });
  expect(holds.page.map(hold => hold.receiptId)).toEqual(expect.arrayContaining(receipts.map(receipt => receipt.id)));
  expect(await onHand()).toBe(0);
  expect(await onOrder()).toBe(3);
});

const omitSystem = <T extends { _id: unknown; _creationTime: unknown }>(doc: T) => omit(doc, ['_id', '_creationTime']);

it('caps a receipt at 50 received plus held entries and bounds lot evidence across it', async () => {
  const { ann, branchId, variantId } = await setup();
  const held = Array.from({ length: 50 }, () => ({ variantId, quantity: 1, reason: 'Excess' }));
  expect(await code(ann.mutation(p.receiveWithoutOrder, { branchId, reason: 'Walk-in', lines: [{ variantId, accepted: 1 }], held, operationKey: key() })))
    .toBe('TOO_MANY_LINES');
  const lot = { lotReceipt: { code: 'L', expiresAt: 1 } };
  expect(() => receiptLotCount(Array.from({ length: 100 }, () => lot))).not.toThrow();
  const fail = (() => { try { receiptLotCount([...Array.from({ length: 100 }, () => lot), lot]); } catch (error) { return (error as ConvexError<{ code: string }>).data.code; } })();
  expect(fail).toBe('TOO_MANY_LOTS');
});

it('normalizes Unicode delivery references and persists duplicate confirmations on edit', async () => {
  expect(deliveryKey('inv-0042 ')).toBe(deliveryKey('INV0042'));
  expect(deliveryKey('ＩＮＶ０１')).toBe('INV01');
  expect(deliveryKey('caf\u00e9-1')).toBe(deliveryKey('cafe\u0301 1'));
  expect(deliveryKey('ใบส่งของ-๑๒')).toBe(deliveryKey('ใบส่งของ 12'));
  expect(deliveryKey('\u0E17\u0E33-1')).toBe(deliveryKey('\u0E17\u0E4D\u0E32 1'));
  // Tone marks and vowels separate distinct Thai words; a Thai-only reference is still checked.
  expect(deliveryKey('ส่ง12')).not.toBe(deliveryKey('สั่ง12'));
  expect(deliveryKey('ใบส่งของ')).toBeTruthy();

  const { ann, directOrder, receive } = await setup();
  const orderId = await directOrder(10);
  const first = await receive(orderId, 1, { deliveryReference: 'ทำ-1' });
  expect(await code(receive(orderId, 1, { deliveryReference: '\u0E17\u0E4D\u0E32 1' }))).toBe('DUPLICATE_DELIVERY');
  const second = await receive(orderId, 1, { deliveryReference: 'B-2' });
  const secondId = second.id as Id<'supplierReceipts'>;
  let row = (await ann.query(p.receipt, { receiptId: secondId })).receipt;
  expect(await code(ann.mutation(p.updateReceipt, { receiptId: secondId, expectedRevision: row.revision, deliveryReference: 'ทำ 1', operationKey: key() }))).toBe('DUPLICATE_DELIVERY');
  await ann.mutation(p.updateReceipt, {
    receiptId: secondId, expectedRevision: row.revision, deliveryReference: 'ทำ 1', confirmDuplicate: { receiptId: first.id as Id<'supplierReceipts'>, reason: 'Second truck' }, operationKey: key(),
  });
  row = (await ann.query(p.receipt, { receiptId: secondId })).receipt;
  expect(row).toMatchObject({ duplicateOfReceiptId: first.id, duplicateOfReference: first.reference, duplicateReason: 'Second truck' });
  await ann.mutation(p.updateReceipt, { receiptId: secondId, expectedRevision: row.revision, deliveryReference: 'C-3', operationKey: key() });
  row = (await ann.query(p.receipt, { receiptId: secondId })).receipt;
  expect(row.duplicateOfReceiptId).toBeUndefined();
  expect(row.duplicateReason).toBeUndefined();
});

it('finds an older request and order by reference with branch and requester visibility', async () => {
  const { t, ann, cat, branchId, otherBranchId, directOrder, approvedRequest } = await setup();
  const requestId = await approvedRequest(4);
  const orderId = await directOrder(4);
  const { request } = await ann.query(p.request, { requestId });
  const { order } = await ann.query(p.order, { orderId });
  await t.run(async ctx => {
    const requestRow = omit((await ctx.db.get(requestId))!, ['_id', '_creationTime']);
    const orderRow = omit((await ctx.db.get(orderId))!, ['_id', '_creationTime']);
    for (let i = 0; i < 26; i++) {
      await ctx.db.insert('purchaseRequests', { ...requestRow, reference: `PR-NEW-${i}`, updatedAt: request.updatedAt + i + 1 });
      await ctx.db.insert('purchaseOrders', { ...orderRow, reference: `PO-NEW-${i}`, updatedAt: order.updatedAt + i + 1 });
    }
    await ctx.db.insert('purchaseOrders', { ...orderRow, branchId: otherBranchId, reference: 'PO-HIDDEN' });
  });
  const firstRequests = await ann.query(p.requests, { branchId, view: { kind: 'all' }, ...page });
  expect(firstRequests.page.map(row => row._id)).not.toContain(requestId);
  const firstOrders = await ann.query(p.orders, { branchId, view: { kind: 'phase', phase: 'open' }, ...page });
  expect(firstOrders.page.map(row => row._id)).not.toContain(orderId);

  expect(await ann.query(p.purchaseReference, { branchId, reference: ` ${request.reference.toLowerCase()} ` }))
    .toMatchObject({ request: { _id: requestId }, order: null });
  expect(await ann.query(p.purchaseReference, { branchId, reference: order.reference }))
    .toMatchObject({ request: null, order: { _id: orderId } });
  expect(await cat.query(p.purchaseReference, { branchId, reference: request.reference })).toEqual({ request: null, order: null });
  expect(await ann.query(p.purchaseReference, { branchId, reference: 'PO-HIDDEN' })).toEqual({ request: null, order: null });
  expect(await code(ann.query(p.purchaseReference, { branchId: otherBranchId, reference: 'PO-HIDDEN' }))).toBe('STOCK_FORBIDDEN');

  const searchOrders = (search: string) => ann.query(p.orders, { branchId, view: { kind: 'openSearch', search }, ...page });
  expect((await searchOrders(order.reference.toLowerCase())).page.map(row => row._id)).toEqual([orderId]);
  expect((await searchOrders('PO-HIDDEN')).page).toEqual([]);
  await t.run(ctx => ctx.db.patch(orderId, { phase: 'closed', status: 'closed_short' }));
  expect((await searchOrders(order.reference)).page).toEqual([]);
  await t.run(ctx => ctx.db.patch(orderId, { phase: 'open', status: 'ordered', supplier: { name: 'Uncommon Supplier' } }));
  expect((await searchOrders('Uncommon')).page.map(row => row._id)).toEqual([orderId]);
  await t.run(ctx => ctx.db.patch(orderId, { supplier: { name: 'PO-Supplies ภูเก็ต' } }));
  expect((await searchOrders('PO-Supplies')).page.map(row => row._id)).toEqual([orderId]);
  expect((await searchOrders('ภูเก็ต')).page.map(row => row._id)).toEqual([orderId]);
});

it('pages posted direct receipts and finds them by receipt or normalized delivery reference within the branch', async () => {
  const { t, ann, cat, branchId, otherBranchId, supplierId, variantId } = await setup();
  const receipt = await ann.mutation(p.receiveWithoutOrder, {
    branchId, supplierId, deliveryReference: 'Inv-42', reason: 'Sample',
    lines: [{ variantId, accepted: 1 }], operationKey: key(),
  });
  const receiptId = receipt.id as Id<'supplierReceipts'>;
  await t.run(async ctx => {
    const original = omit((await ctx.db.get(receiptId))!, ['_id', '_creationTime']);
    for (let i = 0; i < 26; i++) {
      await ctx.db.insert('supplierReceipts', { ...original, reference: `GR-NEW-${i}`, createdAt: original.createdAt + i + 1 });
    }
    await ctx.db.insert('supplierReceipts', { ...original, branchId: otherBranchId, reference: 'GR-HIDDEN' });
  });
  for (const match of [undefined, { kind: 'delivery', reference: 'ＩＮＶ４２' } as const]) {
    const first = await cat.query(p.receipts, { branchId, match, ...page });
    expect(first.page).toHaveLength(25);
    expect(first.page.map(row => row._id)).not.toContain(receiptId);
    const second = await cat.query(p.receipts, { branchId, match, paginationOpts: { numItems: 25, cursor: first.continueCursor } });
    expect(second.page).toHaveLength(2);
    expect(second.page[1]).toMatchObject({ _id: receiptId, kind: 'direct', supplier: { name: 'Coastal Supply' } });
    expect(second.page[1].orderId).toBeUndefined();
    expect(second.page[1].supplier?.phone).toBeUndefined();
  }
  const match = { kind: 'receipt', reference: receipt.reference.toLowerCase() } as const;
  expect((await ann.query(p.receipts, { branchId, match, ...page })).page.map(row => row._id)).toEqual([receiptId]);
  expect((await ann.query(p.receipts, { branchId, match: { kind: 'receipt', reference: 'GR-HIDDEN' }, ...page })).page).toEqual([]);
  expect(await code(ann.query(p.receipts, { branchId: otherBranchId, match, ...page }))).toBe('STOCK_FORBIDDEN');
});

it('normalizes URL filter IDs and resolves the supplier name independently of orders', async () => {
  const { ann, branchId, otherBranchId, variantId, supplierId } = await setup();
  const resolve = (variant: string, supplier: string) => ann.query(p.queueFilter, { branchId, variant, supplier });
  expect(await resolve('nope', 'wrong')).toEqual({ variantId: null, supplier: null });
  expect(await resolve(supplierId, variantId)).toEqual({ variantId: null, supplier: null });
  expect(await resolve(variantId, supplierId)).toEqual({ variantId, supplier: { id: supplierId, name: 'Coastal Supply' } });
  expect(await code(ann.query(p.queueFilter, { branchId: otherBranchId, supplier: supplierId }))).toBe('STOCK_FORBIDDEN');
});
