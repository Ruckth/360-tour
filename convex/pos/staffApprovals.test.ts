// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { omit } from 'convex-helpers';
import { convexToJson } from 'convex/values';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { adjust, type AdjustmentWriter } from '../commerce/private/adjustments';
import { resolveCommerceSettings } from '../commerce/model';
import { requireStaff } from '../auth/model';
import { ReadBudget } from '../lib/readBudget';
import schema from '../schema';
import { cashierRules } from '../settings/model';
import { sha256 } from '../shared/displayTokens';
import { APPROVAL_TTL_MS } from '../shared/staffTypes';
import { insertFixture } from '../testing/completeFixture.test-support';
import { encodeReturnApprovalReview, requesterFingerprint, returnApprovalCheckpoint, rulesFingerprint } from './private/staffApprovalState';

const modules = import.meta.glob('/convex/**/*.ts');
const now = Date.parse('2026-11-19T04:00:00Z');
const approvals = api.pos.staffApprovals;
const firstPage = { paginationOpts: { numItems: 20, cursor: null } } as const;
const { saleSwitches, paymentsMode, revision, ...terms } = resolveCommerceSettings(null);
type ReturnRequest = Extract<Doc<'staffApprovalRequests'>, { kind: 'returnItems' }>;
type AdjustmentRequest = Extract<Doc<'staffApprovalRequests'>, { kind: 'adjustment' }>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const t = convexTest(schema, modules);
  const cashier = t.withIdentity({ email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  const manager = t.withIdentity({ email: 'manager@example.com', emailVerified: true, tokenIdentifier: 'manager' });
  const owner = t.withIdentity({ email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner' });
  const guest = t.withIdentity({ email: 'guest@example.com', emailVerified: true, tokenIdentifier: 'guest' });
  const fixture = await t.run(async ctx => {
    const grantId = await ctx.db.insert('staffGrants', {
      role: 'cashier', email: 'cashier@example.com', tokenIdentifier: 'cashier',
      createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
    });
    await ctx.db.insert('staffGrants', {
      role: 'manager', email: 'manager@example.com', tokenIdentifier: 'manager',
      createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
    });
    const orderId = await ctx.db.insert('orders', {
      orderNumber: 101, receiptNumber: 102, status: 'paid', paidAt: now, itemCount: 1, hasItems: true,
      currency: 'THB', total: 60000, due: 0, revision: 2, createdBy: 'cashier', createdAt: now, updatedAt: now,
    });
    const lineId = await ctx.db.insert('orderLines', {
      orderId, kind: 'voucher', name: 'Gift voucher', qty: 1, unitPrice: 60000, catalogUnitPrice: 60000, currency: 'THB', createdAt: now,
    });
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const voucherId = await ctx.db.insert('vouchers', {
      faceValue: 60000, paidBalance: 60000, goodwillBalance: 0, status: 'active', branchId,
      source: { kind: 'sale', orderId, lineId }, issuedExpiresAt: now + 86400000, effectiveExpiresAt: now + 86400000,
      revision: 3, settingsRevision: 0, terms,
    });
    const codeId = await ctx.db.insert('voucherCodes', { voucherId, code: 'GV-ABCD-1234', mask: 'GV-••••-1234', status: 'active' });
    await ctx.db.patch(voucherId, { activeCodeId: codeId });
    const rules = await cashierRules(ctx);
    const requester = await requesterFingerprint(ctx, 'cashier');
    const returnRequest: Omit<ReturnRequest, '_id' | '_creationTime'> = {
      kind: 'returnItems', orderId, lineId, orderRevision: 2, orderFingerprint: '', amount: 60000, totalBefore: 60000, totalAfter: 0,
      reason: 'Customer return', status: 'pending', createdAt: now, expiresAt: now + APPROVAL_TTL_MS,
      requesterEmail: 'cashier@example.com', requesterTokenIdentifier: 'cashier', requesterAccessFingerprint: requester.fingerprint,
      rulesRevision: rules.revision, rulesFingerprint: rulesFingerprint(rules),
      payload: { kind: 'returnItems', parts: [{ kind: 'line', lineId, units: 1 }], idempotencyKey: 'return-1' },
    };
    const adjustmentRequest: Omit<AdjustmentRequest, '_id' | '_creationTime'> = {
      kind: 'adjustment', reason: 'Guest recovery', status: 'pending', createdAt: now + 1, expiresAt: now + APPROVAL_TTL_MS + 1,
      requesterEmail: 'cashier@example.com', requesterTokenIdentifier: 'cashier',
      requesterAccessFingerprint: await sha256(JSON.stringify(convexToJson(await ctx.db.get(grantId)))),
      rulesRevision: rules.revision, rulesFingerprint: await sha256(JSON.stringify(convexToJson(rules))),
      payload: {
        kind: 'adjustment', target: { targetType: 'voucher', targetId: voucherId }, adjustmentKind: 'addGoodwill',
        input: { delta: 1000 }, expectedRevisions: [{ target: { targetType: 'voucher', targetId: voucherId }, revision: 3 }],
        payloadFingerprint: 'payload-fingerprint', requester: 'cashier', clientKey: 'adjustment-1',
      },
    };
    return { branchId, orderId, lineId, voucherId, grantId, returnRequest, adjustmentRequest };
  });
  return {
    t, cashier, manager, owner, guest, ...fixture,
    insertAdjustment: () => t.run(ctx => ctx.db.insert('staffApprovalRequests', fixture.adjustmentRequest)),
    insertReturn: (patch: Partial<typeof fixture.returnRequest> = {}) =>
      t.run(ctx => ctx.db.insert('staffApprovalRequests', { ...fixture.returnRequest, ...patch })),
  };
}

it('pages both request shapes at 500 pending while another till pays, reading no per-row targets', async () => {
  const s = await setup();
  const serviceId = await s.t.run(ctx => ctx.db.insert('services', {
    slug: 'queue-cash-sale', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 30000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  }));
  const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, {
    item: { kind: 'service', serviceId },
  });
  const { requestId } = await s.cashier.mutation(approvals.create, {
    orderId, payload: { kind: 'discount', lineId, discount: { type: 'percent', value: 3000 } }, reason: 'Discount request',
  });
  await s.t.run(async ctx => {
    // Keep the checkout request live, then settle an unrelated order below.
    for (let index = 1; index < 500; index++) {
      const request = index % 2 ? s.adjustmentRequest : s.returnRequest;
      await ctx.db.insert('staffApprovalRequests', { ...request, createdAt: now - index, expiresAt: now - index + APPROVAL_TTL_MS });
    }
  });
  const sale = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
  const view = await s.cashier.query(api.pos.orders.getOrder, { orderId: sale.orderId });
  const reads = vi.spyOn(ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const [first, payment] = await Promise.all([
    s.manager.query(approvals.pendingPage, firstPage),
    s.cashier.mutation(api.pos.commands.settleOrder.settleOrder, {
      orderId: sale.orderId, expectedDue: 30000, expectedRevision: view!.order.revision,
      idempotencyKey: 'other-till-payment', tenders: [{ method: 'cash', amount: 30000 }],
    }),
  ]);
  expect(payment.replayed).toBe(false);
  expect(first.page).toHaveLength(20);
  expect(new Set(first.page.map(row => row.kind))).toEqual(new Set(['discount', 'adjustment', 'returnItems']));
  expect(reads.mock.calls).toHaveLength(21); // Requests plus one shared cashier-rule read.
  expect(reads.mock.calls.map(([row]) => row)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'adjustment' }), expect.objectContaining({ kind: 'returnItems' }),
  ]));
  const seen = new Set(first.page.map(row => row._id));
  let page = first;
  while (!page.isDone) {
    reads.mockClear();
    ranges.mockClear();
    page = await s.manager.query(approvals.pendingPage, { paginationOpts: { numItems: 20, cursor: page.continueCursor } });
    expect(reads.mock.calls.length).toBeLessThanOrEqual(20);
    expect(ranges.mock.calls).toHaveLength(1);
    for (const row of page.page) seen.add(row._id);
  }
  expect(seen.size).toBe(500);
  expect(seen.has(requestId)).toBe(true);
  expect(await s.manager.query(approvals.pending, {})).toMatchObject({ count: 1, list: [{ _id: requestId }] });
  expect(JSON.stringify(first.page)).not.toContain('payload-fingerprint');
});

