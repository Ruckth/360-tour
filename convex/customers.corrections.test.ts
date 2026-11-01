// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { assertCustomerCanLink, assertCustomerReviewed, mergeCustomerRecords } from './customers';
import type { FunctionReturnType } from 'convex/server';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const firstPage = { numItems: 20, cursor: null };
function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
  const create = (name = 'Ann Lee') => admin.mutation(api.customers.createCustomer, { name });
  const profile = (customerId: Id<'customers'>) => admin.query(api.customers.getCustomer, { customerId });
  const history = (customerId: Id<'customers'>) => admin.query(api.customers.customerHistory, { customerId, paginationOpts: firstPage });
  const orders = (customerId: Id<'customers'>, count: number, overrides: Partial<Doc<'bills'>> = {}) => t.run(async ctx => {
    const ids: Id<'bills'>[] = [];
    for (let i = 0; i < count; i++) ids.push(await ctx.db.insert('bills', { customerId, status: 'draft', hasItems: true, itemCount: 1, total: 100, due: 100, currency: 'THB', revision: 3, orderNumber: i + 1, createdBy: 'admin@example.com', createdAt: 1, updatedAt: 2, ...overrides }));
    return ids;
  });
  const mergeArgs = (sourceId: Id<'customers'>, destinationId: Id<'customers'>) => ({ sourceId, destinationId, sourceRevision: 0, destinationRevision: 0, reason: 'Confirmed same guest by phone', idempotencyKey: 'merge-attempt-01' });
  return { t, admin, stranger, create, profile, history, orders, mergeArgs };
}
beforeEach(() => { vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('customer corrections', () => {
  it('supplies POS guards that reject archived/merged links and require the exact reviewed revision', async () => {
    const { t, create } = setup();
    const id = await create(); const other = await create();
    const customer = (await t.run(ctx => ctx.db.get(id)))!;
    expect(assertCustomerCanLink(customer)).toEqual(customer);
    expect(() => assertCustomerCanLink(null)).toThrow('not found');
    expect(() => assertCustomerCanLink({ ...customer, archivedAt: 1 })).toThrow('Restore');
    expect(() => assertCustomerCanLink({ ...customer, mergedInto: other })).toThrow('merged');
    expect(() => assertCustomerReviewed(customer, undefined)).toThrow('changed');
    expect(() => assertCustomerReviewed(customer, 9)).toThrow('changed');
    expect(() => assertCustomerReviewed({ ...customer, mergedInto: other }, 0)).toThrow('merged');
    expect(() => assertCustomerReviewed(null, 0)).toThrow('no longer exists');
    expect(() => assertCustomerReviewed(customer, 0)).not.toThrow();
    const legacy = { ...customer, revision: undefined };
    expect(() => assertCustomerReviewed(legacy, 0)).not.toThrow();
    // Existing linked archived customers can still pay after reviewing the new revision.
    expect(() => assertCustomerReviewed({ ...customer, archivedAt: 1, revision: 1 }, 1)).not.toThrow();
  });
  it('records business before/after and actor atomically, checks revisions, and skips no-ops', async () => {
    const { admin, create, profile, history } = setup();
    const customerId = await create('An Lee');
    await admin.mutation(api.customers.updateCustomer, { customerId, name: 'Ann Lee', notes: 'Prefers email', expectedRevision: 0 });
    expect(await profile(customerId)).toMatchObject({ name: 'Ann Lee', revision: 1, notes: 'Prefers email' });
    const changes = (await history(customerId)).page;
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ actor: 'admin@example.com', kind: 'edited', before: { name: 'An Lee' }, after: { name: 'Ann Lee', notes: 'Prefers email' } });
    expect(changes[0]).not.toHaveProperty('snapshot');
    await expect(admin.mutation(api.customers.updateCustomer, { customerId, name: 'Stale', expectedRevision: 0 })).rejects.toThrow('changed');
    await admin.mutation(api.customers.updateCustomer, { customerId, name: 'Ann Lee', notes: 'Prefers email', expectedRevision: 1 });
    expect((await history(customerId)).page).toHaveLength(2);
  });

  it('allows correction of legacy invalid contact data and treats absent revisions as zero', async () => {
    const { t, admin, profile } = setup();
    const customerId = await t.run(ctx => ctx.db.insert('customers', { name: 'Legacy', phone: 'old text', email: 'invalid', createdBy: 'old', createdAt: 1, updatedAt: 1 }));
    await admin.mutation(api.customers.updateCustomer, { customerId, expectedRevision: 0, name: 'Legacy corrected', phone: 'old text', email: 'valid@example.com' });
    expect(await profile(customerId)).toMatchObject({ revision: 1, phone: 'old text', email: 'valid@example.com' });
  });

  it('archives and restores with discoverable paginated access and retains linked orders and receipt snapshots', async () => {
    const { t, admin, create, profile, history, orders } = setup();
    const customerId = await create();
    const [orderId] = await orders(customerId, 1, { status: 'paid', customerSnapshot: { name: 'Issued spelling' }, receiptNumber: 52 });
    await admin.mutation(api.customers.setCustomerArchived, { customerId, archived: true, expectedRevision: 0 });
    const browse = (archived: boolean) => admin.query(api.customers.browseCustomers, { query: '', archived, paginationOpts: firstPage });
    expect((await browse(false)).page).toEqual([]);
    expect((await browse(true)).page).toMatchObject([{ _id: customerId }]);
    expect(await admin.query(api.customers.searchCustomers, { query: 'Ann' })).toEqual([]);
    expect((await profile(customerId))?.orders[0]._id).toBe(orderId);
    expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ customerId, receiptNumber: 52, customerSnapshot: { name: 'Issued spelling' } });
    await admin.mutation(api.customers.setCustomerArchived, { customerId, archived: false, expectedRevision: 1 });
    expect((await browse(false)).page).toMatchObject([{ _id: customerId }]);
    expect((await history(customerId)).page.map(c => c.kind)).toEqual(['restored', 'archived', 'created']);
  });

  it('paginates beyond 20 namesakes without merging or dropping identities', async () => {
    const { admin, create } = setup();
    const ids = await Promise.all(Array.from({ length: 25 }, () => create()));
    const first = await admin.query(api.customers.browseCustomers, { query: 'Ann', archived: false, paginationOpts: firstPage });
    expect(first.page).toHaveLength(20); expect(first.isDone).toBe(false);
    const last = await admin.query(api.customers.browseCustomers, { query: 'Ann', archived: false, paginationOpts: { numItems: 20, cursor: first.continueCursor } });
    expect(last.isDone).toBe(true);
    expect(new Set([...first.page, ...last.page].map(c => c._id))).toEqual(new Set(ids));
  });

  it('retains a continuation through hidden search pages and supports exact contact search', async () => {
    const { admin } = setup();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await admin.mutation(api.customers.createCustomer, { name: 'Ann Lee', phone: '0812345678', email: 'ANN@example.com' }));
    for (const customerId of ids.slice(0, 3)) await admin.mutation(api.customers.setCustomerArchived, { customerId, archived: true, expectedRevision: 0 });
    let cursor: string | null = null;
    const found: string[] = [];
    for (let i = 0; i < 4; i++) {
      const page: FunctionReturnType<typeof api.customers.browseCustomers> = await admin.query(api.customers.browseCustomers, { query: 'Ann', archived: false, paginationOpts: { numItems: 1, cursor } });
      found.push(...page.page.map(c => c._id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(found).toEqual([ids[3]]);
    for (const query of ['0812345678', 'ann@example.com']) expect((await admin.query(api.customers.browseCustomers, { query, archived: false, paginationOpts: firstPage })).page).toMatchObject([{ _id: ids[3] }]);
  });

  it('changes only the customer revision, preserving order revisions, timestamps and paid receipts', async () => {
    const { t, admin, create, orders } = setup();
    const customerId = await create();
    const [active] = await orders(customerId, 1);
    const [empty] = await orders(customerId, 1, { hasItems: false, itemCount: 0 });
    const [held] = await orders(customerId, 1, { status: 'held' });
    const [paid] = await orders(customerId, 1, { status: 'paid', customerSnapshot: { name: 'Issued' } });
    await admin.mutation(api.customers.updateCustomer, { customerId, expectedRevision: 0, name: 'Anna' });
    expect(await t.run(ctx => ctx.db.get(active))).toMatchObject({ revision: 3, updatedAt: 2 });
    expect(await t.run(ctx => ctx.db.get(held))).toMatchObject({ revision: 3, updatedAt: 2 });
    expect(await t.run(ctx => ctx.db.get(empty))).toMatchObject({ revision: 3, updatedAt: 2 });
    expect(await t.run(ctx => ctx.db.get(paid))).toMatchObject({ revision: 3, customerSnapshot: { name: 'Issued' } });
  });

  it('corrects a customer with more than 100 empty linked orders', async () => {
    const { t, admin, create, profile, orders } = setup();
    const customerId = await create();
    await orders(customerId, 150, { hasItems: false, itemCount: 0 });
    const [active] = await orders(customerId, 1);
    await admin.mutation(api.customers.updateCustomer, { customerId, expectedRevision: 0, name: 'Corrected' });
    expect(await profile(customerId)).toMatchObject({ name: 'Corrected', revision: 1, ordersHasMore: true });
    expect(await t.run(ctx => ctx.db.get(active))).toMatchObject({ revision: 3, updatedAt: 2 });
  });

  it('edits more than 100 active and 1000 empty references without scanning or invalidating their orders', async () => {
    const { t, admin, create, profile, history, orders } = setup();
    const customerId = await create();
    const active = await orders(customerId, 151);
    await orders(customerId, 1001, { hasItems: false, itemCount: 0 });
    await admin.mutation(api.customers.updateCustomer, { customerId, expectedRevision: 0, name: 'Corrected at scale' });
    expect(await profile(customerId)).toMatchObject({ name: 'Corrected at scale', revision: 1 });
    expect((await history(customerId)).page).toHaveLength(2);
    expect(await t.run(ctx => ctx.db.get(active[0]))).toMatchObject({ revision: 3, updatedAt: 2 });
  });

  it('rejects stale payment review after customer correction without accepting stale checkout', async () => {
    const { admin, create } = setup();
    const customerId = await create();
    const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 100 } });
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    const before = (await admin.query(api.pos.getOrder, { orderId }))!.order.revision;
    await admin.mutation(api.customers.updateCustomer, { customerId, name: 'Corrected', expectedRevision: 0 });
    await expect(admin.mutation(api.pos.settleOrder, { orderId, expectedDue: 100, expectedRevision: before, expectedCustomerRevision: 0, idempotencyKey: 'payment-01', tenders: [{ method: 'cash', amount: 100 }] })).rejects.toThrow('The customer changed');
  });

  it('paginates order and history readers, with truthful recent-orders metadata', async () => {
    const { admin, create, orders, profile } = setup();
    const customerId = await create();
    const ids = await orders(customerId, 12);
    expect(await profile(customerId)).toMatchObject({ ordersHasMore: true });
    const first = await admin.query(api.customers.listCustomerOrders, { customerId, paginationOpts: { numItems: 10, cursor: null } });
    const last = await admin.query(api.customers.listCustomerOrders, { customerId, paginationOpts: { numItems: 10, cursor: first.continueCursor } });
    expect(new Set([...first.page, ...last.page].map(o => o._id))).toEqual(new Set(ids));
    for (let i = 0; i < 3; i++) await admin.mutation(api.customers.updateCustomer, { customerId, expectedRevision: i, name: 'Ann Lee', notes: `Note ${i}` });
    const history = await admin.query(api.customers.customerHistory, { customerId, paginationOpts: { numItems: 2, cursor: null } });
    expect(history.isDone).toBe(false);
    expect((await admin.query(api.customers.customerHistory, { customerId, paginationOpts: { numItems: 2, cursor: history.continueCursor } })).page).toHaveLength(2);
    await expect(admin.query(api.customers.browseCustomers, { query: '', archived: false, paginationOpts: { numItems: 500, cursor: null } })).rejects.toThrow('Page size');
  });
});

