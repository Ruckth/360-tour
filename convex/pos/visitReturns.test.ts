// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { resolveCommerceSettings } from '../commerce/model';
import * as budgets from '../lib/readBudget';
import schema from '../schema';
import { recordReturnDestination } from '../services/model';
import { projectTender } from '../shared/tenderProjection';
import { termsOf } from './private/paymentCommerce';
import type { ReturnPart } from './private/returnPlan';

const modules = import.meta.glob('/convex/**/*.ts');
const command = api.pos.commands.returnItems;
const now = Date.UTC(2026, 10, 19, 5);
const day = 86_400_000;
const price = 120_000;
const terms = termsOf(resolveCommerceSettings(null));
const ownerEmail = 'owner@example.com';
const tillId = 'desk-a';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function setup() {
  vi.stubEnv('ADMIN_EMAILS', ownerEmail);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ tokenIdentifier: 'owner', email: ownerEmail, emailVerified: true });
  return { t, owner };
}

async function service(ctx: MutationCtx) {
  const staffId = await ctx.db.insert('staff', {
    name: 'Mali', role: 'Therapist', color: '#abc', status: 'active',
    workingHours: [], breaks: [], createdAt: now, updatedAt: now,
  });
  const serviceId = await ctx.db.insert('services', {
    slug: 'thai', name: 'Thai', description: '', category: 'Wellness', durationMin: 60, bufferMin: 0,
    price, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: now, updatedAt: now,
  });
  return { staffId, serviceId };
}

function receipt(ctx: MutationCtx, itemCount: number, total: number) {
  return ctx.db.insert('orders', {
    orderNumber: 1, receiptNumber: 100, currency: 'THB', status: 'paid', itemCount, hasItems: true,
    total, due: 0, revision: 1, paidAt: now, createdBy: 'owner', createdAt: now, updatedAt: now, vatVersion: 2,
  });
}

function card(ctx: MutationCtx, orderId: Id<'orders'>, amount: number) {
  return ctx.db.insert('orderPayments', { orderId, method: 'card', amount, idempotencyKey: 'paid', createdAt: now, createdBy: 'owner' });
}

function line(ctx: MutationCtx, orderId: Id<'orders'>, kind: Doc<'orderLines'>['kind'], amount: number, fields: Partial<Doc<'orderLines'>>) {
  return ctx.db.insert('orderLines', {
    orderId, kind, name: kind, qty: 1, unitPrice: amount, catalogUnitPrice: amount, currency: 'THB', createdAt: now, ...fields,
  });
}

function allocation(amount: number) {
  return {
    paidShare: amount, vatBase: amount, returnedAmount: 0, returnedUnits: 0,
    tenderCells: [{ kind: 'external' as const, amount }],
  };
}

function snapshot(label: string, amount: number, contents: NonNullable<Doc<'orderLines'>['saleSnapshot']>['contents'] = []) {
  return { label, settingsRevision: 0, terms, ...allocation(amount), contents, chosenVariants: [], goodwillDiscounts: [] };
}

async function visit(
  ctx: MutationCtx, orderId: Id<'orders'>, roster: Awaited<ReturnType<typeof service>>,
  options: { covered?: boolean; linked?: boolean; refunded?: number } = {},
) {
  const amount = options.covered ? 0 : price;
  const appointmentId = await ctx.db.insert('appointments', {
    ...roster, amountPaid: amount, amountRefunded: options.refunded ?? 0, serviceNameSnapshot: 'Thai', staffNameSnapshot: 'Mali',
    paidAt: now, paidBy: ownerEmail, paymentStatus: 'paid', price: amount, currency: 'THB', status: 'completed',
    start: now - day, end: now - day + 3_600_000, blockedUntil: now - day + 3_600_000,
    guestName: 'Guest', guestPhone: '', guestPhoneDigits: '', source: 'admin',
    confirmationCode: 'test-visit', accessToken: 'test-access', createdAt: now, revision: 4,
  });
  const lineId = await line(ctx, orderId, options.linked ? 'service' : 'appointment', amount, {
    ...(options.linked ? {} : { appointmentId }), serviceId: roster.serviceId, saleSnapshot: snapshot('Thai', amount),
  });
  if (options.linked) await ctx.db.insert('orderLineLinks', {
    orderId, lineId, appointmentId, kind: 'appointment', status: 'active', amount,
    currency: 'THB', effectiveAt: now, linkedAt: now, linkedBy: 'owner', reason: 'Match visit', sequence: 1,
  });
  return { appointmentId, lineId };
}

