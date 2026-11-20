// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import * as readBudgetModule from './lib/readBudget';
import { ReadBudget } from './lib/readBudget';
import { api } from './_generated/api';
import schema from './schema';
import { resolveCommerceSettings } from './commerce/model';
import type { FunctionArgs } from 'convex/server';
import { termsOf } from './pos/private/paymentCommerce';
import { receiptVat } from './shared/commerce';
import { resortTodayIso } from './shared/time';

const modules = import.meta.glob('./**/*.ts');
const start = api.pos.commands.startPaymentAttempt.startPaymentAttempt;
const rollout = api.commerce.paymentCutover;
const DEVICE_A = 'test-payment-device-aaaa';
const DEVICE_B = 'test-payment-device-bbbb';
const TAB_A = 'test-payment-tab-aaaaaaaa';
const TAB_B = 'test-payment-tab-bbbbbbbb';

async function fixture(mode: 'direct' | 'attempts' = 'attempts') {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner', name: 'Desk Owner' });
  const { orderId } = await owner.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Tea', price: 60000 } });
  const settingsId = await t.run(ctx => ctx.db.insert('commerceSettings', {
    key: 'default', ...resolveCommerceSettings(null), paymentsMode: mode,
  }));
  const order = await t.run(ctx => ctx.db.get(orderId));
  if (mode === 'direct') {
    await owner.mutation(rollout.setPaused, { expectedRevision: 0, clientKey: 'pause-checkout', reason: 'Announced desk update', paused: true });
    await owner.mutation(rollout.activate, { expectedRevision: 1, clientKey: 'activate-checkout', reason: 'Announced desk update' });
  }
  const revision = mode === 'direct' ? 2 : 0;
  const [deskA, deskB] = await Promise.all([DEVICE_A, DEVICE_B].map(async deviceKey =>
    (await owner.mutation(rollout.acknowledge, { deviceKey, loadedMode: 'attempts', loadedRevision: revision })).tillId));
  const request: FunctionArgs<typeof start> = {
    orderId, ...at(deskA, DEVICE_A, revision), clientKey: 'attempt-a', expectedRevision: order!.revision, expectedDue: 60000,
    businessDate: resortTodayIso(), customers: [], vouchers: [],
    legs: [{ key: 'card-1', method: 'card' as const, amount: 60000 }],
  };
  return { t, owner, settingsId, request, deskA, deskB };
}

/** The till an attempt starts on and its acknowledged load. */
const at = (tillId: Id<'tills'>, deviceKey = DEVICE_A, loadedRevision = 0, tabKey = TAB_A) =>
  ({ tillId, tabKey, load: { tillId, deviceKey, loadedMode: 'attempts' as const, loadedRevision } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('atomically claims the order and replays only the same scoped quote', async () => {
  const { t, owner, request, deskB } = await fixture();
  const results = await Promise.all([
    owner.mutation(start, request),
    owner.mutation(start, { ...request, ...at(deskB, DEVICE_B), clientKey: 'attempt-b' }),
  ]);
  const winner = results.find(result => result.status === 'ready');
  expect(winner).toBeDefined();
  expect(results.filter(result => result.status === 'in_progress_elsewhere')).toHaveLength(1);
  const original = winner?.attempt.tillId === request.tillId ? request : { ...request, ...at(deskB, DEVICE_B), clientKey: 'attempt-b' };
  await expect(owner.mutation(start, original)).resolves.toMatchObject({ status: 'ready', replayed: true });
  await expect(owner.mutation(start, { ...original, expectedDue: 1 })).resolves.toMatchObject({ status: 'refused', code: 'payment_key_conflict' });
  await expect(t.mutation(start, original)).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.query('paymentAttempts').take(3))).toHaveLength(1);
}, 30000);

it('refuses an old panel or an unacknowledged till at attempt start, before any replay', async () => {
  const { t, owner, request, deskA, settingsId } = await fixture();
  const refused = { status: 'refused', code: 'TILL_NEEDS_RELOAD' };
  const { load: _load, ...withoutLoad } = request;
  void _load;
  await expect(owner.mutation(start, withoutLoad)).resolves.toMatchObject(refused);
  await expect(owner.mutation(start, { ...request, load: { ...request.load!, loadedMode: 'direct' } })).resolves.toMatchObject(refused);
  await expect(owner.mutation(start, { ...request, load: { ...request.load!, loadedRevision: 1 } })).resolves.toMatchObject(refused);
  const unacknowledged = await t.run(ctx => ctx.db.insert('tills', { key: 'default' }));
  await expect(owner.mutation(start, { ...request, ...at(unacknowledged) })).resolves.toMatchObject(refused);
  await expect(owner.mutation(start, { ...request, load: at(unacknowledged).load })).resolves.toMatchObject(refused);
  expect(await t.run(ctx => ctx.db.query('paymentAttempts').first())).toBeNull();
  await expect(owner.mutation(start, request)).resolves.toMatchObject({ status: 'ready', replayed: false });
  // A later cutover revision (this page loaded before it) is refused even for the same key.
  await t.run(ctx => ctx.db.patch(settingsId, { revision: 1 }));
  await expect(owner.mutation(start, request)).resolves.toMatchObject(refused);
  await t.run(ctx => ctx.db.patch(deskA, { paymentRollout: { acknowledged: { mode: 'attempts', revision: 1, at: 2 } } }));
  await expect(owner.mutation(start, { ...request, load: { ...request.load!, loadedRevision: 1 } }))
    .resolves.toMatchObject({ status: 'ready', replayed: true });
}, 30000);

it('keeps the attempt path dormant in direct mode', async () => {
  const { t, owner, settingsId, request } = await fixture();
  await t.run(ctx => ctx.db.patch(settingsId, { paymentsMode: 'direct' }));
  await expect(owner.mutation(start, request)).resolves.toMatchObject({ status: 'refused', code: 'payments_direct' });
  expect(await t.run(ctx => ctx.db.query('paymentAttempts').first())).toBeNull();
});

const arm = api.pos.commands.armPaymentLeg.armPaymentLeg;
const record = api.pos.commands.recordPaymentLeg.recordPaymentLeg;
const settle = api.pos.commands.settleOrder.settlePaymentAttempt;

async function claim(owner: Awaited<ReturnType<typeof fixture>>['owner'], request: Awaited<ReturnType<typeof fixture>>['request']) {
  const result = await owner.mutation(start, request);
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  return { attemptId: result.attempt.attemptId, ownerRevision: result.attempt.ownerRevision, tillId: request.tillId, tabKey: request.tabKey };
}

it('arms exactly once, recovers a lost instruction response and settles a verified terminal approval once', async () => {
  const { t, owner, request } = await fixture();
  const attempt = await claim(owner, request);
  const instructions = await Promise.all([owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' }), owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' })]);
  expect(instructions.map(result => result.status).sort()).toEqual(['check_previous', 'instruct']);
  expect(await owner.mutation(settle, attempt)).toMatchObject({ status: 'refused', code: 'check_previous' });
  const evidence = { ...attempt, legKey: 'card-1', outcome: 'taken' as const, reference: 'approved' };
  await expect(owner.mutation(record, evidence)).resolves.toMatchObject({ status: 'recorded', replayed: false });
  await expect(owner.mutation(record, evidence)).resolves.toMatchObject({ status: 'recorded', replayed: true });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled', replayed: false, receiptNumber: 1 });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled', replayed: true, receiptNumber: 1 });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(3))).toMatchObject([{ method: 'card', amount: 60000 }]);
}, 30000);

it('validates the business date before the terminal can be armed', async () => {
  const { t, owner, request } = await fixture();
  await expect(owner.mutation(start, { ...request, businessDate: '1900-01-01' })).resolves.toMatchObject({ status: 'refused' });
  expect(await t.run(ctx => ctx.db.query('paymentAttempts').first())).toBeNull();
}, 30000);