describe('reviewed duplicate merge and bounded durable continuation', () => {
  it('preserves stable order/payment/line links and issued receipt snapshots, retains identities and logs both sides', async () => {
    const { t, admin, create, orders, history, profile, mergeArgs } = setup();
    const sourceId = await create('An Lee'); const destinationId = await create('Ann Lee');
    const [draft] = await orders(sourceId, 1);
    const [paid] = await orders(sourceId, 1, { status: 'paid', receiptNumber: 73, customerSnapshot: { name: 'An Lee' }, settleKey: 'paid-before' });
    const { lineId, paymentId } = await t.run(async ctx => ({ lineId: await ctx.db.insert('billLines', { billId: paid, kind: 'extra', name: 'Water', unitPrice: 100, currency: 'THB', qty: 1, createdAt: 1 }), paymentId: await ctx.db.insert('billPayments', { billId: paid, method: 'cash', amount: 100, idempotencyKey: 'paid-before', createdBy: 'admin@example.com', createdAt: 1 }) }));
    const args = mergeArgs(sourceId, destinationId);
    expect(await admin.run(ctx => mergeCustomerRecords(ctx, args))).toEqual({ replayed: false, destinationId });
    expect(await t.run(ctx => ctx.db.get(draft))).toMatchObject({ customerId: destinationId, revision: 4, updatedAt: 2 });
    expect(await t.run(ctx => ctx.db.get(paid))).toMatchObject({ customerId: destinationId, revision: 3, receiptNumber: 73, customerSnapshot: { name: 'An Lee' }, settleKey: 'paid-before', updatedAt: 2 });
    expect(await t.run(ctx => ctx.db.get(lineId))).toMatchObject({ billId: paid });
    expect(await t.run(ctx => ctx.db.get(paymentId))).toMatchObject({ billId: paid });
    expect(await profile(sourceId)).toMatchObject({ name: 'An Lee', mergedInto: destinationId, revision: 1 });
    expect(await profile(destinationId)).toMatchObject({ name: 'Ann Lee', revision: 1 });
    for (const id of [sourceId, destinationId]) expect((await history(id)).page[0]).toMatchObject({ kind: 'merged', actor: 'admin@example.com', reason: args.reason, before: { sourceId, destinationId, source: { name: 'An Lee' }, destination: { name: 'Ann Lee' } }, after: { movedOrders: 2 } });
    const beforeRetry = (await history(sourceId)).page;
    expect(await admin.run(ctx => mergeCustomerRecords(ctx, args))).toEqual({ replayed: true, destinationId });
    expect((await history(sourceId)).page).toEqual(beforeRetry);
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, reason: 'Different instruction' }))).rejects.toThrow('different reason');
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, idempotencyKey: 'new-attempt-01' }))).rejects.toThrow('already been merged');
    await expect(admin.mutation(api.customers.setCustomerArchived, { customerId: sourceId, expectedRevision: 1, archived: false })).rejects.toThrow('cannot be restored');
    await expect(admin.mutation(api.customers.updateCustomer, { customerId: sourceId, name: 'Bad', expectedRevision: 1 })).rejects.toThrow('merged');
  });

  it('rejects stale source/destination and archive conflicts, preventing ambiguous or cyclic merges', async () => {
    const { admin, create, mergeArgs } = setup();
    const sourceId = await create(); const destinationId = await create(); const args = mergeArgs(sourceId, destinationId);
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, destinationId: sourceId }))).rejects.toThrow('different');
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, reason: '' }))).rejects.toThrow('reason');
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, sourceRevision: 9 }))).rejects.toThrow('changed');
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, destinationRevision: 9 }))).rejects.toThrow('changed');
    await admin.mutation(api.customers.setCustomerArchived, { customerId: destinationId, expectedRevision: 0, archived: true });
    await expect(admin.run(ctx => mergeCustomerRecords(ctx, { ...args, destinationRevision: 1 }))).rejects.toThrow('Restore');
  });

  it('freezes a huge source, resumes partial runs safely, and records completion only after every reference moved', async () => {
    vi.useFakeTimers();
    const { t, admin, create, orders, mergeArgs, profile, history } = setup();
    const sourceId = await create('Source'); const destinationId = await create('Kept');
    const ids = await orders(sourceId, 351);
    const args = mergeArgs(sourceId, destinationId);
    await admin.mutation(api.customers.mergeCustomers, args);
    let progress = (await profile(sourceId))!.mergeProgress!;
    expect(progress).toMatchObject({ status: 'running', movedOrders: 100, actor: 'admin@example.com' });
    expect((await history(sourceId)).page.map(e => e.kind)).toEqual(['merge_started', 'created']);
    expect((await profile(sourceId))?.mergedInto).toBe(destinationId);
    // An unmoved source reference is never payable or newly linkable while a job is in progress.
    const remaining = await t.run(async ctx => (await ctx.db.query('bills').withIndex('by_customerId_and_updatedAt', q => q.eq('customerId', sourceId)).take(1))[0]);
    await t.run(ctx => ctx.db.insert('billLines', { billId: remaining._id, kind: 'extra', name: 'Water', unitPrice: 100, currency: 'THB', qty: 1, createdAt: 1 }));
    await expect(admin.mutation(api.pos.linkCustomer, { orderId: remaining._id, customerId: sourceId })).rejects.toThrow('merged');
    await expect(admin.mutation(api.pos.settleOrder, { orderId: remaining._id, expectedDue: 100, expectedRevision: 3, expectedCustomerRevision: 0, idempotencyKey: 'stale-review-01', tenders: [{ method: 'cash', amount: 100 }] })).rejects.toThrow('merged');
    const next = await create('Next');
    await expect(admin.mutation(api.customers.mergeCustomers, { ...mergeArgs(destinationId, next), sourceRevision: 1 })).rejects.toThrow('in-progress');
    // Replay the original start without advancing or duplicating anything, then resume manually.
    expect(await admin.mutation(api.customers.mergeCustomers, args)).toMatchObject({ replayed: true });
    expect((await profile(sourceId))?.mergeProgress?.movedOrders).toBe(100);
    await admin.mutation(api.customers.resumeCustomerMerge, { sourceId });
    progress = (await profile(sourceId))!.mergeProgress!;
    expect(progress).toMatchObject({ status: 'running', movedOrders: 200 });
    // A duplicate delivery advances another bounded chunk; it cannot process a moved order twice.
    await t.mutation(internal.customers.continueMerge, { jobId: progress._id });
    expect((await profile(sourceId))?.mergeProgress).toMatchObject({ status: 'running', movedOrders: 300 });
    await admin.mutation(api.customers.resumeCustomerMerge, { sourceId });
    expect((await profile(sourceId))?.mergeProgress).toMatchObject({ status: 'completed', movedOrders: 351 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await admin.mutation(api.customers.resumeCustomerMerge, { sourceId });
    expect((await history(sourceId)).page.map(e => e.kind)).toEqual(['merged', 'merge_started', 'created']);
    for (const id of [ids[0], ids[100], ids[350]]) {
      expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ customerId: destinationId, revision: 4, updatedAt: 2 });
      const events = await admin.query(api.pos.orderHistory, { orderId: id, paginationOpts: firstPage });
      expect(events.page).toHaveLength(1);
    }
    expect((await profile(sourceId))?.orders).toEqual([]);
    const current = (await admin.query(api.pos.getOrder, { orderId: remaining._id }))!;
    await expect(admin.mutation(api.pos.settleOrder, { orderId: remaining._id, expectedDue: 100, expectedRevision: current.order.revision, expectedCustomerRevision: 0, idempotencyKey: 'new-review-01', tenders: [{ method: 'cash', amount: 100 }] })).rejects.toThrow('customer changed');
    await expect(admin.mutation(api.pos.settleOrder, { orderId: remaining._id, expectedDue: 100, expectedRevision: current.order.revision, expectedCustomerRevision: 1, idempotencyKey: 'new-review-01', tenders: [{ method: 'cash', amount: 100 }] })).resolves.toMatchObject({ replayed: false });
  });

  it('enables public merge and rejects archived/merged new links while allowing reviewed archived existing links', async () => {
    const { admin, create, mergeArgs } = setup();
    const sourceId = await create(); const destinationId = await create();
    const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 100 } });
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId: sourceId });
    await admin.mutation(api.customers.setCustomerArchived, { customerId: sourceId, archived: true, expectedRevision: 0 });
    await expect(admin.mutation(api.pos.linkCustomer, { orderId, customerId: sourceId })).rejects.toThrow('Restore');
    const view = (await admin.query(api.pos.getOrder, { orderId }))!;
    const payment = { orderId, expectedDue: 100, expectedRevision: view.order.revision, expectedCustomerRevision: 1, idempotencyKey: 'archived-paid-01', tenders: [{ method: 'cash' as const, amount: 100 }] };
    await expect(admin.mutation(api.pos.settleOrder, { ...payment, expectedCustomerRevision: undefined })).rejects.toThrow('customer changed');
    await admin.mutation(api.pos.settleOrder, payment);
    await admin.mutation(api.customers.mergeCustomers, { ...mergeArgs(sourceId, destinationId), sourceRevision: 1 });
    // Payment replay wins over profile edits/merge and all stale revision checks.
    await expect(admin.mutation(api.pos.settleOrder, payment)).resolves.toMatchObject({ replayed: true });
    await expect(admin.mutation(api.pos.linkCustomer, { customerId: sourceId })).rejects.toThrow('merged');
  });

  it('denies all customer reads/mutations and the merge helper to non-admins', async () => {
    const { admin, stranger, create, mergeArgs } = setup();
    const sourceId = await create(); const destinationId = await create();
    const mutationCases = [
      stranger.mutation(api.customers.createCustomer, { name: 'No' }),
      stranger.mutation(api.customers.updateCustomer, { customerId: sourceId, name: 'No', expectedRevision: 0 }),
      stranger.mutation(api.customers.setCustomerArchived, { customerId: sourceId, archived: true, expectedRevision: 0 }),
      stranger.mutation(api.customers.resumeCustomerMerge, { sourceId }),
      stranger.mutation(api.customers.mergeCustomers, mergeArgs(sourceId, destinationId)),
      stranger.run(ctx => mergeCustomerRecords(ctx, mergeArgs(sourceId, destinationId))),
      stranger.query(api.customers.getCustomer, { customerId: sourceId }),
      stranger.query(api.customers.browseCustomers, { query: '', archived: false, paginationOpts: firstPage }),
      stranger.query(api.customers.searchCustomers, { query: 'Ann' }),
      stranger.query(api.customers.customerHistory, { customerId: sourceId, paginationOpts: firstPage }),
      stranger.query(api.customers.listCustomerOrders, { customerId: sourceId, paginationOpts: firstPage })
    ];
    await Promise.all(mutationCases.map(p => expect(p).rejects.toThrow('Not authorized')));
    expect((await admin.query(api.customers.getCustomer, { customerId: sourceId }))?.name).toBe('Ann Lee');
  });
});

it('allows independent large merges into one destination while protecting its reviewed revision and preventing merge chains', async () => {
  vi.useFakeTimers();
  const { t, admin, create, orders, mergeArgs, profile } = setup();
  const first = await create('First source'); const second = await create('Second source'); const kept = await create('Kept');
  await orders(first, 151); await orders(second, 151);
  await admin.mutation(api.customers.mergeCustomers, mergeArgs(first, kept));
  await expect(admin.mutation(api.customers.mergeCustomers, mergeArgs(second, kept))).rejects.toThrow('changed');
  await admin.mutation(api.customers.mergeCustomers, { ...mergeArgs(second, kept), destinationRevision: 1 });
  expect((await profile(first))?.mergeProgress?.status).toBe('running');
  expect((await profile(second))?.mergeProgress?.status).toBe('running');
  const third = await create('Third');
  await expect(admin.mutation(api.customers.mergeCustomers, { ...mergeArgs(kept, third), sourceRevision: 2 })).rejects.toThrow('in-progress');
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await profile(first))?.mergeProgress).toMatchObject({ status: 'completed', movedOrders: 151 });
  expect((await profile(second))?.mergeProgress).toMatchObject({ status: 'completed', movedOrders: 151 });
});