async function retail(ctx: MutationCtx, orderId: Id<'orders'>, count: number) {
  const branchId = await ctx.db.insert('branches', { key: 'default' });
  const categoryId = await ctx.db.insert('productCategories', { name: 'Gifts', sort: 0 });
  const productId = await ctx.db.insert('products', {
    categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [],
    minPrice: 100, maxPrice: 100, variantCount: count, sort: 0, revision: 0,
  });
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const variantId = await ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label: 'Robe', price: 100, status: 'active', revision: 0,
    });
    const stockId = await ctx.db.insert('stockLevels', { branchId, productId, variantId, onHand: 0, revision: 1 });
    const movement = await ctx.db.insert('stockMovements', {
      branchId, variantId, delta: -1, before: 1, after: 0, kind: 'sale', sourceKey: `robe:${index}`, actor: 'owner', createdAt: now,
    });
    const lineId = await line(ctx, orderId, 'product', 100, {
      variantId, saleSnapshot: snapshot('Robe', 100, [{
        contentKey: 'robe', label: 'Robe', units: 1, vatProfile: 'standard', stockMovementId: movement, ...allocation(100),
      }]),
    });
    return { stockId, part: { kind: 'line', lineId, units: 1, disposition: 'sellable' } as const };
  }));
}

function selection(orderId: Id<'orders'>, parts: ReturnPart[]) {
  return { orderId, parts, clientKey: 'test-visit-return', tillId, reason: 'Visit return', expectedRevision: 1, expectedCorrectionRevision: 0 };
}

function destination({ returnId, operatorRevision }: { returnId: Id<'orderReturns'>; operatorRevision: number }, destinationKey = 'external:1') {
  return { returnId, operatorRevision, tillId, destinationKey };
}

const payout = (...args: Parameters<typeof destination>) => ({ ...destination(...args), outcome: 'given' as const });

async function measured<T>(label: string, maxReads: number, maxWrites: number, run: () => Promise<T>) {
  const reads = vi.spyOn(budgets.ReadBudget.prototype, 'document');
  const writes = vi.spyOn(budgets, 'reserveWrites');
  const started = performance.now();
  try {
    const result = await run();
    const count = writes.mock.calls.reduce((total, [, amount]) => total + amount, 0);
    console.info(`${label}: ${reads.mock.calls.length} metered reads, ${count} reserved writes, ${Math.round(performance.now() - started)} ms`);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(maxReads);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(maxWrites);
    return result;
  } finally {
    reads.mockRestore();
    writes.mockRestore();
  }
}