it('refuses a stale direct panel after cutoff', async () => {
  const { owner, request } = await fixture();
  await expect(owner.mutation(api.pos.commands.settleOrder.settleOrder, {
    orderId: request.orderId, idempotencyKey: 'direct-key', expectedRevision: request.expectedRevision,
    expectedDue: request.expectedDue, tenders: [{ method: 'card', amount: request.expectedDue }],
  })).rejects.toThrow('Reload checkout');
}, 30000);

it('keeps paid voucher value outside cash and freezes goodwill as a discount', async () => {
  const { t, owner, request } = await fixture();
  const voucherId = await t.run(async ctx => {
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const settings = resolveCommerceSettings(null);
    const { revision } = settings;
    const terms = termsOf(settings);
    const line = await ctx.db.query('orderLines').first();
    if (!line) throw new Error('Missing fixture row');
    return await ctx.db.insert('vouchers', {
      branchId, revision, settingsRevision: revision, terms, faceValue: 20000, paidBalance: 20000, goodwillBalance: 10000,
      source: { kind: 'sale', orderId: request.orderId, lineId: line._id },
      status: 'active', issuedExpiresAt: Date.now() + 600000, effectiveExpiresAt: Date.now() + 600000,
    });
  });
  const attempt = await claim(owner, { ...request, vouchers: [{ voucherId, paid: 20000, goodwill: 10000 }],
    legs: [{ key: 'cash-1', method: 'cash', amount: 30000 }] });
  await expect(owner.mutation(arm, { ...attempt, load: request.load, legKey: 'cash-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...attempt, legKey: 'cash-1', outcome: 'taken', received: 40000 });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  const state = await t.run(async ctx => ({
    payments: await ctx.db.query('orderPayments').take(3),
    voucher: await ctx.db.get(voucherId),
    line: await ctx.db.query('orderLines').first(),
  }));
  expect(state.payments).toMatchObject([{ method: 'voucher', voucherId, amount: 20000 }, { method: 'cash', amount: 30000, received: 40000 }]);
  expect(state.voucher).toMatchObject({ paidBalance: 0, goodwillBalance: 0 });
  expect(state.line?.saleSnapshot).toMatchObject({ paidShare: 50000, vatBase: 50000, goodwillDiscounts: [{ voucherId, amount: 10000 }] });
}, 30000);

it.each(['freeze', 'switch-off'] as const)('checks the armed Gold Wellness receipt (%s)', async scenario => {
  const { t, owner, request, settingsId } = await fixture();
  const { customerId, variantId, lineId } = await t.run(async ctx => {
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const customerId = await ctx.db.insert('customers', { name: 'Guest', createdBy: 'owner@example.com', createdAt: Date.now(), updatedAt: Date.now() });
    const serviceId = await ctx.db.insert('services', {
      slug: 'massage', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
      price: 120000, currency: 'THB', staffIds: [], status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
    });
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 0 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [],
      minPrice: 129000, maxPrice: 129000, variantCount: 1, sort: 0, revision: 0,
    });
    const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: 'Gold robe', price: 129000, status: 'active', revision: 0 });
    await ctx.db.insert('stockLevels', { productId, branchId, variantId, onHand: 1, revision: 0 });
    const packageId = await ctx.db.insert('packages', { name: 'Gold Wellness', status: 'active', sort: 0, revision: 0 });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Gold Wellness', price: 690000, validityDays: 180, allowTransfer: true,
      contents: [
        { kind: 'session', contentKey: 'massage', serviceIds: [serviceId], units: 5 },
        { kind: 'product', contentKey: 'robe', variantId, units: 1 },
        { kind: 'voucher', contentKey: 'gift', faceValue: 50000 },
      ], estimatedSplit: [],
    });
    await ctx.db.patch(packageId, { currentVersionId: packageVersionId });
    await ctx.db.patch(request.orderId, { customerId, total: 690000, due: 690000 });
    const line = await ctx.db.query('orderLines').first();
    if (!line) throw new Error('Missing fixture row');
    await ctx.db.patch(line._id, { kind: 'package', name: 'Gold Wellness', unitPrice: 690000, catalogUnitPrice: 690000, packageVersionId });
    return { customerId, variantId, lineId: line._id };
  });
  const gold = { ...request, customers: [{ customerId, revision: 0 }], expectedDue: 690000,
    legs: [{ key: 'card-1', method: 'card' as const, amount: 690000 }] };
  await expect(owner.mutation(start, gold)).resolves.toMatchObject({ status: 'refused', code: 'sale_disabled' });
  const settings = resolveCommerceSettings(null);
  await t.run(ctx => ctx.db.patch(settingsId, { saleSwitches: { ...settings.saleSwitches, mixedPackages: 'everyone' } }));
  const attempt = await claim(owner, gold);
  const stock = (await t.run(ctx => ctx.db.query('stockLevels').first()))!;
  await t.run(ctx => ctx.db.patch(stock._id, { onHand: 0 }));
  const arming = { ...attempt, load: request.load, legKey: 'card-1' };
  await expect(owner.mutation(arm, arming)).resolves.toMatchObject({
    status: 'confirm_stock', shortages: [{ variantId, quantity: 1, onHand: 0 }],
  });
  expect(await t.run(ctx => ctx.db.get(attempt.attemptId))).toMatchObject({ legs: [{ state: 'planned' }] });
  await t.run(ctx => ctx.db.patch(stock._id, { onHand: 1 }));
  await expect(owner.mutation(arm, arming)).resolves.toMatchObject({ status: 'instruct' });
  await t.run(async ctx => {
    await ctx.db.patch(settingsId, { revision: 1, packageVatTiming: 'atUse',
      ...(scenario === 'switch-off' ? { saleSwitches: settings.saleSwitches } : {}) });
    await ctx.db.patch(variantId, { price: 150000, revision: 1 });
  });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  if (scenario === 'switch-off') {
    await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'refused', code: 'sale_disabled' });
    expect(await t.run(ctx => ctx.db.get(attempt.attemptId))).toMatchObject({ status: 'refused' });
    expect(await t.run(ctx => ctx.db.query('orderPayments').first())).toBeNull();
    expect(await t.run(ctx => ctx.db.query('stockMovements').first())).toBeNull();
    return;
  }
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  const snapshot = (await t.run(ctx => ctx.db.get(lineId)))?.saleSnapshot;
  expect(snapshot?.settingsRevision).toBe(0);
  expect(snapshot?.chosenVariants).toEqual([{ contentKey: 'robe', variantId }]);
  expect(snapshot?.contents.map(({ paidShare, vatBase }) => [paidShare, vatBase])).toEqual([[526749, 526749], [113251, 113251], [50000, 0]]);
  expect(receiptVat({ vatVersion: 2, lines: [snapshot!] })).toEqual({ vatBase: 640000, vat: 41869 });
  expect(await t.run(ctx => ctx.db.query('stockMovements').take(2))).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('sessionGrants').take(2))).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('voucherEntries').take(2))).toHaveLength(1);
}, 30000);

const resume = api.pos.commands.resumePaymentAttempt.resumePaymentAttempt;
const changePlan = api.pos.commands.changePaymentPlan.changePaymentPlan;
const { previewPaymentRecovery, startPaymentRecovery, armPaymentGiveBack } = api.pos.commands.recoverPaymentAttempt;
const { takeOverPaymentAttempt } = api.pos.commands.handoverPaymentAttempt;