it('keeps a live pre-commerce approval visible after twenty stale requests and skips expired rows by index', async () => {
  const s = await setup();
  const serviceId = await s.t.run(ctx => ctx.db.insert('services', {
    slug: 'queue-backlog-service', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 30000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  }));
  const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
  const { requestId } = await s.cashier.mutation(approvals.create, {
    orderId, payload: { kind: 'discount', lineId, discount: { type: 'percent', value: 3000 } }, reason: 'Discount request',
  });
  await s.t.run(async ctx => {
    const request = await ctx.db.get(requestId);
    if (!request || request.kind !== 'discount') throw new Error('Missing discount request');
    const live = omit(request, ['_id', '_creationTime']);
    for (let index = 1; index <= 20; index++) {
      await ctx.db.insert('staffApprovalRequests', {
        ...live, createdAt: now - index, expiresAt: now + APPROVAL_TTL_MS - index, rulesRevision: 999,
      });
      await ctx.db.insert('staffApprovalRequests', {
        ...live, createdAt: now - APPROVAL_TTL_MS - index, expiresAt: now - index,
      });
    }
  });
  const documents = vi.spyOn(ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const queue = await s.manager.query(approvals.pending, {});
  expect(queue).toMatchObject({ count: 1, list: [{ _id: requestId }] });
  expect(documents.mock.calls.filter(([row]) => row && typeof row === 'object' && 'expiresAt' in row)).toHaveLength(21);
  expect(documents.mock.calls.length + 1).toBeLessThanOrEqual(26);
  expect(ranges.mock.calls.length + 1).toBe(12);

  await s.t.run(async ctx => {
    const live = await ctx.db.get(requestId);
    if (!live || live.kind !== 'discount') throw new Error('Missing discount request');
    for (let index = 1; index <= 20; index++) {
      await ctx.db.insert('staffApprovalRequests', {
        ...omit(live, ['_id', '_creationTime']), createdAt: now + index, expiresAt: live.expiresAt + index, rulesRevision: 999,
      });
    }
    await ctx.db.insert('staffApprovalRequests', { ...omit(live, ['_id', '_creationTime']), expiresAt: now });
    await ctx.db.insert('staffApprovalRequests', { ...omit(live, ['_id', '_creationTime']), expiresAt: now + 1 });
  });
  documents.mockClear();
  ranges.mockClear();
  const first = await s.manager.query(approvals.pendingPage, firstPage);
  expect(first.page).toHaveLength(20);
  expect(first.page.every(row => !row.actionable)).toBe(true);
  expect(first.isDone).toBe(false);
  expect(ranges.mock.calls).toHaveLength(2);
  expect(documents.mock.calls).toHaveLength(21);
  vi.mocked(Date.now).mockReturnValue(now + 100);
  const refetched = await s.manager.query(approvals.pendingPage, { paginationOpts: { ...firstPage.paginationOpts, endCursor: first.continueCursor } });
  expect(refetched.page.map(row => row._id)).toEqual(first.page.map(row => row._id));
  const next = await s.manager.query(approvals.pendingPage, { paginationOpts: { numItems: 20, cursor: first.continueCursor } });
  expect(next.page.filter(row => row.actionable).map(row => row._id)).toEqual([requestId]);
  expect(next.page.every(row => row.expiresAt > Date.now())).toBe(true);
  expect(next.isDone).toBe(false);
  const last = await s.manager.query(approvals.pendingPage, { paginationOpts: { numItems: 20, cursor: next.continueCursor } });
  expect(last.isDone).toBe(true);
  expect(last.page).toHaveLength(1);
  expect(last.page[0]).toMatchObject({ actionable: false, expiresAt: now + APPROVAL_TTL_MS - 20 });
});

it('restricts review to a different manager or owner, and confines own status to the requester', async () => {
  const s = await setup();
  const requestId = await s.insertAdjustment();
  await expect(s.guest.query(approvals.myStatus, { requestId })).rejects.toThrow('Not authorized');
  await expect(s.cashier.query(approvals.pendingPage, firstPage)).rejects.toThrow('Not authorized');
  await expect(s.cashier.query(approvals.detail, { requestId })).rejects.toThrow('Not authorized');
  await expect(s.cashier.mutation(approvals.approve, { requestId })).rejects.toThrow('Not authorized');
  expect(await s.manager.query(approvals.myStatus, { requestId })).toBeNull();
  expect(await s.cashier.query(approvals.myStatus, { requestId })).toMatchObject({ status: 'pending' });
  const detail = await s.manager.query(approvals.detail, { requestId });
  expect(detail).toMatchObject({
    kind: 'adjustment', status: 'pending',
    target: { maskedCode: 'GV-••••-1234', paidBalance: 60000 },
    revisions: [{ targetType: 'voucher', targetId: s.voucherId, expected: 3, current: 3 }],
  });
  expect(JSON.stringify(detail)).not.toMatch(/GV-ABCD-1234|payload-fingerprint|clientKey|requesterTokenIdentifier/);
  await s.t.run(ctx => ctx.db.patch(s.grantId, { role: 'manager' }));
  expect((await s.cashier.query(approvals.pendingPage, firstPage)).page).toEqual([]);
  expect(await s.cashier.query(approvals.detail, { requestId })).toBeNull();
  await expect(s.cashier.mutation(approvals.approve, { requestId })).rejects.toThrow('own request');
});

it('keeps owner-only settings out of manager views', async () => {
  const s = await setup();
  const requestId = await s.t.run(async ctx => {
    const target = { targetType: 'settings' as const, targetId: await ctx.db.insert('commerceSettings', {
      key: 'default', ...terms, saleSwitches, paymentsMode, revision,
    }) };
    return await ctx.db.insert('staffApprovalRequests', {
      ...s.adjustmentRequest,
      payload: { ...s.adjustmentRequest.payload, target, adjustmentKind: 'updateSettings', expectedRevisions: [{ target, revision: 0 }] },
    });
  });
  expect((await s.manager.query(approvals.pendingPage, firstPage)).page).toEqual([]);
  expect(await s.manager.query(approvals.detail, { requestId })).toBeNull();
  expect(await s.owner.query(approvals.detail, { requestId })).toMatchObject({
    kind: 'adjustment', target: { settings: { saleSwitches: { products: 'off', vouchers: 'off', sessionPackages: 'off', mixedPackages: 'off' } } },
  });
});

it('shows changed revisions as stale in detail and own status without re-reading targets in the queue', async () => {
  const s = await setup();
  const adjustmentId = await s.insertAdjustment();
  const returnId = await s.insertReturn({ orderFingerprint: encodeReturnApprovalReview({
    revisions: [{ table: 'vouchers', id: s.voucherId, revision: 3 }], rows: [{ lineId: s.lineId, label: 'Gift voucher' }],
  }) });
  expect(await s.manager.query(approvals.detail, { requestId: returnId })).toMatchObject({
    kind: 'returnItems', status: 'pending', target: { receiptNumber: 102 }, rows: [{ lineId: s.lineId, label: 'Gift voucher' }],
  });
  await s.t.run(async ctx => {
    await ctx.db.patch(s.voucherId, { revision: 4 });
    await ctx.db.patch(s.orderId, { revision: 3 });
  });
  expect((await s.manager.query(approvals.pendingPage, firstPage)).page).toHaveLength(2);
  expect(await s.manager.query(approvals.detail, { requestId: adjustmentId })).toMatchObject({
    status: 'stale', revisions: [{ expected: 3, current: 4 }],
  });
  expect(await s.cashier.query(approvals.myStatus, { requestId: adjustmentId })).toMatchObject({ status: 'stale' });
  expect(await s.manager.query(approvals.detail, { requestId: returnId })).toMatchObject({
    status: 'stale', orderRevision: { expected: 2, current: 3 },
  });
});

it('checks order, authority and all 127 return targets within 130 reads when only the last target changes', async () => {
  const s = await setup();
  const review = await s.t.run(async ctx => {
    const serviceId = await ctx.db.insert('services', {
      slug: 'approval-spa', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
      price: 60000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
    });
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 0 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Tote', status: 'active', vatProfile: 'standard', options: [], minPrice: 5000, maxPrice: 5000,
      variantCount: 60, sort: 0, revision: 0,
    });
    const packageId = await ctx.db.insert('packages', { name: 'Spa package', status: 'active', sort: 0, revision: 0 });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Spa package', price: 60000, validityDays: 180, allowTransfer: true, contents: [], estimatedSplit: [],
    });
    const ownerId = await ctx.db.insert('customers', { name: 'Guest', createdAt: now, updatedAt: now, createdBy: 'cashier' });
    const grantIds = await Promise.all(Array.from({ length: 20 }, (_, index) => ctx.db.insert('sessionGrants', {
      ownerId, packageVersionId, branchId: s.branchId, total: 1, used: 0, paidUnits: 1, goodwillUnits: 0, returnedUnits: 0, paidShare: 60000,
      orderId: s.orderId, lineId: s.lineId, contentKey: `content-${index}`, expiresAt: now + 86400000,
      issuedTerms: { expiresAt: now + 86400000, serviceIds: [serviceId], allowTransfer: true },
      settingsRevision: 0, terms, grantServiceIds: [], revision: 0,
    })));
    const vouchers = await Promise.all(Array.from({ length: 22 }, () => ctx.db.insert('vouchers', {
      faceValue: 60000, paidBalance: 60000, goodwillBalance: 0, status: 'active', branchId: s.branchId,
      source: { kind: 'sale', orderId: s.orderId, lineId: s.lineId }, issuedExpiresAt: now + 86400000,
      effectiveExpiresAt: now + 86400000, revision: 0, settingsRevision: 0, terms,
    })));
    const stocks = await Promise.all(Array.from({ length: 60 }, async (_, index) => {
      const variantId = await ctx.db.insert('productVariants', {
        productId, optionValueIds: [], label: `Tote ${index}`, price: 5000, status: 'active', revision: 0,
      });
      return await ctx.db.insert('stockLevels', { branchId: s.branchId, productId, variantId, onHand: 1, revision: 0 });
    }));
    const handovers = await Promise.all(Array.from({ length: 20 }, (_, index) => ctx.db.insert('handovers', {
      kind: 'room_bill', orderId: s.orderId, lineId: s.lineId, unitPrice: 5000, quantity: 1, withGuest: 1,
      backSellable: 0, backDamaged: 0, paid: 1, unpaid: 0, status: 'open', movementIds: [], clientKey: `handover-${index}`, revision: 0,
    })));
    const staffId = await ctx.db.insert('staff', {
      name: 'Therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: now, updatedAt: now,
    });
    const visits = await Promise.all(Array.from({ length: 5 }, (_, index) => insertFixture(ctx, 'appointments', {
      serviceId, staffId, start: now, end: now + 3600000, blockedUntil: now + 3600000,
      guestName: 'Guest', guestPhone: '0800000000', source: 'admin', status: 'booked', paymentStatus: 'paid',
      price: 60000, currency: 'THB', confirmationCode: `APPT${index}`, accessToken: 'test-only', createdAt: now, revision: 0,
    })));
    const review = {
      correctionRevision: 0,
      rows: [{ lineId: s.lineId, label: 'Gift voucher' }],
      revisions: [
        ...grantIds.map(id => ({ table: 'sessionGrants' as const, id, revision: 0 })),
        ...vouchers.map(id => ({ table: 'vouchers' as const, id, revision: 0 })),
        ...stocks.map(id => ({ table: 'stockLevels' as const, id, revision: 0 })),
        ...visits.map(id => ({ table: 'appointments' as const, id, revision: 0 })),
        ...handovers.map(id => ({ table: 'handovers' as const, id, revision: 0 })),
      ],
    };
    const order = (await ctx.db.get(s.orderId))!;
    const custody = await Promise.all(handovers.map(async id => (await ctx.db.get(id))!));
    const lastHandover = custody[custody.length - 1];
    expect(review.revisions).toHaveLength(127);
    expect(() => returnApprovalCheckpoint(order, review, [...custody.slice(0, -1), { ...lastHandover, revision: 1 }]))
      .toThrow('Review the current return targets');
    return { checkpoint: returnApprovalCheckpoint(order, review, custody), review, affectedGrantId: grantIds[6], lastHandover };
  });
  const requestId = await s.insertReturn(review.checkpoint);
  const document = vi.spyOn(ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const fresh = await s.manager.query(approvals.detail, { requestId });
  expect(fresh).toMatchObject({ status: 'pending', freshness: 'checked', authorityCurrent: true, kind: 'returnItems', rows: [{ label: 'Gift voucher' }] });
  expect(document.mock.calls.length + 1).toBe(112); // The manager access builder reads one staff grant.
  expect(ranges.mock.calls.length + 1).toBe(112);
  for (const mismatch of [
    { rulesRevision: 999 }, { requesterAccessFingerprint: 'revoked' },
    { rulesRevision: 999, requesterAccessFingerprint: 'revoked' },
  ]) {
    const staleId = await s.insertReturn({ ...review.checkpoint, ...mismatch });
    ranges.mockClear();
    expect(await s.manager.query(approvals.detail, { requestId: staleId })).toMatchObject({ status: 'stale', freshness: 'checked', authorityCurrent: false });
    expect(ranges.mock.calls.length + 1).toBe(112);
  }
  const handoverId = review.lastHandover._id;
  await s.manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), {
    target: { targetType: 'handover', targetId: handoverId }, kind: 'takeBack', input: { quantity: 1 },
    expectedRevision: 0, clientKey: 'take-back-last-handover', reasonCode: 'other', reasonText: 'Guest brought the item back',
  }, {
    assertScope: async () => {},
    prepare: async () => ({ before: { withGuest: 1 }, after: { withGuest: 0 }, apply: async ({ revisionAfter }) => {
      await ctx.db.patch(handoverId, { withGuest: 0, backSellable: 1, revision: revisionAfter });
      return [];
    } }),
  }));
  ranges.mockClear();
  document.mockClear();
  expect(await s.manager.query(approvals.detail, { requestId })).toMatchObject({
    status: 'stale', freshness: 'checked', authorityCurrent: true,
    orderRevision: { expected: 2, current: 2, expectedCommerce: 0, currentCommerce: 1 },
  });
  expect(ranges.mock.calls.length + 1).toBe(112);
  expect(document.mock.calls.length + 1).toBe(112);
  expect(await s.cashier.query(approvals.myStatus, { requestId })).toMatchObject({ status: 'stale' });

  // Requests saved before the checkpoint have no proof for targets beyond the read ceiling.
  const olderRequestId = await s.insertReturn({ orderFingerprint: encodeReturnApprovalReview(review.review) });
  expect(await s.manager.query(approvals.detail, { requestId: olderRequestId })).toMatchObject({ status: 'stale', freshness: 'partial' });

  const sharedRequestId = await s.insertReturn({ ...review.checkpoint, commerceRevision: 1 });
  await s.t.run(ctx => ctx.db.patch(review.affectedGrantId, { revision: 1 }));
  ranges.mockClear();
  expect(await s.manager.query(approvals.detail, { requestId: sharedRequestId })).toMatchObject({
    status: 'stale', revisions: expect.arrayContaining([{ table: 'sessionGrants', id: review.affectedGrantId, expected: 0, current: 1 }]),
  });
  expect(ranges.mock.calls.length + 1).toBe(112);
});