it('returns 15 products and five visits with one payout after 200 earlier refunds, within budget', async () => {
  const { t, owner } = setup();
  const { args, visits, goods } = await t.run(async ctx => {
    const total = 15 * 100 + 5 * price;
    const orderId = await receipt(ctx, 21, total + price);
    const roster = await service(ctx);
    const visits = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      visit(ctx, orderId, roster, { linked: index === 1, refunded: index === 0 ? 200 : 0 })));
    for (let index = 0; index < 200; index++) await ctx.db.insert('appointmentRefunds', {
      appointmentId: visits[0].appointmentId, orderId, amount: 1, currency: 'THB', method: 'card', reason: 'Earlier refund',
      effectiveAt: now - day, recordedAt: now - day, recordedBy: ownerEmail, idempotencyKey: `earlier:${index}`,
      netBefore: price - index, netAfter: price - index - 1,
    });
    const goods = await retail(ctx, orderId, 15);
    await card(ctx, orderId, total + price);
    const args = selection(orderId, [...goods.map(item => item.part), ...visits.slice(0, 5).map(({ lineId }) => ({ kind: 'line' as const, lineId, units: 1 }))]);
    return { args, visits, goods };
  });
  await expect(owner.mutation(command.authorize, { ...args, parts: visits.map(({ lineId }) => ({ kind: 'line' as const, lineId, units: 1 })) }))
    .rejects.toThrow('RETURN_VISIT_LIMIT');
  const held = await measured('15 products + 5 visits authorize', 90, 510, () => owner.mutation(command.authorize, args));
  expect(held.claims).toMatchObject([{ state: 'instructed', amount: 5 * price + 1500 - 200 }]);
  expect(await owner.mutation(command.authorize, args)).toMatchObject({ replayed: true, returnId: held.returnId, instruction: null });
  await expect(owner.mutation(command.authorize, { ...args, reason: 'Different reason' })).rejects.toThrow('RETURN_KEY_CONFLICT');
  expect(await t.run(ctx => ctx.db.get(visits[1].appointmentId))).toMatchObject({ pendingReturn: { returnId: held.returnId, remaining: price } });
  const given = { ...payout(held), reference: 'card-001' };
  expect(await measured('15 products + 5 visits payout', 95, 280, () => owner.mutation(command.recordPayout, given)))
    .toMatchObject({ status: 'completed' });
  expect(await owner.mutation(command.recordPayout, given)).toMatchObject({ replayed: true });
  await expect(owner.mutation(command.recordPayout, { ...given, reference: 'card-002' })).rejects.toThrow();
  const result = await t.run(async ctx => {
    const visitRows = await Promise.all(visits.slice(0, 5).map(({ appointmentId }) => ctx.db.get(appointmentId)));
    const history = await ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q =>
      q.eq('entityType', 'appointment').eq('entityId', visits[0].appointmentId)).take(2);
    return {
      visitRows, history, payouts: await ctx.db.query('returnPayouts').take(2),
      mirrors: await ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', args.orderId)).order('desc').take(5),
      goods: await Promise.all(goods.map(({ stockId }) => ctx.db.get(stockId))),
    };
  });
  expect(result.visitRows.every(row => row?.paymentStatus === 'refunded' && row.amountRefunded === price && !row.pendingReturn)).toBe(true);
  expect(result.goods.every(row => row?.onHand === 1)).toBe(true);
  expect(result.history).toMatchObject([{ after: { returnId: held.returnId, refundAmount: price - 200 } }]);
  expect(result.mirrors.every(row => row.returnId === held.returnId)).toBe(true);
  expect(result.payouts).toHaveLength(1);
  expect(projectTender({ payouts: result.payouts, refunds: result.mirrors.map(row => ({ ...row, date: row.effectiveAt })) }).refunded)
    .toBe(5 * price + 1500 - 200);

  const replay = { key: 'external:1', method: 'card' as const, amount: price - 200, actor: ownerEmail, effectiveAt: now };
  await t.run(async ctx => {
    const row = (await ctx.db.get(held.returnId))!;
    expect(await recordReturnDestination(ctx, row, visits[0].lineId, replay)).toMatchObject({ replayed: true });
    await expect(recordReturnDestination(ctx, row, visits[0].lineId, { ...replay, amount: replay.amount - 1 }))
      .rejects.toThrow('RETURN_KEY_CONFLICT');
  });
});

it('blocks desk refunds and edits while an open return claims the visit, then releases after a verified cancel', async () => {
  const { t, owner } = setup();
  const { args, appointmentId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 2, price + 100);
    const { appointmentId, lineId } = await visit(ctx, orderId, await service(ctx));
    await retail(ctx, orderId, 1);
    await card(ctx, orderId, price + 100);
    return { appointmentId, args: selection(orderId, [{ kind: 'line', lineId, units: 1 }]) };
  });
  const quote = await owner.mutation(command.authorize, args);
  const cancel = { returnId: quote.returnId, tillId, operatorRevision: quote.operatorRevision };
  await expect(owner.mutation(command.cancel, cancel)).rejects.toThrow('RETURN_CHECK_PREVIOUS');
  await expect(owner.mutation(api.services.commands.refundAppointment.refundAppointment, {
    appointmentId, orderId: args.orderId, amount: 1, currency: 'THB', reason: 'Desk refund', method: 'card',
    idempotencyKey: 'pending-visit-refund', expectedRevision: 4,
  })).rejects.toThrow('RETURN_IN_PROGRESS');
  const edit = { appointmentId, expectedRevision: 5, guestName: 'Renamed', guestPhone: '' };
  await expect(owner.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, edit))
    .rejects.toThrow('RETURN_IN_PROGRESS');
  const failed = await owner.mutation(command.recordPayout, { ...payout(quote), outcome: 'failed' });
  const verified = { ...cancel, operatorRevision: failed.operatorRevision };
  expect(await measured('Verified visit cancel', 18, 320, () => owner.mutation(command.cancel, verified))).toMatchObject({ status: 'cancelled' });
  expect(await owner.mutation(command.cancel, verified)).toMatchObject({ status: 'cancelled' });
  const restored = await t.run(ctx => ctx.db.get(appointmentId));
  expect(restored).toMatchObject({ paymentStatus: 'paid', price, amountPaid: price, revision: 6 });
  expect(restored).not.toHaveProperty('pendingReturn');
  expect(await t.run(ctx => ctx.db.query('appointmentRefunds').take(1))).toEqual([]);
  await owner.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { ...edit, expectedRevision: 6 });
  // Released, but still a commerce receipt: its visit money goes back only through Return items.
  await expect(owner.mutation(api.services.commands.refundAppointment.refundAppointment, {
    appointmentId, orderId: args.orderId, amount: 1, currency: 'THB', reason: 'Desk refund', method: 'card',
    idempotencyKey: 'commerce-visit-refund', expectedRevision: 7,
  })).rejects.toThrow('USE_RETURN_ITEMS');
  expect(await t.run(ctx => ctx.db.query('appointmentRefunds').take(1))).toEqual([]);
});

