// @vitest-environment edge-runtime
/**
 * Purchasing requests, orders and branch policies: staff display names, requester views, approval context and
 * snapshots, need-by rules, copying, order valuation, TBC prices, amendments, separation of duties, the direct order
 * limit, reference fragments, receipt exceptions and receipt lateness.
 */
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect, it } from 'vitest';
import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { addDays } from '../shared/dates';
import { resortTodayIso } from '../shared/time';
import { staffDisplayName } from './private/purchasingCore';
import { purchasingPolicyPatch } from './private/stockAccess';
import { seedTestBranch } from '../testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const p = api.commerce.purchasing;
const all = { requester: true, approver: true, buyer: true, receiver: true, lead: true };
const none = { requester: false, approver: false, buyer: false, receiver: false, lead: false };
let keySeq = 0;
const key = () => `policy-key-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const page = { paginationOpts: { numItems: 25, cursor: null } };
const today = () => resortTodayIso();

async function code(promise: Promise<unknown>) {
  try { await promise; } catch (error) {
    if (error instanceof ConvexError) return (error.data as { code: string }).code;
    throw error;
  }
  throw new Error('Expected a ConvexError');
}

async function setup(options: { benApprover?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const now = Date.now();
    const people = [
      ['ann', 'ann.lee+clerk_test@example.com', all],
      ['ben', 'ben-2@example.com', options.benApprover === false ? { ...all, approver: false } : all],
      ['cat', 'cat@example.com', { ...none, requester: true }],
    ] as const;
    for (const [token, email, roles] of people) {
      const staffGrantId = await ctx.db.insert('staffGrants', {
        email, role: 'manager', tokenIdentifier: token, branchIds: [branchId], createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
      });
      await ctx.db.insert('stockGrants', { staffGrantId, branchId, roles, revision: 1, changedBy: 'owner', changedAt: now });
    }
    const policyId = await ctx.db.insert('stockBranchPolicies', { branchId, directOrder: true, directReceipt: true, revision: 1, changedBy: 'owner', changedAt: now });
    const categoryId = await ctx.db.insert('productCategories', { name: 'Spa', sort: 1 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Aloe gel', status: 'active', vatProfile: 'standard', options: [], minPrice: 100, maxPrice: 100, variantCount: 2, sort: 1, revision: 1,
    } as never);
    const variant = (label: string, sku: string) => ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label, sku, price: 100, status: 'active', revision: 1, productName: 'Aloe gel', productStatus: 'active',
    });
    return { branchId, policyId, productId, variantId: await variant('120 mL', 'ALOE-120'), otherVariantId: await variant('250 mL', 'ALOE-250') };
  });
  const as = (token: string, email: string) => t.withIdentity({ email, emailVerified: true, tokenIdentifier: token });
  const ann = as('ann', 'ann.lee+clerk_test@example.com'), ben = as('ben', 'ben-2@example.com'), cat = as('cat', 'cat@example.com');
  const supplierId = (await ann.mutation(p.addSupplier, { branchId: ids.branchId, name: 'Samui Spa Supply', operationKey: key() })).id as Id<'suppliers'>;
  const setPolicy = (patch: Record<string, unknown>) => t.run(ctx => ctx.db.patch(ids.policyId, patch));

  async function submitted(by: typeof ann, quantity: number, needBy?: string, variantId = ids.variantId) {
    const draft = await by.mutation(p.saveRequest, { branchId: ids.branchId, needBy, lines: [{ variantId, quantity }], operationKey: key() });
    const requestId = draft.id as Id<'purchaseRequests'>;
    const result = await by.mutation(p.submitRequestForApproval, { requestId, expectedRevision: draft.revision!, operationKey: key() });
    return { requestId, revision: result.revision!, result };
  }
  async function order(lines: { variantId?: Id<'productVariants'>; quantity: number; unitCost?: number; priceTbc?: boolean }[], issue = true, by = ann) {
    const draft = await by.mutation(p.saveOrder, {
      branchId: ids.branchId, supplierId, lines: lines.map(line => ({ variantId: ids.variantId, ...line })), operationKey: key(),
    });
    const orderId = draft.id as Id<'purchaseOrders'>;
    const issued = issue ? await by.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() }) : null;
    return { orderId, draft, issued };
  }
  async function receive(by: typeof ann, orderId: Id<'purchaseOrders'>, accepted: number, extra: Record<string, unknown> = {}) {
    const detail = await by.query(p.order, { orderId });
    return by.mutation(p.receivePurchaseOrder, {
      orderId, expectedIssuedRevision: detail.order.issuedRevision, lines: [{ orderLineId: detail.lines[0]._id, accepted, ...extra }], operationKey: key(),
    });
  }
  return { t, ...ids, ann, ben, cat, supplierId, setPolicy, submitted, order, receive };
}

it('P01: shows short staff names, never a login email, on lists, history, receipts and old events', async () => {
  expect(staffDisplayName('arch-e2e-cashier-c9d5+clerk_test@example.com')).toBe('Arch Cashier');
  expect(staffDisplayName('ann.lee+clerk_test@example.com')).toBe('Ann Lee');
  expect(staffDisplayName('1234@example.com')).toBe('Staff member');
  expect(staffDisplayName('Nok')).toBe('Nok');
  const { t, ann, ben, branchId, submitted, order, receive } = await setup();
  const { requestId } = await submitted(ann, 4);
  // An event stored before this change kept the full login.
  await t.run(ctx => ctx.db.insert('purchaseEvents', {
    entity: 'request', entityId: requestId, branchId, action: 'edited', actorKey: 'ann', actorLabel: 'ann.lee+clerk_test@example.com', createdAt: Date.now(),
  }));
  const list = await ben.query(p.requests, { branchId, view: { kind: 'all' }, ...page });
  expect(list.page[0].requesterLabel).toBe('Ann Lee');
  const history = await ben.query(p.history, { branchId, entity: 'request', entityId: requestId, ...page });
  expect(history.page.every(event => !event.actorLabel.includes('@'))).toBe(true);
  const { orderId } = await order([{ quantity: 2, unitCost: 100 }]);
  const receipt = await receive(ben, orderId, 1);
  const detail = await ann.query(p.receipt, { receiptId: receipt.id as Id<'supplierReceipts'> });
  expect(detail.receipt.actorLabel).toBe('Ben');
  const revisions = await ann.query(p.orderRevisions, { orderId, ...page });
  expect(revisions.page[0].actorLabel).toBe('Ann Lee');
});

it('P02: the supplier copy names the buying business, delivery address and receiving contact, not a login', async () => {
  const { ann, setPolicy, order } = await setup();
  await setPolicy({ receivingContact: 'Front store', receivingPhone: '077 000 111' });
  const { orderId } = await order([{ quantity: 2, unitCost: 100 }]);
  const copy = await ann.query(p.orderRevision, { orderId, revision: 1 });
  expect(copy.buyer.legalName).not.toBe('');
  expect(copy.buyer).toMatchObject({ receivingContact: 'Front store', receivingPhone: '077 000 111', contactName: 'Ann Lee' });
  expect(JSON.stringify(copy)).not.toContain('@example.com');
});

it('P03: a requester-only user lists their own sent-back requests through an index, with a count', async () => {
  const { cat, ben, branchId, submitted } = await setup();
  const first = await submitted(cat, 3);
  await submitted(cat, 5);
  await ben.mutation(p.sendBackPurchaseRequest, { requestId: first.requestId, expectedRevision: first.revision, reason: 'Fewer', operationKey: key() });
  const view = await cat.query(p.requests, { branchId, view: { kind: 'mineStatus', status: 'needs_changes' }, ...page });
  expect(view.page.map(row => row._id)).toEqual([first.requestId]);
  expect(await cat.query(p.myRequestCountsAt, { branchId })).toEqual({ needsChanges: 1, drafts: 0 });
  expect(await code(cat.query(p.requests, { branchId, view: { kind: 'approvalQueue' }, ...page }))).toBe('STOCK_FORBIDDEN');
});

it('P04/P07: sorts the approval queue by need-by then submission, and rejects past need-by dates', async () => {
  const { cat, ben, branchId, variantId, submitted } = await setup();
  expect(await code(cat.mutation(p.saveRequest, { branchId, needBy: addDays(today(), -1), lines: [{ variantId, quantity: 1 }], operationKey: key() })))
    .toBe('DATE_IN_PAST');
  const late = await submitted(cat, 1, addDays(today(), 9));
  const none = await submitted(cat, 1);
  const urgent = await submitted(cat, 1, addDays(today(), 2));
  const queue = await ben.query(p.requests, { branchId, view: { kind: 'approvalQueue' }, ...page });
  expect(queue.page.map(row => row._id)).toEqual([urgent.requestId, late.requestId, none.requestId]);
  expect(queue.page[0]).toMatchObject({ itemSummary: ['Aloe gel'], lineCount: 1 });
});

it('P07: keeps an unchanged older need-by date on edit', async () => {
  const { t, cat, branchId, variantId } = await setup();
  const draft = await cat.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 1 }], operationKey: key() });
  const old = addDays(today(), -3);
  await t.run(ctx => ctx.db.patch(draft.id as Id<'purchaseRequests'>, { needBy: old }));
  const edited = await cat.mutation(p.saveRequest, {
    branchId, requestId: draft.id as Id<'purchaseRequests'>, expectedRevision: draft.revision, needBy: old, lines: [{ variantId, quantity: 2 }], operationKey: key(),
  });
  expect(edited.revision).toBe(2);
});

it('P05/P45: approvers see stock context per line, and the decision records requested → approved quantities', async () => {
  const { ann, ben, cat, branchId, submitted, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 10, unitCost: 12_500 }]);
  await receive(ben, orderId, 8);
  const other = await submitted(cat, 6);
  await ben.mutation(p.approvePurchaseRequest, { requestId: other.requestId, expectedRevision: other.revision, operationKey: key() });
  const mine = await submitted(cat, 20);
  const detail = await ann.query(p.request, { requestId: mine.requestId });
  expect(detail.lines[0].context).toEqual({ onHand: 8, onOrder: 2, otherDemand: 6, lastUnitCost: 12_500 });
  await ann.mutation(p.approvePurchaseRequest, {
    requestId: mine.requestId, expectedRevision: mine.revision, lines: [{ lineId: detail.lines[0]._id, approvedQuantity: 12 }], operationKey: key(),
  });
  const history = await cat.query(p.history, { branchId, entity: 'request', entityId: mine.requestId, ...page });
  expect(history.page[0]).toMatchObject({
    action: 'approved', actorLabel: 'Ann Lee',
    changes: [{ field: 'lines[Aloe gel · 120 mL (ALOE-120)].approved', before: 20, after: 12 }],
  });
  // Requester-only staff do not get cost context.
  expect((await cat.query(p.request, { requestId: mine.requestId })).lines[0].context.lastUnitCost).toBeUndefined();
});

it('P06/P41: a fully ordered request leaves the default Approved view; closing the remainder brings it back or closes it', async () => {
  const { ann, ben, cat, branchId, variantId, supplierId, submitted } = await setup();
  const { requestId, revision } = await submitted(cat, 10);
  await ben.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: revision, operationKey: key() });
  const lineId = (await ann.query(p.request, { requestId })).lines[0]._id;
  const draft = await ann.mutation(p.saveOrder, { branchId, supplierId, requestId, lines: [{ variantId, quantity: 10, requestLineId: lineId, unitCost: 100 }], operationKey: key() });
  const orderId = draft.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: draft.revision!, operationKey: key() });
  const open = () => ben.query(p.requests, { branchId, view: { kind: 'approved', fullyOrdered: false }, ...page }).then(r => r.page.map(row => row._id));
  const full = () => ben.query(p.requests, { branchId, view: { kind: 'approved', fullyOrdered: true }, ...page }).then(r => r.page.map(row => row._id));
  expect(await open()).toEqual([]);
  expect(await full()).toEqual([requestId]);
  expect((await ann.query(p.request, { requestId })).request.fullyOrdered).toBe(true);
  const detail = await ann.query(p.order, { orderId });
  expect(detail.sourceRequest).toMatchObject({ id: requestId, status: 'approved' });
  await ann.mutation(p.closePurchaseOrderRemainder, { orderId, expectedRevision: detail.order.revision, reason: 'Supplier out', operationKey: key() });
  expect(await open()).toEqual([requestId]);

  // A lead can also close the remaining demand in the same step.
  const second = await submitted(cat, 4);
  await ben.mutation(p.approvePurchaseRequest, { requestId: second.requestId, expectedRevision: second.revision, operationKey: key() });
  const secondLine = (await ann.query(p.request, { requestId: second.requestId })).lines[0]._id;
  const d2 = await ann.mutation(p.saveOrder, { branchId, supplierId, requestId: second.requestId, lines: [{ variantId, quantity: 4, requestLineId: secondLine, unitCost: 100 }], operationKey: key() });
  const o2 = d2.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId: o2, expectedRevision: d2.revision!, operationKey: key() });
  const o2detail = await ann.query(p.order, { orderId: o2 });
  await ann.mutation(p.closePurchaseOrderRemainder, { orderId: o2, expectedRevision: o2detail.order.revision, reason: 'No longer needed', closeRequestDemand: true, operationKey: key() });
  expect((await ann.query(p.request, { requestId: second.requestId })).request.status).toBe('closed');
});

it('P09: copies a declined request into a new draft, skipping archived items, and links both histories', async () => {
  const { t, cat, ben, branchId, variantId, otherVariantId } = await setup();
  const draft = await cat.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 20 }, { variantId: otherVariantId, quantity: 2 }], operationKey: key() });
  const requestId = draft.id as Id<'purchaseRequests'>;
  const sent = await cat.mutation(p.submitRequestForApproval, { requestId, expectedRevision: draft.revision!, operationKey: key() });
  await ben.mutation(p.declinePurchaseRequest, { requestId, expectedRevision: sent.revision!, reason: 'Too many', operationKey: key() });
  await t.run(ctx => ctx.db.patch(otherVariantId, { status: 'archived' }));
  const copy = await cat.mutation(p.copyPurchaseRequest, { requestId, operationKey: key() });
  expect(copy.skipped).toBe(1);
  const detail = await cat.query(p.request, { requestId: copy.id as Id<'purchaseRequests'> });
  expect(detail.request).toMatchObject({ status: 'draft', copiedFromId: requestId });
  expect(detail.lines.map(line => [line.variantId, line.quantity])).toEqual([[variantId, 20]]);
  expect((await cat.query(p.request, { requestId })).request.status).toBe('declined');
  const sourceHistory = await cat.query(p.history, { branchId, entity: 'request', entityId: requestId, ...page });
  expect(sourceHistory.page[0]).toMatchObject({ action: 'copied_to', relatedId: copy.id });
});

it('P10: warns on submit when no other approver exists, and still blocks self-approval', async () => {
  const lone = await setup({ benApprover: false });
  const { result, requestId, revision } = await lone.submitted(lone.ann, 2);
  expect(result.warning).toMatch(/No other approver/);
  expect(await lone.ann.query(p.requestApproverCoverage, { branchId: lone.branchId })).toMatchObject({ otherApprovers: 0 });
  expect(await code(lone.ann.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: revision, operationKey: key() }))).toBe('SELF_APPROVAL');
  const covered = await setup();
  expect((await covered.submitted(covered.ann, 2)).result.warning).toBeUndefined();
});

it('P11: lists overdue and due-this-week open orders through the expected-date index', async () => {
  const { t, ann, branchId, order } = await setup();
  const late = await order([{ quantity: 1, unitCost: 100 }]);
  const soon = await order([{ quantity: 1, unitCost: 100 }]);
  await order([{ quantity: 1, unitCost: 100 }]);
  await t.run(async ctx => {
    await ctx.db.patch(late.orderId, { expectedDate: addDays(today(), -2) });
    await ctx.db.patch(soon.orderId, { expectedDate: addDays(today(), 3) });
  });
  const overdue = await ann.query(p.orders, { branchId, view: { kind: 'overdue' }, ...page });
  expect(overdue.page.map(row => row._id)).toEqual([late.orderId]);
  const dueSoon = await ann.query(p.orders, { branchId, view: { kind: 'dueSoon' }, ...page });
  expect(dueSoon.page.map(row => row._id)).toEqual([soon.orderId]);
  expect(overdue.page[0].expectedDate! < today()).toBe(true);
});

it('P07: rejects a past expected date on a purchase order', async () => {
  const { ann, branchId, variantId, supplierId } = await setup();
  expect(await code(ann.mutation(p.saveOrder, {
    branchId, supplierId, expectedDate: addDays(today(), -1), lines: [{ variantId, quantity: 1, unitCost: 100 }], operationKey: key(),
  }))).toBe('DATE_IN_PAST');
});

it('P13/P15/P18: values accepted units at receipt cost and the remainder at the amended price, and counts rejections', async () => {
  const { ann, ben, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 12, unitCost: 12_500 }]);
  await receive(ben, orderId, 5, { rejected: 1, rejectReasonCode: 'damaged', rejectReason: 'Seal damaged on arrival' });
  let detail = await ann.query(p.order, { orderId });
  expect(detail.lines[0]).toMatchObject({ ordered: 12, accepted: 5, rejected: 1, due: 7 });
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'New price list', lines: [{ orderLineId: detail.lines[0]._id, unitCost: 14_000 }], operationKey: key(),
  });
  detail = await ann.query(p.order, { orderId });
  expect(detail.order).toMatchObject({ receivedValue: 62_500, outstandingValue: 98_000, totalCost: 160_500, unpricedLines: 0, rejectedUnits: 1 });
  const receipts = await ann.query(p.orderReceipts, { orderId, ...page });
  const receipt = await ann.query(p.receipt, { receiptId: receipts.page[0]._id });
  expect(receipt.lines[0].unitCost).toBe(12_500);
});

it('P14: issue needs a unit cost or an explicit TBC flag, which prints and counts as unpriced', async () => {
  const { ann, order } = await setup();
  const unpriced = await order([{ quantity: 2 }], false);
  expect(await code(ann.mutation(p.issuePurchaseOrder, { orderId: unpriced.orderId, expectedRevision: unpriced.draft.revision!, operationKey: key() }))).toBe('PRICE_REQUIRED');
  const tbc = await order([{ quantity: 2, priceTbc: true }]);
  const copy = await ann.query(p.orderRevision, { orderId: tbc.orderId, revision: 1 });
  expect(copy.lines[0]).toMatchObject({ priceTbc: true });
  expect((await ann.query(p.order, { orderId: tbc.orderId })).order.unpricedLines).toBe(1);
});

it('P16/P17: an amendment can add a line (policy-checked) and a no-op amendment issues no revision', async () => {
  const { ann, otherVariantId, order } = await setup();
  const { orderId } = await order([{ quantity: 3, unitCost: 100 }]);
  let detail = await ann.query(p.order, { orderId });
  expect(await code(ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Nothing', lines: [{ orderLineId: detail.lines[0]._id, due: 3, unitCost: 100 }], operationKey: key(),
  }))).toBe('NO_CHANGES');
  expect((await ann.query(p.order, { orderId })).order.issuedRevision).toBe(1);
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Supplier adds gel', lines: [],
    addLines: [{ variantId: otherVariantId, quantity: 4, unitCost: 250 }], operationKey: key(),
  });
  detail = await ann.query(p.order, { orderId });
  expect(detail.lines).toHaveLength(2);
  expect(detail.order).toMatchObject({ issuedRevision: 2, dueUnits: 7 });
  const copy = await ann.query(p.orderRevision, { orderId, revision: 2 });
  expect(copy.lines.map(line => line.variantId)).toContain(otherVariantId);
  const history = await ann.query(p.history, { branchId: detail.order.branchId, entity: 'order', entityId: orderId, ...page });
  expect(history.page[0].changes?.map(change => change.field)).toContain('lines[Aloe gel · 250 mL (ALOE-250)]');
  expect(await code(ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'More', lines: [],
    addLines: [{ variantId: otherVariantId, quantity: 1, unitCost: 1 }], operationKey: key(),
  }))).toBe('DUPLICATE_LINE');
});

it('P16: blocks a direct new line without the direct-order policy', async () => {
  const { ann, otherVariantId, setPolicy, order } = await setup();
  const { orderId } = await order([{ quantity: 3, unitCost: 100 }]);
  await setPolicy({ directOrder: false });
  const detail = await ann.query(p.order, { orderId });
  expect(await code(ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Add', lines: [], addLines: [{ variantId: otherVariantId, quantity: 1, unitCost: 1 }], operationKey: key(),
  }))).toBe('DIRECT_ORDER_DISABLED');
});

it('P37/P42: lists receipts with exceptions and shows each order receipt with its revision and lateness', async () => {
  const { t, ann, ben, branchId, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 6, unitCost: 100 }]);
  await t.run(async ctx => {
    const revision = await ctx.db.query('purchaseOrderRevisions').withIndex('by_orderId_and_revision', q => q.eq('orderId', orderId).eq('revision', 1)).unique();
    await ctx.db.patch(revision!._id, { expectedDate: addDays(today(), -2) });
  });
  await receive(ben, orderId, 2);
  await receive(ben, orderId, 1, { rejected: 1, rejectReasonCode: 'damaged', rejectReason: 'Leaking' });
  const exceptions = await ann.query(p.receipts, { branchId, exceptionsOnly: true, ...page });
  expect(exceptions.page.map(row => row.rejectedUnits)).toEqual([1]);
  const receipts = await ann.query(p.orderReceipts, { orderId, ...page });
  expect(receipts.page.map(row => [row.orderRevision, row.lateDays])).toEqual([[1, 2], [1, 2]]);
});

it('P39: with separation of duties on, the current revision issuer cannot receive; off, the receipt is flagged', async () => {
  const { ann, ben, branchId, setPolicy, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 4, unitCost: 100 }]);
  const flagged = await receive(ann, orderId, 1);
  expect((await ann.query(p.receipt, { receiptId: flagged.id as Id<'supplierReceipts'> })).receipt.selfReceipt).toBe(true);
  const history = await ann.query(p.history, { branchId, entity: 'order', entityId: orderId, ...page });
  expect(history.page.map(event => event.action)).toContain('self_received');
  await setPolicy({ separateReceiving: true });
  expect(await code(receive(ann, orderId, 1))).toBe('SELF_RECEIPT');
  // Ben amends, so Ben issued the current revision: now Ben is blocked and Ann (the creator) can receive.
  const detail = await ben.query(p.order, { orderId });
  await ben.mutation(p.amendPurchaseOrder, { orderId, expectedRevision: detail.order.revision, reason: 'Later', expectedDate: addDays(today(), 5), lines: [], operationKey: key() });
  expect(await code(receive(ben, orderId, 1))).toBe('SELF_RECEIPT');
  expect((await receive(ann, orderId, 1)).id).toBeTruthy();
  expect((await ann.query(p.order, { orderId })).permissions.separateReceiving).toBe(true);
});

it('P40: a direct order above the branch limit waits for a different approver before it is issued', async () => {
  const { ann, ben, cat, setPolicy, order } = await setup();
  await setPolicy({ directOrderLimit: 100_000 });
  const small = await order([{ quantity: 1, unitCost: 100_000 }]);
  expect(small.issued?.awaitingApproval).toBeUndefined();
  const big = await order([{ quantity: 2, unitCost: 60_000 }]);
  expect(big.issued?.awaitingApproval).toBe(true);
  let detail = await ann.query(p.order, { orderId: big.orderId });
  expect(detail.order).toMatchObject({ status: 'awaiting_approval', phase: 'draft', issuedRevision: 0, approvalRequestedByLabel: 'Ann Lee' });
  expect(await code(ann.mutation(p.approvePurchaseOrderIssue, { orderId: big.orderId, expectedRevision: detail.order.revision, operationKey: key() }))).toBe('SELF_APPROVAL');
  expect(await code(cat.mutation(p.approvePurchaseOrderIssue, { orderId: big.orderId, expectedRevision: detail.order.revision, operationKey: key() }))).toBe('STOCK_FORBIDDEN');
  await ben.mutation(p.approvePurchaseOrderIssue, { orderId: big.orderId, expectedRevision: detail.order.revision, operationKey: key() });
  detail = await ann.query(p.order, { orderId: big.orderId });
  expect(detail.order).toMatchObject({ status: 'ordered', issuedRevision: 1, approvedByLabel: 'Ben', dueUnits: 2 });
});

it('validates the purchasing policy fields of a branch policy write', () => {
  expect(purchasingPolicyPatch({ separateReceiving: true, directOrderLimit: null, receivingContact: ' Store ' }))
    .toEqual({ separateReceiving: true, directOrderLimit: undefined, receivingContact: 'Store' });
  expect(() => purchasingPolicyPatch({ directOrderLimit: -1 })).toThrow(ConvexError);
  expect(purchasingPolicyPatch({})).toEqual({});
});

it('review: an amendment cannot take a direct order over the limit without a different approver; TBC needs approval', async () => {
  const { ann, ben, setPolicy, order } = await setup();
  await setPolicy({ directOrderLimit: 100_000 });
  const tbc = await order([{ quantity: 1, priceTbc: true }]);
  expect(tbc.issued?.awaitingApproval).toBe(true);
  const { orderId, issued } = await order([{ quantity: 1, unitCost: 50_000 }]);
  expect(issued?.awaitingApproval).toBeUndefined();
  let detail = await ann.query(p.order, { orderId });
  const raise = (by: typeof ann, due: number) => by.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'More', lines: [{ orderLineId: detail.lines[0]._id, due }], operationKey: key(),
  });
  expect(await code(raise(ann, 3))).toBe('DIRECT_ORDER_LIMIT');
  expect((await ann.query(p.order, { orderId })).order.issuedRevision).toBe(1);
  await raise(ben, 3);
  detail = await ann.query(p.order, { orderId });
  expect(detail.order).toMatchObject({ issuedRevision: 2, dueUnits: 3, totalCost: 150_000 });
  // Reducing an over-limit order is always allowed.
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Less', lines: [{ orderLineId: detail.lines[0]._id, due: 2 }], operationKey: key(),
  });
});

it('review: pre-feature lines are revalued from receipt evidence, and corrections remove the recorded cost only', async () => {
  const { t, ann, ben, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 12, unitCost: 12_500 }]);
  await receive(ben, orderId, 5, { rejected: 1, rejectReason: 'Seal', rejectReasonCode: 'damaged' });
  let detail = await ann.query(p.order, { orderId });
  // Simulate a line written before acceptedValue/rejected existed.
  await t.run(ctx => ctx.db.patch(detail.lines[0]._id, { acceptedValue: undefined, rejected: undefined }));
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Price', lines: [{ orderLineId: detail.lines[0]._id, unitCost: 14_000 }], operationKey: key(),
  });
  detail = await ann.query(p.order, { orderId });
  expect(detail.lines[0]).toMatchObject({ acceptedValue: 62_500, rejected: 1 });
  expect(detail.order).toMatchObject({ receivedValue: 62_500, outstandingValue: 98_000 });

  // A receipt recorded without a cost contributes zero, so correcting it later never subtracts the new price.
  const tbc = await order([{ quantity: 4, priceTbc: true }]);
  await receive(ben, tbc.orderId, 2);
  let tbcDetail = await ann.query(p.order, { orderId: tbc.orderId });
  await ann.mutation(p.amendPurchaseOrder, {
    orderId: tbc.orderId, expectedRevision: tbcDetail.order.revision, reason: 'Priced', lines: [{ orderLineId: tbcDetail.lines[0]._id, unitCost: 100 }], operationKey: key(),
  });
  await receive(ben, tbc.orderId, 2);
  const receipts = await ann.query(p.orderReceipts, { orderId: tbc.orderId, ...page });
  const first = await ann.query(p.receipt, { receiptId: receipts.page[1]._id });
  await ann.mutation(p.correctReceipt, { receiptLineId: first.lines[0]._id, quantity: 1, reason: 'Overcounted', operationKey: key() });
  tbcDetail = await ann.query(p.order, { orderId: tbc.orderId });
  expect(tbcDetail.lines[0]).toMatchObject({ accepted: 3, acceptedValue: 200 });
});

it('review: an amendment can add an approved request line without the direct-order policy', async () => {
  const { ann, ben, cat, branchId, variantId, otherVariantId, supplierId, setPolicy } = await setup();
  const draft = await cat.mutation(p.saveRequest, { branchId, lines: [{ variantId, quantity: 4 }, { variantId: otherVariantId, quantity: 3 }], operationKey: key() });
  const requestId = draft.id as Id<'purchaseRequests'>;
  const sent = await cat.mutation(p.submitRequestForApproval, { requestId, expectedRevision: draft.revision!, operationKey: key() });
  await ben.mutation(p.approvePurchaseRequest, { requestId, expectedRevision: sent.revision!, operationKey: key() });
  const request = await ann.query(p.request, { requestId });
  const first = request.lines.find(line => line.variantId === variantId)!;
  await setPolicy({ directOrder: false });
  const order = await ann.mutation(p.saveOrder, { branchId, supplierId, requestId, lines: [{ variantId, quantity: 4, requestLineId: first._id, unitCost: 100 }], operationKey: key() });
  const orderId = order.id as Id<'purchaseOrders'>;
  await ann.mutation(p.issuePurchaseOrder, { orderId, expectedRevision: order.revision!, operationKey: key() });
  const detail = await ann.query(p.order, { orderId });
  expect(detail.addableRequestLines).toEqual([expect.objectContaining({ variantId: otherVariantId, available: 3 })]);
  const addable = detail.addableRequestLines[0];
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Supplier can ship', lines: [],
    addLines: [{ variantId: otherVariantId, quantity: 3, requestLineId: addable.requestLineId, unitCost: 200 }], operationKey: key(),
  });
  const after = await ann.query(p.order, { orderId });
  expect(after.lines).toHaveLength(2);
  expect(after.addableRequestLines).toEqual([]);
  expect((await ann.query(p.request, { requestId })).request.fullyOrdered).toBe(true);
});

it('review: staff without buyer, approver or lead roles get no order costs', async () => {
  const { cat, order } = await setup();
  const { orderId } = await order([{ quantity: 2, unitCost: 12_500 }]);
  const detail = await cat.query(p.order, { orderId });
  expect(detail.permissions.seeCosts).toBe(false);
  expect(detail.order.totalCost).toBeUndefined();
  expect(detail.order.receivedValue).toBeUndefined();
  expect(detail.lines[0].unitCost).toBeUndefined();
  expect((await cat.query(p.orderRevision, { orderId, revision: 1 })).lines[0].unitCost).toBeUndefined();
});

it('review: the legacy backfill adds reference codes and receipt exception flags', async () => {
  const { t, ann, ben, branchId, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 3, unitCost: 100 }]);
  await receive(ben, orderId, 1, { rejected: 1, rejectReason: 'Leak', rejectReasonCode: 'damaged' });
  const reference = (await ann.query(p.order, { orderId })).order.reference;
  await t.run(async ctx => {
    await ctx.db.patch(orderId, { referenceCode: undefined });
    for (const receipt of await ctx.db.query('supplierReceipts').collect()) await ctx.db.patch(receipt._id, { hasExceptions: undefined });
  });
  expect((await ann.query(p.purchaseReference, { branchId, reference: reference.slice(-5) })).orders).toEqual([]);
  expect((await ann.query(p.receipts, { branchId, exceptionsOnly: true, ...page })).page).toEqual([]);
  await runBackfill(t);
  expect((await ann.query(p.purchaseReference, { branchId, reference: reference.slice(-5) })).orders.map(row => row._id)).toEqual([orderId]);
  expect((await ann.query(p.receipts, { branchId, exceptionsOnly: true, ...page })).page).toHaveLength(1);
});

type TestConvex = Awaited<ReturnType<typeof setup>>['t'];

/** Run the legacy backfill in its documented order, rebuilding any long-history line it reports. */
async function runBackfill(t: TestConvex) {
  for (const table of ['purchaseOrderLines', 'purchaseOrders', 'purchaseRequests', 'supplierReceipts'] as const) {
    let cursor: string | null = null;
    for (;;) {
      const result: { isDone: boolean; continueCursor: string; pending: Id<'purchaseOrderLines'>[] } =
        await t.mutation(internal.commerce.purchasing.backfillPurchasingLegacy, { table, cursor });
      for (const orderLineId of result.pending) {
        let chunk = { cursor: null as string | null, acceptedValue: 0, rejected: 0 };
        for (;;) {
          const next: { isDone: boolean; continueCursor: string; acceptedValue: number; rejected: number } =
            await t.mutation(internal.commerce.purchasing.rebuildPurchaseLineValuation, { orderLineId, ...chunk });
          if (next.isDone) break;
          chunk = { cursor: next.continueCursor, acceptedValue: next.acceptedValue, rejected: next.rejected };
        }
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
  }
}

it('review: a pre-feature line with >100 mixed receipts blocks costing writes until the exact chunked rebuild values it', async () => {
  const { t, ann, ben, order, receive } = await setup();
  const { orderId } = await order([{ quantity: 1_000, unitCost: 100 }]);
  await receive(ben, orderId, 1);
  let detail = await ann.query(p.order, { orderId });
  const line = detail.lines[0];
  const receiptId = (await ann.query(p.orderReceipts, { orderId, ...page })).page[0]._id;
  // 250 more historical receipt lines at changing prices with rejections and corrections, written before valuation existed.
  let accepted = 1, value = 100, rejected = 0;
  await t.run(async ctx => {
    const base = (await ctx.db.query('supplierReceiptLines').withIndex('by_orderLineId', q => q.eq('orderLineId', line._id)).first())!;
    for (let i = 0; i < 250; i++) {
      const cost = i % 3 === 0 ? undefined : 100 + i;
      const row = { accepted: 2, corrected: i % 5 === 0 ? 1 : 0, rejected: i % 4 === 0 ? 1 : 0, unitCost: cost };
      accepted += row.accepted - row.corrected;
      value += (row.accepted - row.corrected) * (cost ?? 0);
      rejected += row.rejected;
      await ctx.db.insert('supplierReceiptLines', {
        receiptId, branchId: base.branchId, orderId, orderLineId: line._id, variantId: base.variantId, item: base.item,
        accepted: row.accepted, rejected: row.rejected, corrected: row.corrected, returned: 0, ...(cost === undefined ? {} : { unitCost: cost }),
      });
    }
    await ctx.db.patch(line._id, { accepted, acceptedValue: undefined, rejected: undefined });
  });
  detail = await ann.query(p.order, { orderId });
  expect(detail.order.receivedValue === undefined || detail.lines[0].acceptedValue === undefined).toBe(true);
  expect(await code(ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Price', lines: [{ orderLineId: line._id, unitCost: 150 }], operationKey: key(),
  }))).toBe('VALUATION_PENDING');
  expect(await code(receive(ben, orderId, 1))).toBe('VALUATION_PENDING');
  await runBackfill(t);
  detail = await ann.query(p.order, { orderId });
  expect(detail.lines[0]).toMatchObject({ acceptedValue: value, rejected });
  expect(detail.order).toMatchObject({ receivedValue: value, outstandingValue: (1_000 - accepted) * 100 });
  await ann.mutation(p.amendPurchaseOrder, {
    orderId, expectedRevision: detail.order.revision, reason: 'Price', lines: [{ orderLineId: line._id, unitCost: 150 }], operationKey: key(),
  });
  expect((await ann.query(p.order, { orderId })).order.receivedValue).toBe(value);
});