it('resumes the same till, locks an unknown leg and invalidates the old panel on takeover', async () => {
  const { t, owner, request, deskB } = await fixture();
  const attempt = await claim(owner, request);
  await owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'unknown' });
  await expect(owner.query(resume, { orderId: request.orderId, tillId: request.tillId, tabKey: request.tabKey })).resolves.toMatchObject({
    status: 'resume', checkPrevious: { kind: 'collection', leg: { state: 'unknown', amount: 60000 } },
  });
  await expect(owner.query(resume, { orderId: request.orderId, tillId: deskB })).resolves.toMatchObject({ status: 'in_progress_elsewhere' });
  await expect(owner.mutation(api.pos.commands.cancelPaymentAttempt.cancelPaymentAttempt, attempt)).resolves.toMatchObject({
    status: 'refused', code: 'check_previous',
  });
  const handover = await owner.mutation(takeOverPaymentAttempt, {
    orderId: request.orderId, ...at(deskB, DEVICE_B), expectedOwnerRevision: 0, stoppedPreviousOperator: true,
  });
  expect(handover).toMatchObject({ status: 'taken_over', attempt: { ownerRevision: 1 } });
  await expect(owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' })).resolves.toMatchObject({
    status: 'refused', code: 'payment_handed_over',
  });
  const newOwner = { ...attempt, tillId: deskB, ownerRevision: 1 };
  await expect(owner.mutation(arm, { ...newOwner, load: at(deskB, DEVICE_B).load, legKey: 'card-1' })).resolves.toMatchObject({ status: 'check_previous' });
  await owner.mutation(record, { ...newOwner, legKey: 'card-1', outcome: 'taken', reference: 'paid' });
  await expect(owner.mutation(settle, newOwner)).resolves.toMatchObject({ status: 'settled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(2))).toHaveLength(1);
}, 30000);