async function coveredVisit(
  ctx: MutationCtx, orderId: Id<'orders'>, bucket: 'paid' | 'goodwill' = 'paid', expiresAt = now + day,
) {
  const roster = await service(ctx);
  const { appointmentId, lineId } = await visit(ctx, orderId, roster, { covered: true });
  const branchId = await ctx.db.insert('branches', { key: 'default' });
  const ownerId = await ctx.db.insert('customers', { name: 'Guest', createdBy: ownerEmail, createdAt: now, updatedAt: now });
  const packageId = await ctx.db.insert('packages', { name: 'Thai', status: 'active', sort: 0, revision: 0 });
  const packageVersionId = await ctx.db.insert('packageVersions', {
    packageId, version: 1, name: 'Thai', price, validityDays: 365, allowTransfer: false, contents: [], estimatedSplit: [],
  });
  const grantId = await ctx.db.insert('sessionGrants', {
    ownerId, branchId, orderId, lineId, contentKey: 'thai', packageVersionId, total: 1, used: 1, paidUnits: 0, goodwillUnits: 0,
    returnedUnits: 0, paidShare: price, expiresAt, issuedTerms: {
      expiresAt, serviceIds: [roster.serviceId], allowTransfer: false,
    }, settingsRevision: 0, terms, grantServiceIds: [], revision: 4,
  });
  const serviceProjection = await ctx.db.insert('grantServices', {
    grantId, ownerId, serviceId: roster.serviceId, branchId, usable: false, expiresAt,
  });
  await ctx.db.patch(grantId, { grantServiceIds: [serviceProjection] });
  const useId = await ctx.db.insert('sessionUses', {
    grantId, lineId, serviceId: roster.serviceId, activeAppointmentId: appointmentId, beneficiaryId: ownerId,
    kind: 'use', bucket, sourceKey: 'thai-use', createdAt: now - 1000, actor: 'owner',
    before: { paid: Number(bucket === 'paid'), goodwill: Number(bucket === 'goodwill') }, after: { paid: 0, goodwill: 0 }, guestFact: 'Used for visit',
  });
  await ctx.db.patch(appointmentId, { attendeeId: ownerId, coverage: { grantId, useId, priceBefore: price } });
  await ctx.db.patch(lineId, { coverage: { grantId, useId, priceBefore: price, attendeeId: ownerId } });
  return { appointmentId, grantId, useId, serviceProjection, part: { kind: 'restoreSession' as const, lineId, useId } };
}

it('restores a covered visit to unpaid at its frozen price and collects that price once', async () => {
  const { t, owner } = setup();
  const { args, appointmentId, grantId, useId, serviceProjection } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, 0);
    const covered = await coveredVisit(ctx, orderId);
    return { ...covered, args: selection(orderId, [covered.part]) };
  });
  // The desk shows the restore as its own part, with no money.
  expect((await owner.query(command.preview, args)).rows).toMatchObject([{ amount: 0, parts: [{ kind: 'restore', amount: 0 }] }]);
  const result = await measured('Covered visit restore', 40, 510, () => owner.mutation(command.authorize, args));
  expect(result).toMatchObject({ status: 'completed', claims: [] });
  expect(await owner.mutation(command.authorize, args)).toMatchObject({ replayed: true });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'unpaid', price, amountPaid: 0 });
  expect(await t.run(ctx => ctx.db.get(grantId))).toMatchObject({ paidUnits: 1, used: 0 });
  expect(await t.run(ctx => ctx.db.get(serviceProjection))).toMatchObject({ usable: true });
  expect(await t.run(ctx => ctx.db.get(useId))).not.toHaveProperty('activeAppointmentId');
  expect(await t.run(ctx => ctx.db.query('appointmentRefunds').take(1))).toEqual([]);
  const desk = { appointmentId, expectedRevision: 6, method: 'cash' as const, idempotencyKey: 'restored-visit-pay' };
  const paid = await owner.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, desk);
  expect(await owner.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, desk)).toMatchObject({ ...paid, replayed: true });
  expect(await t.run(ctx => ctx.db.query('appointmentPayments').take(2))).toMatchObject([{ amount: price }]);
});