it('sweeps pending commerce requests without a timer and keeps authorized returns in progress', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const adjustmentId = await s.insertAdjustment();
  const returnId = await s.insertReturn();
  const authorizedId = await s.insertReturn({ status: 'authorized' });
  const backlog = await s.t.run(async ctx => {
    return await Promise.all(Array.from({ length: 105 }, () => ctx.db.insert('staffApprovalRequests', s.returnRequest)));
  });
  vi.mocked(Date.now).mockReturnValue(now + APPROVAL_TTL_MS);
  await s.t.mutation(internal.pos.staffApprovals.expirePending, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await s.t.run(async ctx => {
    const requests = await Promise.all(backlog.map(id => ctx.db.get(id)));
    return requests.every(request => request?.status === 'expired');
  })).toBe(true);
  expect(await s.t.run(ctx => ctx.db.get(returnId))).toMatchObject({ status: 'expired', resolvedAt: now + APPROVAL_TTL_MS });
  expect(await s.t.run(ctx => ctx.db.get(adjustmentId))).toMatchObject({ status: 'pending' });
  vi.mocked(Date.now).mockReturnValue(now + APPROVAL_TTL_MS + 1);
  expect(await s.cashier.query(approvals.myStatus, { requestId: adjustmentId })).toMatchObject({ status: 'expired' });
  expect((await s.manager.query(approvals.pendingPage, firstPage)).page).toEqual([]);
  await s.t.mutation(internal.pos.staffApprovals.expirePending, {});
  await s.t.mutation(internal.pos.staffApprovals.expirePending, {});
  expect(await s.t.run(ctx => ctx.db.get(adjustmentId))).toMatchObject({ status: 'expired', resolvedAt: now + APPROVAL_TTL_MS + 1 });
  expect(await s.cashier.query(approvals.myStatus, { requestId: authorizedId })).toMatchObject({ status: 'authorized' });
});

it('replays an adjustment request beyond the former 32-request lookup window', async () => {
  const s = await setup();
  const writer: AdjustmentWriter = {
    assertScope: async () => {},
    prepare: async () => ({
      before: {}, after: {}, apply: async () => { throw new Error('Pending approval cannot write'); },
    }),
  };
  const submit = (clientKey: string) => s.cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), {
    target: { targetType: 'voucher', targetId: s.voucherId }, kind: 'addGoodwill', input: { delta: 1000 },
    expectedRevision: 3, clientKey, reasonCode: 'serviceRecovery',
  }, writer));
  const first = await submit('older-key');
  for (let index = 0; index < 33; index++) await submit(`newer-key-${index}`);
  expect(first.status).toBe('approvalRequired');
  expect(await submit('older-key')).toEqual(first);
  expect(await submit('new-key')).toMatchObject({ status: 'approvalRequired' });
});