it('changes the untouched part of a split after reload and settles both methods once', async () => {
  const { t, owner, request } = await fixture();
  const attempt = await claim(owner, { ...request, legs: [
    { key: 'card-1', method: 'card', amount: 30000 }, { key: 'transfer-1', method: 'transfer', amount: 30000 },
  ] });
  await owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await expect(owner.mutation(changePlan, { ...attempt, legs: [{ key: 'qr-1', method: 'promptpay', amount: 30000 }] })).resolves.toMatchObject({
    status: 'refused', code: 'check_previous',
  });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await expect(owner.query(resume, { orderId: request.orderId, tillId: request.tillId, tabKey: request.tabKey })).resolves.toMatchObject({
    status: 'resume', checkPrevious: null, attempt: { legs: [{ state: 'taken' }, { state: 'planned' }] },
  });
  await expect(owner.mutation(changePlan, { ...attempt, legs: [{ key: 'qr-1', method: 'promptpay', amount: 30000 }] })).resolves.toMatchObject({
    status: 'updated', attempt: { legs: [{ state: 'taken' }, { state: 'planned', method: 'promptpay' }] },
  });
  await expect(owner.mutation(arm, { ...attempt, load: request.load, legKey: 'qr-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...attempt, legKey: 'qr-1', outcome: 'taken' });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(3))).toMatchObject([
    { method: 'card', amount: 30000 }, { method: 'promptpay', amount: 30000 },
  ]);
}, 30000);

it('reconciles a partial give-back before a child settles the net kept', async () => {
  const { t, owner, request } = await fixture();
  const attempt = await claim(owner, request);
  await owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await owner.mutation(api.pos.commands.recoverPaymentAttempt.beginPaymentSwap, { ...attempt, expectedRevision: request.expectedRevision });
  const expectedRevision = await t.run(async ctx => {
    const row = (await ctx.db.query('orderLines').first())!;
    await ctx.db.patch(row._id, { unitPrice: 50000 });
    const order = (await ctx.db.get(request.orderId))!;
    await ctx.db.patch(order._id, { revision: order.revision + 1, due: 50000, total: 50000 });
    return order.revision + 1;
  });
  const review = { ...attempt, expectedRevision, customers: [], vouchers: [] };
  await expect(owner.mutation(previewPaymentRecovery, review)).resolves.toMatchObject({ status: 'recovery', next: 'give_back', balance: -10000 });
  const payout = { ...review, leg: { key: 'back-1', method: 'card' as const, amount: 10000 } };
  await expect(owner.mutation(armPaymentGiveBack, { ...payout, load: request.load })).resolves.toMatchObject({ status: 'instruct' });
  await expect(owner.mutation(armPaymentGiveBack, { ...payout, load: request.load })).resolves.toMatchObject({ status: 'check_previous' });
  await expect(owner.query(resume, { orderId: request.orderId, tillId: request.tillId, tabKey: request.tabKey }))
    .resolves.toMatchObject({ status: 'resume', checkPrevious: { kind: 'give_back', leg: { amount: 10000, state: 'instructed', instructedAt: expect.any(Number) } } });
  await expect(owner.mutation(previewPaymentRecovery, review)).resolves.toMatchObject({ status: 'refused', code: 'check_previous' });
  await owner.mutation(record, { ...attempt, kind: 'give_back', legKey: 'back-1', outcome: 'taken' });
  const recovery = await owner.mutation(startPaymentRecovery, { ...review, clientKey: 'child-attempt', legs: [] });
  if (recovery.status !== 'ready') throw new Error(JSON.stringify(recovery));
  await expect(owner.mutation(settle, { ...attempt, attemptId: recovery.attempt.attemptId })).resolves.toMatchObject({ status: 'settled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(2))).toMatchObject([{ method: 'card', amount: 50000 }]);
}, 30000);

async function stayFixture(mode: 'direct' | 'attempts' = 'attempts') {
  const setup = await fixture(mode);
  const { t, owner, request } = setup;
  const { bookingId, serviceId, staffId } = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', {
      slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 30000, currency: 'THB', maxGuests: 4,
      bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, guestName: 'Guest', guestPhone: '0812345678', guestPhoneDigits: '0812345678', checkIn: '2026-11-01', checkOut: '2026-11-03',
      guests: 2, nights: 2, subtotal: 60000, discountAmount: 0, total: 60000, amountPaid: 0, amountRefunded: 0,
      currency: 'THB', paymentStatus: 'pending', confirmationCode: 'STAY', accessToken: 'test-only', status: 'confirmed', createdAt: Date.now(),
    });
    const staffId = await ctx.db.insert('staff', {
      name: 'Nok', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert('services', {
      slug: 'massage', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
      price: 120000, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
    });
    return { bookingId, serviceId, staffId };
  });
  await owner.mutation(api.pos.commands.attach.attach, { orderId: request.orderId, bookingId });
  const room = (await t.run(ctx => ctx.db.get(request.orderId)))!;
  const addVisit = () => t.run(ctx => ctx.db.insert('appointments', {
    serviceId, staffId, bookingId, guestName: 'Guest', guestPhone: '', guestPhoneDigits: '', status: 'booked', paymentStatus: 'unpaid',
    serviceNameSnapshot: 'Massage', staffNameSnapshot: 'Nok', start: Date.now(), end: Date.now() + 3600000, blockedUntil: Date.now() + 3600000,
    source: 'admin', price: 120000, currency: 'THB', confirmationCode: 'SPA', accessToken: 'test-only',
    createdAt: Date.now(), amountPaid: 0, amountRefunded: 0,
  }));
  return { ...setup, room, bookingId, addVisit };
}

it('retries Pay the room first with one key and collects the posted ฿350 tote after standard cutover', async () => {
  const { t, owner, room, request, bookingId, addVisit } = await stayFixture('direct');
  const { handoverId, bookingLineId } = await t.run(async ctx => {
    const branch = await ctx.db.query('branches').withIndex('by_key', q => q.eq('key', 'default')).unique();
    expect(branch).not.toBeNull();
    const branchId = branch!._id;
    const booking = (await ctx.db.get(bookingId))!;
    const checkIn = '2026-11-01';
    await ctx.db.patch(bookingId, { checkIn, checkOut: '2027-11-01', nights: 365, subtotal: 3650000, total: 3650000 });
    for (let index = 0; index < 365; index++) {
      const date = new Date(Date.parse(checkIn) + index * 86400000).toISOString().slice(0, 10);
      for (let row = 0; row < 5; row++) {
        await ctx.db.insert('availability', { date, propertyId: booking.propertyId, source: 'manual', status: 'available' });
      }
    }
    const bookingLineId = (await ctx.db.query('orderLines').withIndex('by_bookingId', q => q.eq('bookingId', bookingId)).first())!._id;
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 0 });
    const productId = await ctx.db.insert('products', { categoryId, name: 'Tote', status: 'active', vatProfile: 'standard',
      options: [], minPrice: 35000, maxPrice: 35000, variantCount: 1, sort: 0, revision: 0 });
    const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: 'Tote', price: 35000, status: 'active', revision: 0 });
    const stockMovementId = await ctx.db.insert('stockMovements', { branchId, variantId, before: 1, after: 0, delta: -1,
      kind: 'room_bill', sourceKey: 'room-post', actor: 'owner@example.com', createdAt: Date.now() });
    const line = (await ctx.db.query('orderLines').withIndex('by_orderId_and_kind', q => q.eq('orderId', room._id).eq('kind', 'extra')).first())!;
    await ctx.db.patch(line._id, { kind: 'product', name: 'Tote', variantId, unitPrice: 35000, catalogUnitPrice: 35000 });
    const handoverId = await ctx.db.insert('handovers', {
      kind: 'room_bill', bookingId, orderId: room._id, lineId: line._id, variantId, originalMovementId: stockMovementId,
      unitPrice: 35000, quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 1, paid: 0,
      status: 'open', movementIds: [stockMovementId], clientKey: 'room-post', revision: 0,
    });
    return { handoverId, bookingLineId };
  });
  await owner.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId: bookingLineId });
  const mixed = (await t.run(ctx => ctx.db.get(room._id)))!;
  await expect(owner.mutation(start, { ...request, expectedRevision: mixed.revision, expectedDue: mixed.due,
    legs: [{ key: 'card-1', method: 'card', amount: mixed.due }] })).resolves.toMatchObject({ status: 'refused', code: 'pay_room_first' });
  const split = api.pos.commands.splitStayPayment.splitStayPayment;
  const input = { orderId: room._id, expectedRevision: mixed.revision, clientKey: 'split-room' };
  const routed = await owner.mutation(split, input);
  if (routed.status !== 'split') throw new Error(JSON.stringify(routed));
  await expect(owner.mutation(split, input)).resolves.toMatchObject({ status: 'split', shopOrderId: routed.shopOrderId, replayed: true });
  const open = api.pos.commands.openStayCheckout.openStayCheckout;
  const beforeRoom = (await t.run(ctx => ctx.db.get(room._id)))!;
  expect(beforeRoom.due).toBe(3650000);
  await expect(owner.mutation(open, { bookingId })).resolves.toMatchObject({ orderId: room._id, shopOrderId: routed.shopOrderId });
  const attempt = await claim(owner, { ...request, expectedRevision: beforeRoom.revision, expectedDue: beforeRoom.due,
    legs: [{ key: 'card-1', method: 'card', amount: beforeRoom.due }] });
  await expect(owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  await expect(owner.mutation(open, { bookingId })).resolves.toMatchObject({ orderId: routed.shopOrderId, roomOrderId: room._id });
  expect((await t.run(ctx => ctx.db.get(bookingId)))?.paymentStatus).toBe('paid');
  const shop = (await t.run(ctx => ctx.db.get(routed.shopOrderId)))!;
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const shopAttempt = await claim(owner, { ...request, orderId: shop._id, expectedRevision: shop.revision, expectedDue: 35000,
    clientKey: 'shop-attempt', legs: [{ key: 'card-1', method: 'card', amount: 35000 }] });
  await expect(owner.mutation(arm, { ...shopAttempt, load: request.load, legKey: 'card-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...shopAttempt, legKey: 'card-1', outcome: 'taken' });
  await expect(owner.mutation(settle, shopAttempt)).resolves.toMatchObject({ status: 'settled' });
  await expect(owner.mutation(settle, shopAttempt)).resolves.toMatchObject({ status: 'settled', replayed: true });
  expect(ranges.mock.calls.length).toBeLessThan(100);
  expect(await t.run(ctx => ctx.db.get(handoverId))).toMatchObject({ orderId: shop._id, unpaid: 0, paid: 1, withGuest: 1 });
  expect(await t.run(ctx => ctx.db.query('stockMovements').take(3))).toMatchObject([{ kind: 'room_bill' }]);
  const later = await addVisit();
  const next = await owner.mutation(open, { bookingId });
  expect(next).toMatchObject({ roomOrderId: room._id, added: [later] });
  expect(next.orderId).not.toBe(shop._id);
  expect(await t.run(ctx => ctx.db.get(next.orderId))).toMatchObject({ parentOrderId: room._id, status: 'draft', due: 120000 });
}, 30000);

it('joins the split back when both draft revisions still match', async () => {
  const { t, owner, room } = await stayFixture();
  const split = api.pos.commands.splitStayPayment.splitStayPayment;
  const routed = await owner.mutation(split, { orderId: room._id, expectedRevision: room.revision, clientKey: 'split-room' });
  if (routed.status !== 'split') throw new Error(JSON.stringify(routed));
  const orders = await t.run(async ctx => ({ room: await ctx.db.get(room._id), shop: await ctx.db.get(routed.shopOrderId) }));
  const input = { orderId: room._id, expectedRevision: orders.room!.revision, clientKey: 'join-room',
    join: { shopOrderId: routed.shopOrderId, expectedRevision: orders.shop!.revision } };
  await expect(owner.mutation(split, input)).resolves.toMatchObject({ status: 'joined', replayed: false });
  await expect(owner.mutation(split, input)).resolves.toMatchObject({ status: 'joined', replayed: true });
  expect(await t.run(ctx => ctx.db.get(room._id))).toMatchObject({ due: 120000, itemCount: 2 });
  expect(await t.run(ctx => ctx.db.get(routed.shopOrderId))).toMatchObject({ status: 'discarded' });
}, 30000);

for (const scenario of ['stock', 'recollections', 'fee history'] as const) it(`meets the 100-row ceilings with ${scenario}`, async ({ annotate }) => {
  const withFees = scenario === 'fee history';
  const feeLinesInCart = withFees ? 5 : 0;
  const recollections = scenario === 'stock' ? 0 : withFees ? 55 : 60;
  const { t, owner, request, settingsId } = await fixture();
  const measured = await t.run(async ctx => {
    const now = Date.now();
    const settings = resolveCommerceSettings(null);
    const terms = termsOf(settings);
    await ctx.db.patch(settingsId, { saleSwitches: { ...settings.saleSwitches, products: 'everyone', mixedPackages: 'everyone' } });
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const customerId = await ctx.db.insert('customers', { name: 'Payer', createdBy: 'owner@example.com', createdAt: now, updatedAt: now });
    const customers = [{ customerId, revision: 0 }];
    const categoryId = await ctx.db.insert('productCategories', { name: 'Shop', sort: 0 });
    const orderId = request.orderId;
    const original = (await ctx.db.query('orderLines').first())!;
    await ctx.db.delete(original._id);
    const common = { orderId, currency: 'THB', qty: 1, createdAt: now };
    const feeLines: Id<'orderLines'>[] = [];
    const variantIds: Id<'productVariants'>[] = [];
    for (let index = 0; index < 60; index++) {
      const productId = await ctx.db.insert('products', { categoryId, name: `Goods ${index}`, status: 'active', vatProfile: 'standard',
        options: [], minPrice: 1000, maxPrice: 1000, variantCount: 1, sort: 0, revision: 0 });
      const label = `Variant ${index}`;
      const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label, price: 1000, status: 'active', revision: 0 });
      variantIds.push(variantId);
      await ctx.db.insert('stockLevels', { productId, branchId, variantId, onHand: 100, revision: 0 });
      const lineId = await ctx.db.insert('orderLines', { ...common, kind: 'product', variantId, name: label, unitPrice: 1000, catalogUnitPrice: 1000 });
      if (index < recollections) {
        const sourceKey = `held-${lineId}`;
        const originalMovementId = await ctx.db.insert('stockMovements', {
          branchId, variantId, before: 101, after: 100, delta: -1, kind: 'room_bill', sourceKey, actor: 'owner@example.com', createdAt: now,
        });
        await ctx.db.insert('handovers', { kind: 'recollect', successorOrderId: orderId, orderId, lineId, variantId, originalMovementId,
          unitPrice: 1000, quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 1, paid: 0,
          status: 'open', movementIds: [originalMovementId], clientKey: sourceKey, revision: 0 });
      } else if (withFees) feeLines.push(lineId);
    }
    const staffId = await ctx.db.insert('staff', { name: 'Nok', role: 'Therapist', color: '#abc', workingHours: [], breaks: [],
      status: 'active', createdAt: now, updatedAt: now });
    const allServices: Id<'services'>[] = [];
    for (let index = 0; index < 29; index++) {
      allServices.push(await ctx.db.insert('services', { slug: `massage-${index}`, name: `Massage ${index}`, description: '', category: 'Spa',
        durationMin: 60, bufferMin: 0, price: 1000, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: now, updatedAt: now }));
    }
    for (let index = 0; index < 20; index++) {
      const serviceIds = [allServices[index], ...allServices.slice(20)];
      const packageId = await ctx.db.insert('packages', { name: `Wellness ${index}`, status: 'active', sort: 0, revision: 0 });
      const packageVersionId = await ctx.db.insert('packageVersions', {
        packageId, version: 1, name: `Wellness ${index}`, price: 10000, validityDays: 180, allowTransfer: true, estimatedSplit: [],
        contents: [
          { kind: 'session', contentKey: 'sessions', serviceIds, units: 1 },
          { kind: 'voucher', contentKey: 'gift', faceValue: 1000 },
          ...Array.from({ length: 8 }, (_, part) => ({ kind: 'product' as const, contentKey: `part-${part}`,
            variantId: variantIds[(index * 3 + part) % variantIds.length], units: 1 })),
        ],
      });
      await ctx.db.patch(packageId, { currentVersionId: packageVersionId });
      const lineId = await ctx.db.insert('orderLines', { ...common, kind: 'package', name: 'Wellness', packageVersionId, unitPrice: 10000, catalogUnitPrice: 10000 });
      const attendeeId = await ctx.db.insert('customers', { name: `Attendee ${index}`, createdBy: 'owner@example.com', createdAt: now, updatedAt: now });
      customers.push({ customerId: attendeeId, revision: 0 });
      const expiry = now + 600000;
      const grantId = await ctx.db.insert('sessionGrants', {
        branchId, ownerId: attendeeId, orderId, lineId, contentKey: 'sessions', packageVersionId,
        total: 1, used: 0, paidUnits: 1, goodwillUnits: 0, returnedUnits: 0, paidShare: 1000, expiresAt: expiry,
        issuedTerms: { expiresAt: expiry, serviceIds, allowTransfer: true }, terms, settingsRevision: 0, revision: 0, grantServiceIds: [],
      });
      const grantServiceIds = [];
      for (const serviceId of serviceIds) {
        grantServiceIds.push(await ctx.db.insert('grantServices', { grantId, ownerId: attendeeId, serviceId, branchId, usable: true, expiresAt: expiry }));
      }
      await ctx.db.patch(grantId, { grantServiceIds });
      const appointmentId = await ctx.db.insert('appointments', { attendeeId, serviceId: serviceIds[0], staffId, guestName: `Attendee ${index}`,
        guestPhone: '', guestPhoneDigits: '', status: 'booked', paymentStatus: 'unpaid', serviceNameSnapshot: 'Massage', staffNameSnapshot: 'Nok',
        start: now, end: now + 3600000, blockedUntil: now + 3600000, source: 'admin', price: 1000, currency: 'THB',
        confirmationCode: `SPA${index}`, accessToken: 'test-only', createdAt: now, amountPaid: 0, amountRefunded: 0 });
      await ctx.db.insert('orderLines', { ...common, kind: 'appointment', appointmentId, serviceId: serviceIds[0], staffId, startAt: now, name: 'Massage',
        unitPrice: 1000, catalogUnitPrice: 1000, discount: { type: 'amount', value: 1000 }, coverage: { attendeeId, grantId, priceBefore: 1000 } });
    }
    if (feeLines.length) {
      for (const [index, lineId] of feeLines.entries()) {
        const appointmentId = await ctx.db.insert('appointments', { serviceId: allServices[index], staffId, guestName: 'Guest',
          guestPhone: '', guestPhoneDigits: '', status: 'no_show', paymentStatus: 'unpaid', serviceNameSnapshot: 'Massage',
          staffNameSnapshot: 'Nok', start: now, end: now + 3600000, blockedUntil: now + 3600000, source: 'admin',
          price: 1000, currency: 'THB', confirmationCode: `FEE${index}`, accessToken: 'test-only', createdAt: now, amountPaid: 0, amountRefunded: 0 });
        const fee = { kind: 'no_show' as const, by: 'owner@example.com', at: now };
        await ctx.db.patch(lineId, { kind: 'extra', variantId: undefined, feeAppointmentId: appointmentId, fee });
        for (let prior = 0; prior < 45; prior++) {
          const priorOrder = await ctx.db.insert('orders', { status: 'discarded', orderNumber: 10 + index * 45 + prior,
            currency: 'THB', itemCount: 1, hasItems: false, total: 1000, due: 1000, revision: 0,
            createdBy: 'owner@example.com', createdAt: now, updatedAt: now });
          await ctx.db.insert('orderLines', { ...common, orderId: priorOrder, kind: 'extra', name: 'Prior fee',
            unitPrice: 1000, catalogUnitPrice: 1000, feeAppointmentId: appointmentId, fee });
        }
      }
    }
    const due = 260000;
    await ctx.db.patch(orderId, { customerId, itemCount: 100, total: due, due });
    return { customers, due };
  });

  // Load the Convex module before timing an invocation.
  await owner.mutation(start, { ...request, expectedRevision: -1 });
  const documents = vi.spyOn(ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const writeCount = vi.spyOn(readBudgetModule, 'reserveWrites');
  const startAt = performance.now();
  const attempt = await claim(owner, { ...request, customers: measured.customers, expectedDue: measured.due,
    legs: [{ key: 'card-1', method: 'card', amount: measured.due }] });
  const startMs = performance.now() - startAt;
  const startReads = documents.mock.calls.length;
  // Order, 100 rows and today's source visit lookups. Fee history is an existing check.
  const feeHistoryReads = withFees ? 5 * (1 + 45 + 45) : 0;
  const newReads = startReads - 121 - feeLinesInCart - feeHistoryReads;
  const startRanges = ranges.mock.calls.length;
  const startWrites = writeCount.mock.calls.reduce((total, [, count]) => total + count, 0);
  await expect(owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  documents.mockClear();
  ranges.mockClear();
  writeCount.mockClear();
  const settleAt = performance.now();
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  const settleMs = performance.now() - settleAt;
  const settleReads = documents.mock.calls.length;
  const extraWrites = writeCount.mock.calls.reduce((total, [, count]) => total + count, 0);
  await annotate(JSON.stringify({
    startReads, newReads, startRanges, startWrites, startMs: Math.round(startMs), settleReads, settleRanges: ranges.mock.calls.length, extraWrites, settleMs: Math.round(settleMs),
  }), 'checkout measurement');
  expect(newReads).toBeLessThanOrEqual(263);
  expect(startWrites).toBe(2);
  expect(settleReads).toBeLessThanOrEqual(4000);
  expect(extraWrites).toBeGreaterThan(700);
  expect(extraWrites).toBeLessThanOrEqual(925);
  expect(startMs).toBeLessThanOrEqual(600);
  expect(settleMs).toBeLessThanOrEqual(1500);
  const state = await t.run(async ctx => ({
    movements: await ctx.db.query('stockMovements').take(121),
    handovers: await ctx.db.query('handovers').take(61),
  }));
  expect(state.movements).toHaveLength(60 + recollections);
  expect(state.handovers).toHaveLength(recollections);
  for (const handover of state.handovers) expect(handover).toMatchObject({ paid: 1, unpaid: 0, withGuest: 1 });
  expect(await t.run(ctx => ctx.db.query('sessionUses').take(100))).toHaveLength(40);
}, 30000);

it('gives only the owning tab an instruction and blocks the same cashier on another tab or device until handover', async () => {
  const { t, request, deskA, deskB } = await fixture();
  await t.run(ctx => ctx.db.insert('staffGrants', {
    role: 'cashier', email: 'cashier@example.com', tokenIdentifier: 'cashier', createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
  }));
  const identity = { email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier', name: 'Ploy Desk' };
  const cashier = t.withIdentity(identity);
  const otherBrowser = t.withIdentity({ ...identity, sid: 'separate-session' });
  const attempt = await claim(cashier, request);
  const arms = await Promise.all([
    cashier.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' }),
    cashier.mutation(arm, { ...attempt, load: request.load, tabKey: TAB_B, legKey: 'card-1' }),
    cashier.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' }),
  ]);
  expect(arms.map(result => result.status).sort()).toEqual(['check_previous', 'instruct', 'refused']);
  expect(arms[1]).toMatchObject({ status: 'refused', code: 'in_progress_elsewhere' });
  const instruction = arms.find(result => result.status === 'instruct');
  expect(instruction?.leg).toMatchObject({ instructedTillId: deskA, instructedTab: expect.any(String) });
  const elsewhere = { status: 'in_progress_elsewhere', ownerDisplayName: 'Ploy Desk', tillLabel: expect.stringMatching(/^Till /), tillId: deskA };
  await expect(cashier.mutation(start, { ...request, tabKey: TAB_B })).resolves.toMatchObject(elsewhere);
  await expect(cashier.query(resume, { orderId: request.orderId, tillId: deskA, tabKey: TAB_B })).resolves.toMatchObject(elsewhere);
  await expect(otherBrowser.query(resume, { orderId: request.orderId, tillId: deskB, tabKey: TAB_B })).resolves.toMatchObject(elsewhere);
  const received = { ...attempt, legKey: 'card-1', outcome: 'taken' as const };
  await expect(cashier.mutation(record, { ...received, tabKey: TAB_B })).resolves.toMatchObject({ status: 'refused', code: 'in_progress_elsewhere' });
  await expect(otherBrowser.mutation(record, { ...received, tillId: deskB, tabKey: TAB_B })).resolves.toMatchObject({ status: 'refused', code: 'in_progress_elsewhere' });
  const destination = { ...at(deskB, DEVICE_B, 0, TAB_B), orderId: request.orderId };
  await expect(otherBrowser.mutation(takeOverPaymentAttempt, { ...destination, expectedOwnerRevision: 0, stoppedPreviousOperator: true }))
    .resolves.toMatchObject({ status: 'refused', code: 'takeover_refused' });
  await expect(cashier.mutation(api.pos.commands.handoverPaymentAttempt.releasePaymentAttempt, { ...attempt, nextTillId: deskB }))
    .resolves.toMatchObject({ status: 'released', ownerRevision: 1 });
  await expect(otherBrowser.mutation(takeOverPaymentAttempt, { ...destination, expectedOwnerRevision: 1 }))
    .resolves.toMatchObject({ status: 'taken_over', attempt: { ownerRevision: 2, tillId: deskB } });
  const transferred = { ...received, tillId: deskB, tabKey: TAB_B, ownerRevision: 2 };
  await expect(otherBrowser.mutation(arm, {
    attemptId: attempt.attemptId, ownerRevision: 2, tillId: deskB, tabKey: TAB_B, load: destination.load, legKey: 'card-1',
  })).resolves.toMatchObject({ status: 'check_previous', leg: instruction?.leg });
  await expect(cashier.mutation(record, received)).resolves.toMatchObject({ status: 'refused', code: 'payment_handed_over' });
  await expect(otherBrowser.mutation(record, transferred)).resolves.toMatchObject({ status: 'recorded' });
  await expect(otherBrowser.mutation(settle, { attemptId: attempt.attemptId, ownerRevision: 2, tillId: deskB, tabKey: TAB_B }))
    .resolves.toMatchObject({ status: 'settled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(2))).toHaveLength(1);
}, 30000);

it('requires the acting device load before manager takeover, its replay, or arming', async () => {
  const { t, owner, request, deskB } = await fixture();
  const attempt = await claim(owner, request);
  const take = { ...at(deskB, DEVICE_B), orderId: request.orderId, expectedOwnerRevision: 0, stoppedPreviousOperator: true };
  const refused = { status: 'refused', code: 'TILL_NEEDS_RELOAD' };
  await expect(owner.mutation(arm, { ...attempt, legKey: 'card-1' })).resolves.toMatchObject(refused);
  await expect(owner.mutation(arm, { ...attempt, load: at(deskB, DEVICE_B).load, legKey: 'card-1' })).resolves.toMatchObject(refused);
  await expect(owner.mutation(takeOverPaymentAttempt, { ...take, load: undefined })).resolves.toMatchObject(refused);
  await expect(owner.mutation(takeOverPaymentAttempt, { ...take, load: { ...take.load, deviceKey: DEVICE_A } })).resolves.toMatchObject(refused);
  await t.run(ctx => ctx.db.patch(deskB, { paymentRollout: undefined }));
  await expect(owner.mutation(takeOverPaymentAttempt, take)).resolves.toMatchObject(refused);
  await owner.mutation(rollout.acknowledge, { deviceKey: DEVICE_B, loadedMode: 'attempts', loadedRevision: 0 });
  await expect(owner.mutation(takeOverPaymentAttempt, take)).resolves.toMatchObject({ status: 'taken_over', replayed: false });
  await expect(owner.mutation(takeOverPaymentAttempt, { ...take, load: { ...take.load, loadedRevision: 1 } })).resolves.toMatchObject(refused);
  await expect(owner.mutation(takeOverPaymentAttempt, take)).resolves.toMatchObject({ status: 'taken_over', replayed: true });
  const next = { ...attempt, tillId: deskB, ownerRevision: 1, load: take.load, legKey: 'card-1' };
  await expect(owner.mutation(arm, { ...next, load: { ...next.load, loadedMode: 'direct' } })).resolves.toMatchObject(refused);
  await expect(owner.mutation(arm, next)).resolves.toMatchObject({ status: 'instruct' });
}, 30000);

it('keeps held-money booking sources attached and recovery reachable through discard, clear and void', async () => {
  const { t, owner, request, room, bookingId } = await stayFixture();
  const attempt = await claim(owner, { ...request, expectedRevision: room.revision, expectedDue: room.due,
    legs: [{ key: 'card-1', method: 'card', amount: room.due }] });
  const commands = api.pos.commands;
  const discard = { orderId: room._id, expectedRevision: room.revision, idempotencyKey: 'discard-held-please' };
  const line = (await t.run(ctx => ctx.db.query('orderLines').withIndex('by_bookingId', q => q.eq('bookingId', bookingId)).first()))!;
  const refused = { data: expect.objectContaining({ code: 'payment_in_progress' }) };
  await owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await expect(owner.mutation(commands.discardOrder.discardOrder, discard)).rejects.toMatchObject(refused);
  await expect(owner.mutation(commands.clearOrder.clearOrder, { orderId: room._id })).rejects.toMatchObject(refused);
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await expect(owner.mutation(commands.discardOrder.discardOrder, discard)).rejects.toMatchObject(refused);
  await expect(owner.mutation(commands.voidOrder.voidOrder, { orderId: room._id, reason: 'Desk check' })).rejects.toMatchObject(refused);
  await owner.mutation(api.pos.commands.recoverPaymentAttempt.beginPaymentSwap, { ...attempt, expectedRevision: room.revision });
  await expect(owner.mutation(commands.clearOrder.clearOrder, { orderId: room._id })).rejects.toMatchObject(refused);
  await expect(owner.mutation(commands.removeLine.removeLine, { lineId: line._id })).rejects.toMatchObject(refused);
  expect(await t.run(ctx => ctx.db.get(room._id))).toMatchObject({ status: 'draft', activeAttemptId: attempt.attemptId, bookingId });
  expect(await t.run(ctx => ctx.db.get(line._id))).toMatchObject({ orderId: room._id, bookingId });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'refused', code: 'swap_requested' });
  const finished = await owner.mutation(startPaymentRecovery, { ...attempt, expectedRevision: room.revision,
    clientKey: 'finish-held-attempt', customers: [], vouchers: [], legs: [] });
  if (finished.status !== 'ready') throw new Error(JSON.stringify(finished));
  await expect(owner.mutation(settle, { ...attempt, attemptId: finished.attempt.attemptId })).resolves.toMatchObject({ status: 'settled' });
}, 30000);

it('derives cancel-sale give-back from verified money even after removing the last swap row', async () => {
  const { t, owner, request } = await fixture();
  const attempt = await claim(owner, request);
  await owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await expect(owner.mutation(api.pos.commands.recoverPaymentAttempt.beginPaymentSwap, { ...attempt, expectedRevision: request.expectedRevision }))
    .resolves.toMatchObject({ status: 'swap' });
  const line = (await t.run(ctx => ctx.db.query('orderLines').first()))!;
  await owner.mutation(api.pos.commands.removeLine.removeLine, { lineId: line._id, swapOwner: { tillId: attempt.tillId, tabKey: attempt.tabKey } });
  const order = (await t.run(ctx => ctx.db.get(request.orderId)))!;
  expect(order.itemCount).toBe(0);
  const openOrders = { paginationOpts: { cursor: null, numItems: 10 } };
  expect((await owner.query(api.pos.orders.listOpenOrders, openOrders)).page).toEqual([expect.objectContaining({ _id: order._id })]);
  const review = { ...attempt, expectedRevision: order.revision, customers: [], vouchers: [] };
  await expect(owner.mutation(previewPaymentRecovery, review)).resolves.toMatchObject({ status: 'recovery', balance: -60000, next: 'give_back' });
  const payout = { ...review, load: request.load, cancelSale: true, leg: { key: 'refund-last-row', method: 'card' as const, amount: 60000 } };
  await expect(owner.mutation(armPaymentGiveBack, { ...payout, leg: { ...payout.leg, amount: 60001 } }))
    .resolves.toMatchObject({ status: 'refused', code: 'give_back_amount' });
  await expect(owner.mutation(armPaymentGiveBack, payout)).resolves.toMatchObject({ status: 'instruct' });
  await expect(owner.mutation(armPaymentGiveBack, payout)).resolves.toMatchObject({ status: 'check_previous' });
  await expect(owner.mutation(record, { ...attempt, kind: 'give_back', legKey: payout.leg.key, outcome: 'taken' }))
    .resolves.toMatchObject({ status: 'recorded', replayed: false });
  await expect(owner.mutation(api.pos.commands.cancelPaymentAttempt.cancelPaymentAttempt, attempt)).resolves.toMatchObject({ status: 'cancelled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').first())).toBeNull();
  expect((await t.run(ctx => ctx.db.get(order._id)))?.activeAttemptId).toBeUndefined();
  expect((await owner.query(api.pos.orders.listOpenOrders, openOrders)).page).toEqual([]);
}, 30000);

it('checks present cashier scope before replaying a receipt or leg and allows backdated open recovery', async () => {
  const { t, request } = await fixture();
  await t.run(ctx => ctx.db.insert('staffGrants', {
    role: 'cashier', email: 'cashier@example.com', tokenIdentifier: 'cashier', createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
  }));
  const cashier = t.withIdentity({ email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  const backdated = { ...request, businessDate: resortTodayIso(Date.now() - 86400000) };
  const attempt = await claim(cashier, backdated);
  await cashier.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  const evidence = { ...attempt, legKey: 'card-1', outcome: 'taken' as const };
  await expect(cashier.query(resume, { orderId: request.orderId, tillId: request.tillId, tabKey: request.tabKey }))
    .resolves.toMatchObject({ status: 'resume', checkPrevious: { kind: 'collection' } });
  await expect(cashier.mutation(record, evidence)).resolves.toMatchObject({ status: 'recorded' });
  await expect(cashier.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled', replayed: false });
  await expect(cashier.query(api.pos.orders.getOrder, { orderId: request.orderId })).resolves.toBeNull();
  const refused = { status: 'refused', code: 'order_unavailable' };
  await expect(cashier.mutation(settle, attempt)).resolves.toMatchObject(refused);
  await expect(cashier.mutation(record, evidence)).resolves.toMatchObject(refused);
  await expect(cashier.mutation(start, backdated)).resolves.toMatchObject(refused);
}, 30000);

it('keeps the direct refusal order for tenders, customer revision, effective date and changed source', async () => {
  const { t, owner, room, bookingId, settingsId } = await stayFixture();
  await t.run(async ctx => {
    await ctx.db.patch(settingsId, { paymentsMode: 'direct' });
    const customerId = await ctx.db.insert('customers', { name: 'Guest', revision: 1, createdAt: 1, updatedAt: 1, createdBy: 'owner@example.com' });
    await ctx.db.patch(room._id, { customerId });
    await ctx.db.patch(bookingId, { total: 90000, subtotal: 90000 });
  });
  const pay = api.pos.commands.settleOrder.settleOrder;
  const input = { orderId: room._id, expectedRevision: room.revision, expectedDue: room.due,
    expectedCustomerRevision: 0, idempotencyKey: 'direct-priority-check', effectiveAt: Date.now() + 86400000 };
  const tenders = [{ method: 'card' as const, amount: room.due }];
  await expect(owner.mutation(pay, { ...input, tenders: [] })).rejects.toMatchObject({ data: 'Choose how the guest pays' });
  await expect(owner.mutation(pay, { ...input, tenders })).rejects.toMatchObject({ data: 'The customer changed. Review the customer and pay again.' });
  await expect(owner.mutation(pay, { ...input, tenders, expectedCustomerRevision: 1 })).rejects.toMatchObject({ data: 'The effective date cannot be in the future' });
  await expect(owner.mutation(pay, { ...input, tenders, expectedCustomerRevision: 1, effectiveAt: undefined })).rejects.toMatchObject({
    data: 'Stay · Villa changed since it was added. Update the row and review the total.',
  });
  expect(await t.run(ctx => ctx.db.query('orderPayments').first())).toBeNull();
}, 30000);

it.each(['collect rest', 'give back and cancel', 'change method then give back'])('recovers a funded split after its next leg is refused: %s', async (recovery) => {
  const { t, owner, request } = await fixture();
  const serviceId = await t.run(ctx => ctx.db.insert('services', {
    slug: 'split-massage', name: 'Massage', description: '', category: 'Spa',
    durationMin: 60, bufferMin: 0, price: 120000, currency: 'THB', staffIds: [],
    status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const { orderId } = await owner.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
  const { couponId } = await owner.mutation(api.marketing.commands.saveCoupon.saveCoupon, {
    code: 'SPLIT200', benefit: { kind: 'fixed', amount: 20000 }, scope: 'services', terms: 'Split desk test',
  });
  const setCoupon = (status: 'active' | 'paused') => owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status });
  await setCoupon('active');
  const { revision } = await owner.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'SPLIT200' });
  const attempt = await claim(owner, { ...request, orderId, expectedRevision: revision, expectedDue: 100000, legs: [
    { key: 'card-1', method: 'card', amount: 60000 }, { key: 'transfer-2', method: 'transfer', amount: 40000 },
  ] });
  await expect(owner.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' })).resolves.toMatchObject({ status: 'instruct' });
  await owner.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  await setCoupon('paused');
  const refuse = { status: 'refused', code: 'coupon_unavailable' };
  const nextPayment = recovery === 'change method then give back'
    ? owner.mutation(changePlan, { ...attempt, legs: [{ key: 'promptpay-2', method: 'promptpay', amount: 40000 }] })
    : owner.mutation(arm, { ...attempt, load: request.load, legKey: 'transfer-2' });
  await expect(nextPayment).resolves.toMatchObject(refuse);
  await expect(owner.query(resume, { orderId, tillId: request.tillId, tabKey: request.tabKey })).resolves.toMatchObject({
    status: 'resume', attempt: { status: 'refused', refusal: { code: 'coupon_unavailable' }, legs: [{ state: 'taken' }, { state: 'planned' }] },
  });
  const cancel = api.pos.commands.cancelPaymentAttempt.cancelPaymentAttempt;
  await expect(owner.mutation(cancel, attempt)).resolves.toMatchObject({ status: 'refused', code: 'payment_kept' });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject(refuse);
  const review = { ...attempt, expectedRevision: revision, customers: [], vouchers: [] };
  await expect(owner.mutation(previewPaymentRecovery, review)).resolves.toMatchObject({ next: 'swap_or_give_back', kept: [{ method: 'card', amount: 60000 }] });
  if (recovery === 'collect rest') {
    await setCoupon('active');
    await expect(owner.mutation(previewPaymentRecovery, review)).resolves.toMatchObject({ next: 'collect', balance: 40000 });
    const child = await owner.mutation(startPaymentRecovery, {
      ...review, clientKey: 'split-recovery-promptpay', legs: [{ key: 'promptpay-rest', method: 'promptpay', amount: 40000 }],
    });
    expect(child.status).toBe('ready');
    if (child.status !== 'ready') throw new Error('Expected recovery child');
    const childRef = { ...attempt, attemptId: child.attempt.attemptId };
    await expect(owner.mutation(arm, { ...childRef, load: request.load, legKey: 'promptpay-rest' })).resolves.toMatchObject({ status: 'instruct' });
    await owner.mutation(record, { ...childRef, legKey: 'promptpay-rest', outcome: 'taken' });
    await expect(owner.mutation(settle, childRef)).resolves.toMatchObject({ status: 'settled' });
    expect(await t.run(ctx => ctx.db.query('orderPayments').take(3))).toMatchObject([
      { orderId, method: 'card', amount: 60000 }, { orderId, method: 'promptpay', amount: 40000 },
    ]);
  } else {
    const payout = { ...review, load: request.load, cancelSale: true, leg: { key: 'return-first-card', method: 'card' as const, amount: 60000 } };
    await expect(owner.mutation(armPaymentGiveBack, payout)).resolves.toMatchObject({ status: 'instruct' });
    await expect(owner.mutation(cancel, attempt)).resolves.toMatchObject({ status: 'refused', code: 'check_previous' });
    await owner.mutation(record, { ...attempt, kind: 'give_back', legKey: payout.leg.key, outcome: 'taken' });
    await expect(owner.mutation(cancel, attempt)).resolves.toMatchObject({ status: 'cancelled' });
    expect(await t.run(ctx => ctx.db.query('orderPayments').first())).toBeNull();
    expect((await t.run(ctx => ctx.db.get(orderId)))?.activeAttemptId).toBeUndefined();
  }
}, 30000);

it('lets only the current till and tab edit a funded swap, including after handover', async () => {
  const { t, request, deskA, deskB } = await fixture();
  await t.run(ctx => ctx.db.insert('staffGrants', {
    role: 'cashier', email: 'cashier@example.com', tokenIdentifier: 'cashier', createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
  }));
  const identity = { email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' };
  const cashier = t.withIdentity(identity);
  const second = t.withIdentity({ ...identity, sid: 'second-browser' });
  const attempt = await claim(cashier, request);
  await cashier.mutation(arm, { ...attempt, load: request.load, legKey: 'card-1' });
  await cashier.mutation(record, { ...attempt, legKey: 'card-1', outcome: 'taken' });
  const recovery = api.pos.commands.recoverPaymentAttempt;
  await expect(cashier.mutation(recovery.beginPaymentSwap, { ...attempt, expectedRevision: request.expectedRevision })).resolves.toMatchObject({ status: 'swap' });
  const line = (await t.run(ctx => ctx.db.query('orderLines').first()))!;
  const remove = api.pos.commands.removeLine.removeLine;
  const blocked = { data: { code: 'payment_in_progress' } };
  const mine = { tillId: deskA, tabKey: TAB_A };
  const theirs = { tillId: deskB, tabKey: TAB_B };
  await expect(second.query(resume, { orderId: request.orderId, ...theirs })).resolves.toMatchObject({ status: 'in_progress_elsewhere' });
  for (const swapOwner of [undefined, theirs, { tillId: deskA, tabKey: TAB_B }]) {
    await expect(second.mutation(remove, { lineId: line._id, swapOwner })).rejects.toMatchObject(blocked);
  }
  expect(await t.run(ctx => ctx.db.get(line._id))).toMatchObject({ unitPrice: 60000 });
  const handover = api.pos.commands.handoverPaymentAttempt;
  await expect(cashier.mutation(handover.releasePaymentAttempt, { ...attempt, nextTillId: deskB })).resolves.toMatchObject({ status: 'released' });
  await expect(second.mutation(remove, { lineId: line._id, swapOwner: theirs })).rejects.toMatchObject(blocked);
  await expect(second.mutation(handover.takeOverPaymentAttempt, {
    orderId: request.orderId, ...at(deskB, DEVICE_B, 0, TAB_B), expectedOwnerRevision: 1,
  })).resolves.toMatchObject({ status: 'taken_over' });
  await expect(cashier.mutation(remove, { lineId: line._id, swapOwner: mine })).rejects.toMatchObject(blocked);
  await second.mutation(remove, { lineId: line._id, swapOwner: theirs });
  expect(await t.run(ctx => ctx.db.get(line._id))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(request.orderId))).toMatchObject({ due: 0, activeAttemptId: attempt.attemptId });
}, 30000);

it('stores the armed or updated cash tender and records it on Taken without inventing an exact tender', async () => {
  const { t, owner, request } = await fixture();
  const attempt = await claim(owner, { ...request, legs: [{ key: 'cash-1', method: 'cash', amount: 60000 }] });
  const arming = { ...attempt, load: request.load, legKey: 'cash-1' };
  await expect(owner.mutation(arm, { ...arming, tendered: 59999 })).resolves.toMatchObject({ status: 'refused' });
  await expect(owner.mutation(arm, { ...arming, tendered: 65000 })).resolves.toMatchObject({ status: 'instruct', leg: { tendered: 65000 } });
  await expect(owner.mutation(arm, { ...arming, tendered: 68000 })).resolves.toMatchObject({ status: 'check_previous', leg: { tendered: 65000 } });
  const taken = { ...attempt, legKey: 'cash-1', outcome: 'taken' as const };
  await owner.mutation(arm, { ...arming, updateTendered: true, tendered: null });
  await expect(owner.mutation(record, taken)).resolves.toMatchObject({ status: 'refused', code: 'invalid_cash' });
  await owner.mutation(arm, { ...arming, updateTendered: true, tendered: 70000 });
  await expect(owner.query(resume, { orderId: request.orderId, tillId: request.tillId, tabKey: request.tabKey }))
    .resolves.toMatchObject({ status: 'resume', checkPrevious: { leg: { tendered: 70000 } } });
  await expect(owner.mutation(record, taken)).resolves.toMatchObject({ status: 'recorded', attempt: { legs: [{ received: 70000, change: 10000 }] } });
  await expect(owner.mutation(record, taken)).resolves.toMatchObject({ status: 'recorded', replayed: true });
  await expect(owner.mutation(settle, attempt)).resolves.toMatchObject({ status: 'settled' });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(2))).toMatchObject([{ method: 'cash', received: 70000, amount: 60000 }]);
}, 30000);