it('keeps a visit reserved after partial payout and records its external and voucher destinations once each', async () => {
  const { t, owner } = setup();
  const { args, appointmentId, voucherId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, price);
    const { appointmentId, lineId } = await visit(ctx, orderId, await service(ctx));
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const voucherId = await ctx.db.insert('vouchers', {
      faceValue: 50_000, paidBalance: 0, goodwillBalance: 0, issuedExpiresAt: now + day, effectiveExpiresAt: now + day,
      status: 'active', branchId, source: { kind: 'sale', orderId, lineId }, revision: 1, settingsRevision: 0, terms,
    });
    await ctx.db.patch(lineId, { saleSnapshot: {
      ...snapshot('Thai', price), tenderCells: [{ kind: 'external', amount: 70_000 }, { kind: 'voucher', amount: 50_000, voucherId }],
    } });
    await card(ctx, orderId, 70_000);
    await ctx.db.insert('orderPayments', { orderId, method: 'voucher', voucherId, amount: 50_000, idempotencyKey: 'paid', createdAt: now, createdBy: 'owner' });
    const args = selection(orderId, [{ kind: 'line', lineId, units: 1 }]);
    return { args, appointmentId, voucherId };
  });
  const quote = await owner.query(command.preview, args);
  expect(quote).toMatchObject({
    amount: 120_000,
    rows: [{ amount: price, parts: [{ kind: 'visit', label: 'Thai', amount: price }] }],
    destinations: [
      { kind: 'external', method: 'card', amount: 70_000 },
      { kind: 'voucher', voucherId, amount: 50_000, goodwill: 0, destination: { kind: 'existingVoucher', voucherId } },
    ],
  });
  await expect(owner.mutation(command.authorize, { ...args, destinations: [{ method: 'card', amount: 120_000 }] }))
    .rejects.toThrow('RETURN_DESTINATION_TOTAL');
  const split = { ...args, destinations: [{ method: 'card' as const, amount: 60_000 }, { method: 'cash' as const, amount: 10_000 }] };
  const held = await owner.mutation(command.authorize, split);
  expect(held.destinations).toMatchObject([
    { kind: 'external', method: 'card', amount: 60_000 }, { kind: 'external', method: 'cash', amount: 10_000 },
    { kind: 'voucher', voucherId, amount: 50_000, goodwill: 0, destination: { kind: 'existingVoucher', voucherId } },
  ]);
  expect(await owner.mutation(command.authorize, split)).toMatchObject({ replayed: true, instruction: null, destinations: held.destinations });
  const first = await owner.mutation(command.recordPayout, payout(held));
  expect(first.status).toBe('authorized');
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({
    pendingReturn: { returnId: held.returnId, remaining: 60_000 }, amountRefunded: 60_000, paymentStatus: 'paid',
  });
  await expect(owner.mutation(command.cancel, { returnId: held.returnId, tillId, operatorRevision: first.operatorRevision }))
    .rejects.toThrow('RETURN_ALREADY_PAID');
  const armed = await owner.mutation(command.arm, destination(first, 'external:2'));
  const second = payout(armed, 'external:2');
  expect(await owner.mutation(command.recordPayout, second)).toMatchObject({ status: 'completed' });
  expect(await owner.mutation(command.recordPayout, second)).toMatchObject({ replayed: true });
  const recorded = await t.run(async ctx => ({
    visit: await ctx.db.get(appointmentId), voucher: await ctx.db.get(voucherId),
    mirrors: await ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', args.orderId)).take(4),
    payouts: await ctx.db.query('returnPayouts').take(3),
  }));
  expect(recorded.visit).toMatchObject({ paymentStatus: 'refunded', amountRefunded: price });
  expect(recorded.visit).not.toHaveProperty('pendingReturn');
  expect(recorded.voucher?.paidBalance).toBe(50_000);
  expect(recorded.mirrors).toMatchObject([
    { returnId: held.returnId, method: 'card', amount: 60_000, netBefore: price, netAfter: 60_000 },
    { returnId: held.returnId, method: 'cash', amount: 10_000, netBefore: 60_000, netAfter: 50_000 },
    { returnId: held.returnId, method: 'voucher', amount: 50_000, netBefore: 50_000, netAfter: 0 },
  ]);
  expect(recorded.payouts).toMatchObject([
    { amount: 60_000, sourceOwner: { kind: 'appointment', appointmentId } },
    { amount: 10_000, sourceOwner: { kind: 'appointment', appointmentId } },
  ]);
});

