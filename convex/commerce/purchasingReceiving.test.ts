// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect, it } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { seedTestBranch } from '../testing/staff.test-support';
import { overReceiptAllowance } from './private/purchasingReceipts';
import { purchasingPolicyPatch } from './private/stockAccess';

// Receiving workflows: rejection codes, over-delivery tolerance, invoice value, return outcomes and the held goods queue.
const modules = import.meta.glob('/convex/**/*.ts');
const p = api.commerce.purchasing;
const all = { requester: true, approver: true, buyer: true, receiver: true, lead: true };
const none = { requester: false, approver: false, buyer: false, receiver: false, lead: false };
let keySeq = 0;
const key = () => `rcv-key-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const page = (numItems = 25, cursor: string | null = null) => ({ paginationOpts: { numItems, cursor } });

async function code(promise: Promise<unknown>) {
  try { await promise; } catch (error) {
    if (error instanceof ConvexError) return (error.data as { code: string }).code;
    throw error;
  }
  throw new Error('Expected a ConvexError');
}

async function setup(tolerancePct?: number) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const otherBranchId = await seedTestBranch(ctx, 'phuket');
    const now = Date.now();
    for (const [name, roles] of [['ann', all], ['bob', { ...none, buyer: true }], ['dan', { ...none, receiver: true }]] as const) {
      const staffGrantId = await ctx.db.insert('staffGrants', {
        email: `${name}@example.com`, role: 'manager', tokenIdentifier: name, branchIds: [branchId, otherBranchId],
        createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
      });
      await ctx.db.insert('stockGrants', { staffGrantId, branchId, roles, revision: 1, changedBy: 'owner', changedAt: now });
    }
    await ctx.db.insert('stockBranchPolicies', {
      branchId, directOrder: true, directReceipt: true, revision: 1, changedBy: 'owner', changedAt: now,
      ...(tolerancePct ? { overReceiptTolerancePct: tolerancePct } : {}),
    });
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 1 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Sunscreen', status: 'active', vatProfile: 'standard', options: [], minPrice: 100, maxPrice: 100, variantCount: 2, sort: 1, revision: 1,
    } as never);
    const variant = (label: string, sku: string) => ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label, sku, price: 100, status: 'active', revision: 1, productName: 'Sunscreen', productStatus: 'active',
    });
    return { branchId, otherBranchId, variantId: await variant('50 ml', 'SUN-50'), otherVariantId: await variant('100 ml', 'SUN-100') };
  });
  const as = (name: string) => t.withIdentity({ email: `${name}@example.com`, emailVerified: true, tokenIdentifier: name });
  const ann = as('ann'), bob = as('bob'), dan = as('dan');
  const supplierId = (await ann.mutation(p.addSupplier, { branchId: ids.branchId, name: 'Coastal Supply', phone: '0800', operationKey: key() })).id as Id<'suppliers'>;
  const onHand = (variantId = ids.variantId) => t.run(async ctx =>
    (await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', ids.branchId)).unique())?.onHand ?? 0);
  const onOrder = async () => (await ann.query(p.incoming, { branchId: ids.branchId, variantIds: [ids.variantId] }))[0].quantity;
  async function order(quantity: number) {
    const draft = await ann.mutation(p.saveOrder, {
      branchId: ids.branchId, supplierId, lines: [{ variantId: ids.variantId, quantity, unitCost: 5_000 }], operationKey: key(),
    });
    const orderId = draft.id as Id<'purchaseOrders'>;
    await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() });
    return orderId;
  }
  async function receive(orderId: Id<'purchaseOrders'>, line: Record<string, unknown>, extra: Record<string, unknown> = {}, who = ann) {
    const detail = await ann.query(p.order, { orderId });
    return who.mutation(p.receivePurchaseOrder, {
      orderId, expectedIssuedRevision: detail.order.issuedRevision,
      lines: [{ orderLineId: detail.lines[0]._id, accepted: 0, ...line }], operationKey: key(), ...extra,
    } as never);
  }
  return { t, ...ids, ann, bob, dan, supplierId, onHand, onOrder, order, receive };
}

it('records a fixed rejection code at the door and counts rejections by reason per supplier', async () => {
  const { ann, branchId, otherBranchId, supplierId, order, receive } = await setup();
  const orderId = await order(10);
  expect(await code(receive(orderId, { accepted: 2, rejected: 1 }))).toBe('REASON_REQUIRED');
  // Free text alone no longer counts: every new rejection carries a fixed code.
  expect(await code(receive(orderId, { accepted: 2, rejected: 1, rejectReason: 'Torn' }))).toBe('REASON_REQUIRED');
  const posted = await receive(orderId, { accepted: 6, rejected: 3, rejectReasonCode: 'damaged', rejectReason: 'Crushed carton' });
  await receive(orderId, { accepted: 0, rejected: 1, rejectReasonCode: 'expired' });
  const detail = await ann.query(p.receipt, { receiptId: posted.id as Id<'supplierReceipts'> });
  expect(detail.lines[0]).toMatchObject({ rejected: 3, rejectReasonCode: 'damaged', rejectReason: 'Crushed carton' });
  expect(await code(ann.query(p.supplierRejectionSummary, { branchId: otherBranchId, supplierId }))).toBe('STOCK_FORBIDDEN');
  const summary = await ann.query(p.supplierRejectionSummary, { branchId, supplierId });
  expect(summary.byReason).toEqual([{ reason: 'damaged', units: 3 }, { reason: 'expired', units: 1 }]);
  // Rejected units stay due.
  expect((await ann.query(p.order, { orderId })).order.dueUnits).toBe(4);
});

it('accepts an overship within the branch tolerance, records it, and still routes a larger excess to hold', async () => {
  expect(overReceiptAllowance({ ordered: 12, cancelled: 0, accepted: 0 }, 10)).toBe(1);
  expect(overReceiptAllowance({ ordered: 12, cancelled: 0, accepted: 12 }, 10)).toBe(0);
  expect(overReceiptAllowance({ ordered: 12, cancelled: 0, accepted: 0 }, 0)).toBe(0);

  const off = await setup();
  expect(await code(off.receive(await off.order(12), { accepted: 13 }))).toBe('OVER_RECEIPT');

  const { ann, branchId, order, receive, onHand, onOrder, t } = await setup(10);
  const tooMany = await order(12);
  expect(await code(receive(tooMany, { accepted: 15 }))).toBe('OVER_RECEIPT');
  const orderId = await order(12);
  const posted = await receive(orderId, { accepted: 13 });
  const detail = await ann.query(p.order, { orderId });
  expect(detail.order).toMatchObject({ status: 'received', dueUnits: 0, acceptedUnits: 13 });
  expect(detail.overReceiptTolerancePct).toBe(10);
  expect(detail.lines[0]).toMatchObject({ due: 0, open: false });
  expect(await onHand()).toBe(13);
  expect(await onOrder()).toBe(12); // only the untouched 12-unit order is still on order
  const receipt = await ann.query(p.receipt, { receiptId: posted.id as Id<'supplierReceipts'> });
  expect(receipt.receipt.overDeliveredUnits).toBe(1);
  const history = await ann.query(p.history, { branchId, entity: 'order', entityId: orderId, ...page() });
  expect(history.page.map(row => row.action)).toContain('over_delivered');

  // Removing the overage is a correction that reopens nothing.
  await ann.mutation(p.correctReceipt, { receiptLineId: receipt.lines[0]._id, quantity: 1, reason: 'Overcount on delivery', operationKey: key() });
  const after = await ann.query(p.order, { orderId });
  expect(after.order).toMatchObject({ status: 'received', dueUnits: 0, acceptedUnits: 12 });
  expect(await onOrder()).toBe(12);
  const incoming = await t.run(ctx => ctx.db.query('stockIncoming').collect());
  expect(incoming.every(row => row.quantity >= 0)).toBe(true);

  expect(purchasingPolicyPatch({ overReceiptTolerancePct: 5 })).toEqual({ overReceiptTolerancePct: 5 });
  expect(purchasingPolicyPatch({ overReceiptTolerancePct: 0 })).toEqual({ overReceiptTolerancePct: undefined });
  expect(() => purchasingPolicyPatch({ overReceiptTolerancePct: 50 })).toThrow();
  expect(() => purchasingPolicyPatch({ overReceiptTolerancePct: 2.5 })).toThrow();
});

it('stores the invoice total and receipt value, shown to buyers and leads but not to receivers', async () => {
  const { ann, dan, order, receive } = await setup();
  const orderId = await order(10);
  expect(await code(receive(orderId, { accepted: 1 }, { invoiceTotal: -1 }))).toBe('INVALID_INVOICE_TOTAL');
  const posted = await receive(orderId, { accepted: 4 }, { invoiceTotal: 21_000 }, dan);
  const receiptId = posted.id as Id<'supplierReceipts'>;
  const buyerView = await ann.query(p.receipt, { receiptId });
  expect(buyerView.receipt).toMatchObject({ invoiceTotal: 21_000, acceptedValue: 20_000 });
  expect(buyerView.lines[0].unitCost).toBe(5_000);
  const receiverView = await dan.query(p.receipt, { receiptId });
  expect('invoiceTotal' in receiverView.receipt || 'acceptedValue' in receiverView.receipt).toBe(false);
  expect('unitCost' in receiverView.lines[0]).toBe(false);
  const orderReceipts = await ann.query(p.orderReceipts, { orderId, ...page() });
  expect(orderReceipts.page[0]).toMatchObject({ invoiceTotal: 21_000, acceptedValue: 20_000 });
});

it('requires a return outcome and shows returns awaiting credit on the order', async () => {
  const { ann, branchId, variantId, supplierId, order, receive, onHand } = await setup();
  const orderId = await order(10);
  const posted = await receive(orderId, { accepted: 10 });
  const receipt = await ann.query(p.receipt, { receiptId: posted.id as Id<'supplierReceipts'> });
  const receiptLineId = receipt.lines[0]._id;
  await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 2, outcome: 'credit_expected', reason: 'Damaged goods', operationKey: key() });
  await ann.mutation(p.supplierReturn, { receiptLineId, quantity: 1, outcome: 'replacement_expected', reason: 'Wrong item supplied', operationKey: key() });
  expect(await onHand()).toBe(7);
  const adjustments = await ann.query(p.receiptAdjustments, { receiptId: receipt.receipt._id, ...page() });
  expect(adjustments.page.map(row => row.returnOutcome).sort()).toEqual(['credit_expected', 'replacement_expected']);
  expect((await ann.query(p.order, { orderId })).returnsAwaitingCredit).toEqual({ count: 1, units: 2 });
  // A return that already has a replacement order cannot be reversed until that order is cancelled or closed.
  const replacementReturn = adjustments.page.find(row => row.returnOutcome === 'replacement_expected')!;
  const replacement = await ann.mutation(p.saveOrder, {
    branchId, supplierId, replacesReturnId: replacementReturn._id, lines: [{ variantId, quantity: 1 }], operationKey: key(),
  });
  expect(await code(ann.mutation(p.reverseReturn, {
    adjustmentId: replacementReturn._id, quantity: 1, reason: 'Never left', operationKey: key(),
  }))).toBe('REPLACEMENT_EXISTS');
  await ann.mutation(p.deletePurchaseOrderDraft, { orderId: replacement.id as Id<'purchaseOrders'>, expectedRevision: replacement.revision!, operationKey: key() } as never);
  await ann.mutation(p.reverseReturn, { adjustmentId: replacementReturn._id, quantity: 1, reason: 'Never left', operationKey: key() });
  expect(await onHand()).toBe(8);
});

it('lets a buyer accept a hold onto its own open order from the queue, and shows only valid paths otherwise', async () => {
  const { ann, bob, branchId, variantId, order, receive, onHand } = await setup();
  const orderId = await order(10);
  // 6 accepted, 4 substitute units held; the order still has 4 due.
  await receive(orderId, { accepted: 6 }, { held: [{ variantId, quantity: 4, reason: 'Substitute pack size' }] });
  const queue = await bob.query(p.holds, { branchId, status: 'open', ...page() });
  const row = queue.page[0];
  expect(row).toMatchObject({ unresolved: 4, supplierName: 'Coastal Supply', acceptPath: { kind: 'own_order', orderId, due: 4 } });
  expect(await code(bob.mutation(p.acceptHeldGoods, { holdId: row._id, expectedRevision: row.revision + 1, operationKey: key() }))).toBe('STALE');
  const accepted = await bob.mutation(p.acceptHeldGoods, { holdId: row._id, expectedRevision: row.revision, operationKey: key() });
  expect(accepted.reference).toMatch(/^GR-/);
  expect(await onHand()).toBe(10);
  const hold = (await bob.query(p.holds, { branchId, status: 'accepted', ...page() })).page[0];
  expect(hold).toMatchObject({ status: 'accepted', acceptedQuantity: 4, unresolved: 0, acceptPath: null, acceptedOrderId: orderId });
  expect((await ann.query(p.order, { orderId })).order.status).toBe('received');
  expect(await ann.query(p.openHoldCount, { branchId })).toEqual({ count: 0, capped: false });

  // A fully received order cannot absorb another hold: the queue offers only linked-order or decline paths.
  const second = await order(5);
  await receive(second, { accepted: 5 }, { held: [{ variantId, quantity: 2, reason: 'Extra cartons' }] });
  const [extra] = (await bob.query(p.holds, { branchId, status: 'open', ...page() })).page;
  expect(extra.acceptPath).toMatchObject({ kind: 'order_closed', orderId: second });
  expect(await code(bob.mutation(p.acceptHeldGoods, { holdId: extra._id, expectedRevision: extra.revision, operationKey: key() }))).toBe('HOLD_NO_DUE');
  expect(await ann.query(p.openHoldCount, { branchId })).toEqual({ count: 1, capped: false });
});

it('returns no hold count to branch staff without stock permissions and forbids another branch', async () => {
  const { t, branchId, otherBranchId } = await setup();
  await t.run(async ctx => {
    const now = Date.now();
    await ctx.db.insert('staffGrants', {
      email: 'eve@example.com', role: 'manager', tokenIdentifier: 'eve', branchIds: [branchId],
      createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
    });
  });
  const eve = t.withIdentity({ email: 'eve@example.com', emailVerified: true, tokenIdentifier: 'eve' });
  expect(await eve.query(p.openHoldCount, { branchId })).toBeNull();
  await expect(eve.query(p.openHoldCount, { branchId: otherBranchId })).rejects.toThrow();
});

it('finds holds by exact receipt reference or item beyond the first page, within the branch only', async () => {
  const { t, ann, branchId, otherBranchId, variantId, otherVariantId, order, receive } = await setup();
  const orderId = await order(30);
  const first = await receive(orderId, { accepted: 1 }, { held: [{ variantId: otherVariantId, quantity: 1, reason: 'Wrong size' }] });
  for (let i = 0; i < 3; i++) await receive(orderId, { accepted: 1 }, { held: [{ variantId, quantity: 1, reason: `Extra ${i}` }] });
  // Another branch's hold with the same receipt reference never matches.
  await t.run(async ctx => {
    const receipt = (await ctx.db.get(first.id as Id<'supplierReceipts'>))!;
    await ctx.db.insert('purchaseHolds', {
      branchId: otherBranchId, status: 'open', receiptId: receipt._id, receiptReference: receipt.reference, variantId: otherVariantId,
      item: { productName: 'Sunscreen', variantLabel: '100 ml' }, quantity: 1, acceptedQuantity: 0, reason: 'Elsewhere', createdAt: Date.now(), revision: 1,
    });
  });
  const firstPage = await ann.query(p.holds, { branchId, status: 'open', ...page(1) });
  expect(firstPage.page[0].receiptReference).not.toBe(first.reference);
  const byReference = await ann.query(p.holds, { branchId, status: 'open', receiptReference: ` ${first.reference!.toLowerCase()} `, ...page(1) });
  expect(byReference.page.map(row => row.receiptReference)).toEqual([first.reference]);
  expect(byReference.page[0].branchId).toBe(branchId);
  const byItem = await ann.query(p.holds, { branchId, status: 'open', variantId: otherVariantId, ...page() });
  expect(byItem.page.map(row => row.reason)).toEqual(['Wrong size']);
  expect((await ann.query(p.holds, { branchId, status: 'open', variantId, ...page() })).page).toHaveLength(3);
});

it('records handoff evidence when declined goods leave, and older declines still render', async () => {
  const { t, ann, bob, dan, branchId, variantId, order, receive } = await setup();
  const orderId = await order(10);
  await receive(orderId, { accepted: 10 }, { held: [{ variantId, quantity: 3, reason: 'Not ordered' }] });
  const [hold] = (await bob.query(p.holds, { branchId, status: 'open', ...page() })).page;
  expect(await code(dan.mutation(p.declineHeldGoods, { holdId: hold._id, expectedRevision: hold.revision, reason: 'x', operationKey: key() }))).toBe('STOCK_FORBIDDEN');
  const declined = await bob.mutation(p.declineHeldGoods, {
    holdId: hold._id, expectedRevision: hold.revision, reason: 'Returned to supplier driver',
    handoff: { carrier: 'Kerry Express', returnReference: 'RMA-881' }, operationKey: key(),
  });
  let row = (await bob.query(p.holds, { branchId, status: 'declined', ...page() })).page[0];
  expect(row.handoff).toEqual({ carrier: 'Kerry Express', returnReference: 'RMA-881' });
  // The pickup is a separate handoff.
  await bob.mutation(p.recordHeldGoodsHandoff, {
    holdId: hold._id, expectedRevision: declined.revision!, handoff: { note: 'Driver signed slip', collected: true }, operationKey: key(),
  });
  row = (await bob.query(p.holds, { branchId, status: 'declined', ...page() })).page[0];
  expect(row.handoff).toMatchObject({ carrier: 'Kerry Express', returnReference: 'RMA-881', note: 'Driver signed slip' });
  expect(row.handoff?.collectedAt).toBeTypeOf('number');
  const history = await ann.query(p.history, { branchId, entity: 'hold', entityId: hold._id, ...page() });
  expect(history.page.map(event => event.action)).toEqual(['handoff_recorded', 'declined']);

  // A decline recorded before handoff evidence existed (and before holds kept their supplier) still lists.
  await t.run(async ctx => {
    const original = (await ctx.db.get(hold._id))!;
    await ctx.db.insert('purchaseHolds', {
      branchId, status: 'declined', receiptId: original.receiptId, receiptReference: original.receiptReference, variantId,
      item: original.item, quantity: 1, acceptedQuantity: 0, reason: 'Legacy', resolution: 'Sent back', createdAt: 1, revision: 2,
    });
  });
  const legacy = (await bob.query(p.holds, { branchId, status: 'declined', ...page() })).page.find(r => r.reason === 'Legacy')!;
  expect(legacy).toMatchObject({ resolution: 'Sent back', supplierName: 'Coastal Supply', unresolved: 0 });
  expect(legacy.handoff).toBeUndefined();
});