it('preserves the covered visit and used session when a mixed return is cancelled', async () => {
  const { t, owner } = setup();
  const { args, appointmentId, grantId, useId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 2, 100);
    const covered = await coveredVisit(ctx, orderId);
    const [goods] = await retail(ctx, orderId, 1);
    await card(ctx, orderId, 100);
    return { ...covered, args: selection(orderId, [goods.part, covered.part]) };
  });
  const held = await owner.mutation(command.authorize, args);
  expect(await t.run(ctx => ctx.db.get(grantId))).toMatchObject({ pendingReturnId: held.returnId, used: 1, paidUnits: 0 });
  const failed = await owner.mutation(command.recordPayout, { ...payout(held), outcome: 'failed' });
  expect(await owner.mutation(command.cancel, { returnId: failed.returnId, tillId, operatorRevision: failed.operatorRevision }))
    .toMatchObject({ status: 'cancelled' });
  const saved = await t.run(async ctx => ({ grant: await ctx.db.get(grantId), visit: await ctx.db.get(appointmentId), use: await ctx.db.get(useId) }));
  expect(saved.grant).toMatchObject({ used: 1, paidUnits: 0 });
  expect(saved.grant).not.toHaveProperty('pendingReturnId');
  expect(saved.visit).toMatchObject({ paymentStatus: 'paid', coverage: { useId } });
  expect(saved.visit).not.toHaveProperty('pendingReturn');
  expect(saved.use?.activeAppointmentId).toBe(appointmentId);
});

it.each(['paid', 'goodwill'] as const)('restores an expired %s use without making it available to spend', async bucket => {
  const { t, owner } = setup();
  const { args, appointmentId, grantId, serviceProjection } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, 0);
    const covered = await coveredVisit(ctx, orderId, bucket, now - 1);
    return { ...covered, args: selection(orderId, [covered.part]) };
  });
  expect(await owner.mutation(command.authorize, args)).toMatchObject({ status: 'completed' });
  const saved = await t.run(async ctx => ({
    grant: await ctx.db.get(grantId), visit: await ctx.db.get(appointmentId), projection: await ctx.db.get(serviceProjection),
  }));
  expect(saved.grant).toMatchObject({ used: 0, paidUnits: Number(bucket === 'paid'), goodwillUnits: 0 });
  expect(saved.visit).toMatchObject({ price, paymentStatus: 'unpaid' });
  expect(saved.projection).toMatchObject({ usable: false });
});

it('refuses to restore a use made before a package transfer even if the grant is back with the original owner', async () => {
  const { t, owner } = setup();
  const args = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, 0);
    const covered = await coveredVisit(ctx, orderId);
    await ctx.db.insert('sessionUses', {
      grantId: covered.grantId, actor: 'owner', createdAt: now - 500, kind: 'transfer', sourceKey: 'transfer-back',
      before: { paid: 0, goodwill: 0 }, after: { paid: 0, goodwill: 0 }, guestFact: 'Package transferred back',
    });
    return selection(orderId, [covered.part]);
  });
  await expect(owner.mutation(command.authorize, args)).rejects.toThrow('RETURN_SESSION_TRANSFERRED');
  expect(await t.run(ctx => ctx.db.query('orderReturns').take(1))).toEqual([]);
});

it('projects attached, linked and covered visit parts on the receipt and quotes each through the owning adapter', async () => {
  const { t, owner } = setup();
  const { args, attached, linked, covered, stayLine } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 4, price * 2);
    const roster = await service(ctx);
    const attached = await visit(ctx, orderId, roster);
    const linked = await visit(ctx, orderId, roster, { linked: true });
    const covered = await coveredVisit(ctx, orderId);
    const stayLine = await line(ctx, orderId, 'booking', 0, { saleSnapshot: snapshot('Accommodation', 0) });
    await card(ctx, orderId, price * 2);
    const args = selection(orderId, [
      { kind: 'line', lineId: attached.lineId, units: 1 },
      { kind: 'line', lineId: linked.lineId, units: 1 },
      covered.part,
    ]);
    return { args, attached, linked, covered, stayLine };
  });
  const view = await owner.query(api.pos.orders.getOrder, { orderId: args.orderId });
  expect(view?.commerce?.returnableVisitParts).toEqual([
    { lineId: attached.lineId, appointmentId: attached.appointmentId, label: 'Thai', amount: price, part: args.parts[0] },
    { lineId: linked.lineId, appointmentId: linked.appointmentId, label: 'Thai', amount: price, part: args.parts[1] },
    { lineId: covered.part.lineId, appointmentId: covered.appointmentId, label: 'Thai', amount: 0, part: args.parts[2] },
  ]);
  expect(await owner.query(command.preview, args)).toMatchObject({
    amount: price * 2, rows: [
      { lineId: attached.lineId, amount: price, parts: [{ kind: 'visit' }] },
      { lineId: linked.lineId, amount: price, parts: [{ kind: 'visit' }] },
      { lineId: covered.part.lineId, amount: 0, parts: [{ kind: 'restore' }] },
    ],
  });
  await expect(owner.query(command.preview, { ...args, parts: [{ kind: 'line', lineId: stayLine, units: 1 }] }))
    .rejects.toThrow('RETURN_BOOKING_OWNED');
});

it('refuses a D19 payment date after a visit-only payout, including a payout saved before the order index', async () => {
  const { t, owner } = setup();
  const { args, appointmentId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 2, price + 100);
    const source = await visit(ctx, orderId, await service(ctx));
    await retail(ctx, orderId, 1);
    await card(ctx, orderId, price + 100);
    return { args: selection(orderId, [{ kind: 'line', lineId: source.lineId, units: 1 }]), appointmentId: source.appointmentId };
  });
  const held = await owner.mutation(command.authorize, args);
  expect(await t.run(ctx => ctx.db.get(args.orderId))).toMatchObject({ commerceRevision: 2 });
  await owner.mutation(command.recordPayout, payout(held));
  expect(await t.run(ctx => ctx.db.get(args.orderId))).toMatchObject({ commerceRevision: 5 });
  vi.mocked(Date.now).mockReturnValue(now + day);
  const edit = {
    target: { targetType: 'order' as const, targetId: args.orderId }, kind: 'amendPayment' as const,
    expectedRevision: 0, clientKey: 'date-after-visit-payout', reasonCode: 'staffMistake', input: { effectiveAt: now + day },
  };
  await expect(owner.mutation(api.pos.commands.adjust.adjust, edit)).rejects.toThrow('PAYMENT_DATE_AFTER_REFUND');
  await t.run(async ctx => {
    const event = (await ctx.db.query('returnPayouts').first())!;
    expect(event).toMatchObject({ orderId: args.orderId, businessDate: '2026-11-19' });
    await ctx.db.patch(event._id, { orderId: undefined });
  });
  await expect(owner.mutation(api.pos.commands.adjust.adjust, edit)).rejects.toThrow('PAYMENT_DATE_AFTER_REFUND');
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ paidAt: now });
  expect(await t.run(ctx => ctx.db.get(args.orderId))).not.toHaveProperty('paymentEffectiveAt');
});

it('bumps both order checkpoints when D19 changes the date of a visit on a prior receipt', async () => {
  const { t, owner } = setup();
  const { orderId, earlierOrderId, appointmentId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, price);
    const roster = await service(ctx);
    const { appointmentId } = await visit(ctx, orderId, roster, { linked: true });
    await card(ctx, orderId, price);
    const earlierOrderId = await receipt(ctx, 1, 0);
    await line(ctx, earlierOrderId, 'appointment', 0, {
      appointmentId, serviceId: roster.serviceId, saleSnapshot: { ...snapshot('Thai', 0), returnedUnits: 1 },
    });
    return { orderId, earlierOrderId, appointmentId };
  });
  const effectiveAt = now - day;
  const edit = {
    target: { targetType: 'order' as const, targetId: orderId }, kind: 'amendPayment' as const,
    expectedRevision: 0, clientKey: 'redate-return-source', reasonCode: 'staffMistake', input: { effectiveAt },
  };
  const result = await owner.mutation(api.pos.commands.adjust.adjust, edit);
  expect(result).toMatchObject({ status: 'applied' });
  expect(await owner.mutation(api.pos.commands.adjust.adjust, edit)).toEqual(result);
  await t.run(async ctx => {
    expect(await ctx.db.get(orderId)).toMatchObject({ commerceRevision: 1 });
    expect(await ctx.db.get(earlierOrderId)).toMatchObject({ commerceRevision: 1 });
    expect(await ctx.db.get(appointmentId)).toMatchObject({ paidAt: effectiveAt, revision: 5 });
  });
});

it('invalidates another receipt approval when a visit restore reserves its issuing grant, then releases both owners on cancel', async () => {
  const { t, owner } = setup();
  const cashier = t.withIdentity({ tokenIdentifier: 'cashier', email: 'cashier@example.com', emailVerified: true });
  const { cashArgs, restoreArgs, grantId, appointmentId } = await t.run(async ctx => {
    await ctx.db.insert('staffGrants', {
      tokenIdentifier: 'cashier', role: 'cashier', email: 'cashier@example.com', createdAt: now, updatedAt: now, updatedByEmail: ownerEmail,
    });
    const visitOrder = await receipt(ctx, 2, 100);
    const covered = await coveredVisit(ctx, visitOrder);
    const grant = (await ctx.db.get(covered.grantId))!;
    const saleOrder = await receipt(ctx, 1, price * 2);
    const packageLine = await line(ctx, saleOrder, 'package', price * 2, {
      packageVersionId: grant.packageVersionId, saleSnapshot: snapshot('Thai package', price * 2, [{
        ...allocation(price * 2), contentKey: grant.contentKey, grantId: grant._id, vatProfile: 'standard', label: 'Thai sessions', units: 2,
      }]),
    });
    await ctx.db.patch(grant._id, { orderId: saleOrder, lineId: packageLine, total: 2, paidUnits: 1, paidShare: price * 2 });
    const [goods] = await retail(ctx, visitOrder, 1);
    await card(ctx, visitOrder, 100);
    await card(ctx, saleOrder, price * 2);
    return {
      cashArgs: selection(saleOrder, [{ kind: 'cancelPackage', lineId: packageLine }]),
      restoreArgs: selection(visitOrder, [goods.part, covered.part]), grantId: grant._id, appointmentId: covered.appointmentId,
    };
  });
  const request = await cashier.mutation(command.askManager, cashArgs);
  expect(await owner.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'pending' });
  const held = await owner.mutation(command.authorize, restoreArgs);
  expect(await t.run(ctx => ctx.db.get(grantId))).toMatchObject({ revision: 5, pendingReturnId: held.returnId });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ revision: 5, pendingReturn: { returnId: held.returnId } });
  expect(await t.run(ctx => ctx.db.get(cashArgs.orderId))).toMatchObject({ commerceRevision: 1 });
  expect(await owner.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'stale' });
  expect(await owner.mutation(command.decideApproval, { requestId: request.requestId, decision: 'approve' })).toMatchObject({ status: 'stale' });
  const failed = await owner.mutation(command.recordPayout, { ...payout(held), outcome: 'failed' });
  await owner.mutation(command.cancel, { returnId: held.returnId, tillId, operatorRevision: failed.operatorRevision });
  expect(await t.run(ctx => ctx.db.get(grantId))).toMatchObject({ revision: 6, paidUnits: 1, used: 1 });
  expect(await t.run(ctx => ctx.db.get(cashArgs.orderId))).toMatchObject({ commerceRevision: 2 });
  expect(await t.run(ctx => ctx.db.get(restoreArgs.orderId))).toMatchObject({ commerceRevision: 5 });
});

it('leaves a performed covered visit and its use in place when the mistaken receipt is voided', async () => {
  const { t, owner } = setup();
  const { orderId, appointmentId, useId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 1, 0);
    return { orderId, ...await coveredVisit(ctx, orderId) };
  });
  await owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
    orderId, expectedCorrectionRevision: 0, reason: 'Mistaken receipt', idempotencyKey: 'covered-void',
  });
  expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ status: 'void', commerceRevision: 1 });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'paid', coverage: { useId } });
  expect(await t.run(ctx => ctx.db.get(useId))).toMatchObject({ activeAppointmentId: appointmentId });
});
