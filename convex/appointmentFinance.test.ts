// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import type { Doc } from './_generated/dataModel';
import { isLegacyManualPaymentCandidate, legacyManualPayment } from './lib/appointmentFinance';
const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 1, 5);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const staffId = await admin.mutation(api.adminServices.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc', workingHours: [0,1,2,3,4,5,6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
  const serviceId = await admin.mutation(api.adminServices.createService, { slug: 'massage', name: 'Massage', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 1200, currency: 'THB', staffIds: [staffId] });
  const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { serviceId, staffId, start: now - 86_400_000, guestName: 'Guest', guestPhone: '' });
  const read = () => admin.query(api.adminServices.getAppointmentFinancials, { appointmentId });
  const payment = () => admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', effectiveAt: now - 1000, idempotencyKey: 'manual-pay-001' });
  return { t, admin, appointmentId, read, payment };
}
it('refuses an unreceived-payment reversal after a partial appointment refund and exposes the actual refund on its receipt', async () => {
  const { t, admin, appointmentId, read } = await setup();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const view = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, idempotencyKey: 'appt-pos-settle', expectedRevision: view.order.revision!, expectedDue: 1200, tenders: [{ method: 'cash', amount: 1200 }] });
  expect(await read()).toMatchObject({ money: { gross: 1200, net: 1200 } });
  await admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: (await read()).revision, amount: 400, currency: 'THB', method: 'cash', reason: 'Partial adjustment', billId: orderId, idempotencyKey: 'appt-pos-refund' });
  const before = await t.run(ctx => ctx.db.get(appointmentId));
  await expect(admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'appt-no-reversal', reason: 'Mistake' })).rejects.toThrow('refunded');
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toEqual(before);
  const receipt = (await admin.query(api.pos.getOrder, { orderId }))!;
  expect(receipt.order.status).toBe('paid');
  expect(receipt.payments[0].amount).toBe(1200);
  expect(receipt.refunds).toMatchObject([{ sourceType: 'appointment', appointmentId, amount: 400 }]);
  expect((await admin.query(api.pos.ordersForBooking, { appointmentId }))!.balance).toMatchObject({ paid: 800, refunded: 400, owed: 0 });
});

it('records independent partial/full refunds, source/actor/times, replay safety and no recollection, preserving lifecycle', async () => {
  const { t, admin, appointmentId, read, payment } = await setup();
  const paid = await payment();
  await payment(); // lost-response replay despite now stale revision
  const args = { appointmentId, expectedRevision: 1, amount: 400, currency: 'THB', method: 'cash' as const, reason: 'Service adjustment', effectiveAt: now - 500, idempotencyKey: 'refund-part-001', paymentId: paid.paymentId };
  const result = await admin.mutation(api.adminServices.refundAppointment, args);
  expect(await admin.mutation(api.adminServices.refundAppointment, args)).toMatchObject({ ...result, replayed: true });
  expect(await read()).toMatchObject({ money: { gross: 1200, refunded: 400, net: 800, owed: 0 }, payments: [{ refunded: 400 }], refunds: [{ recordedAt: now, effectiveAt: now - 500, recordedBy: 'admin@example.com', paymentId: paid.paymentId }] });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'paid', paidAt: now - 1000 });
  await expect(admin.mutation(api.adminServices.refundAppointment, { ...args, amount: 401 })).rejects.toThrow('already used');
  await expect(admin.mutation(api.adminServices.refundAppointment, { ...args, idempotencyKey: 'stale-refund-001' })).rejects.toThrow('changed');
  await admin.mutation(api.adminServices.refundAppointment, { ...args, expectedRevision: 2, amount: 800, idempotencyKey: 'refund-full-001' });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'refunded', refundedAt: now - 500, amountPaid: 1200, amountRefunded: 1200 });
  await expect(admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId })).rejects.toThrow('Only unpaid');
  const audit = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'appointment').eq('entityId', appointmentId)).take(20));
  expect(audit).toHaveLength(4);
  expect(JSON.stringify(audit)).not.toContain((await t.run(ctx => ctx.db.get(appointmentId)))!.accessToken);
});
it.each([NaN, Infinity, -1, 0, 0.001, 1200.01])('rejects invalid/overrefund %s without ledger writes', async amount => {
  const { admin, appointmentId, read, payment } = await setup();
  const paid = await payment();
  await expect(admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount, currency: 'THB', method: 'cash', reason: 'reason', idempotencyKey: 'invalid-refund', paymentId: paid.paymentId })).rejects.toThrow();
  expect((await read()).refunds).toHaveLength(0);
  expect((await read()).revision).toBe(1);
});
it('refuses currency/foreign-source/anonymous corrections and preserves drafts after stale revisions', async () => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  const args = { appointmentId, expectedRevision: 1, amount: 10, currency: 'USD', method: 'cash' as const, reason: 'reason', idempotencyKey: 'wrong-currency', paymentId: paid.paymentId };
  await expect(admin.mutation(api.adminServices.refundAppointment, args)).rejects.toThrow('currency');
  await expect(t.mutation(api.adminServices.refundAppointment, { ...args, currency: 'THB' })).rejects.toThrow('authenticated');
  await expect(t.query(api.adminServices.getAppointmentFinancials, { appointmentId })).rejects.toThrow('authenticated');
  await expect(t.mutation(api.adminServices.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'cancel-payment-001', action: 'cancel', reason: 'mistake' })).rejects.toThrow('authenticated');
  await expect(admin.mutation(api.adminServices.refundAppointment, { ...args, currency: 'THB', effectiveAt: now + 86_400_000 })).rejects.toThrow('future');
  expect((await read()).refunds).toHaveLength(0);
});
it('amends manual tender/date with old values in history and reverses only unreceived manual money', async () => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'amend-payment-001', action: 'amend', method: 'transfer', effectiveAt: now - 5000, reason: 'Wrong tender and day' });
  expect((await read()).payments[0]).toMatchObject({ method: 'transfer', effectiveAt: now - 5000, recordedAt: now, recordedBy: 'admin@example.com', amendedBy: 'admin@example.com' });
  const history = await admin.query(api.adminServices.listAppointmentHistoryPage, { appointmentId, paginationOpts: { numItems: 10, cursor: null } });
  expect(history.page[0].changes).toContainEqual({ field: 'method', from: 'cash', to: 'transfer' });
  await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 2, paymentId: paid.paymentId, idempotencyKey: 'cancel-payment-001', action: 'cancel', reason: 'No money received' });
  expect(await read()).toMatchObject({ money: { gross: 0, refunded: 0, owed: 1200 }, payments: [{ status: 'cancelled' }] });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'unpaid' });
});
it('preserves POS receipts, references their actual collected money, and blocks manual correction of refunded money', async () => {
  const { t, admin, appointmentId, read } = await setup();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const view = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: view.order.revision, expectedDue: 1200, idempotencyKey: 'pos-appointment-001', tenders: [{ method: 'cash', amount: 1200 }] });
  const receipt = await t.run(ctx => ctx.db.get(orderId));
  await admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount: 200, currency: 'THB', method: 'cash', reason: 'Partial courtesy refund', billId: orderId, idempotencyKey: 'pos-refund-001' });
  expect(await read()).toMatchObject({ money: { net: 1000, owed: 0 }, orders: [{ refundable: 1000 }], refunds: [{ billId: orderId }] });
  expect(await t.run(ctx => ctx.db.get(orderId))).toEqual(receipt);
});
it('reads legacy payment/refund flags honestly and full-refund compatibility writes an unrecorded-method ledger only now', async () => {
  const { t, admin, appointmentId, read } = await setup();
  await t.run(ctx => ctx.db.patch(appointmentId, { paymentStatus: 'paid', paidAt: undefined, paidBy: undefined, revision: undefined }));
  expect(await read()).toMatchObject({ payments: [], unitemised: 1200 });
  await admin.mutation(api.adminServices.refundAppointment, { appointmentId });
  expect(await read()).toMatchObject({ money: { refunded: 1200, net: 0, owed: 0 }, refunds: [{ method: 'unrecorded', recordedAt: now }] });
  await expect(admin.mutation(api.adminServices.refundAppointment, { appointmentId })).rejects.toThrow('Only paid'); // legacy duplicate is safely refused
  expect((await read()).refunds).toHaveLength(1);
});
it('replays an acknowledged/lost manual correction before checking stale revision and blocks correction key reuse', async () => {
  const { admin, appointmentId, payment, read } = await setup(); const paid = await payment();
  const args = { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'cancel-replay-001', action: 'cancel' as const, reason: 'Never received' };
  await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, args);
  expect(await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, args)).toEqual({ replayed: true });
  expect((await read()).revision).toBe(2);
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...args, reason: 'Changed reason' })).rejects.toThrow('already used');
});
it('refuses a refund from another appointment payment and non-admin staff access', async () => {
  const { t, admin, appointmentId, payment } = await setup(); await payment();
  const original = (await t.run(ctx => ctx.db.get(appointmentId)))!;
  const { appointmentId: foreignAppointment } = await admin.mutation(api.adminServices.createAppointment, { serviceId: original.serviceId, staffId: original.staffId, start: original.start - 86_400_000, guestName: 'Other', guestPhone: '' });
  const foreignPaymentId = (await admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId: foreignAppointment, expectedRevision: 0, method: 'cash', idempotencyKey: 'foreign-payment-001' })).paymentId;
  await expect(admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount: 10, currency: 'THB', method: 'cash', reason: 'Wrong source', idempotencyKey: 'wrong-source-001', paymentId: foreignPaymentId })).rejects.toThrow('remaining');
  const other = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
  await expect(other.query(api.adminServices.getAppointmentFinancials, { appointmentId })).rejects.toThrow();
  await expect(other.mutation(api.adminServices.markAppointmentPaid, { appointmentId })).rejects.toThrow();
});

// Faithful pre-PR admin Mark paid evidence: no payment row, paidAt, tender or reason was written.
async function legacyPaid() {
  const state = await setup();
  const changeId = await state.t.run(async ctx => {
    await ctx.db.patch(state.appointmentId, { paymentStatus: 'paid', revision: 1, createdAt: now - 86_400_000 });
    // Pre-PR creation did not append either of today's creation-history records.
    for (const row of await ctx.db.query('appointmentChanges').withIndex('by_appointmentId_and_at', q => q.eq('appointmentId', state.appointmentId)).take(10)) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'appointment').eq('entityId', state.appointmentId)).take(10)) await ctx.db.delete(row._id);
    return await ctx.db.insert('appointmentChanges', { appointmentId: state.appointmentId, at: now - 10000, actor: 'former-admin@example.com', kind: 'payment', currencyBefore: 'THB', currencyAfter: 'THB', changes: [{ field: 'paymentStatus', from: 'unpaid', to: 'paid' }] });
  });
  const input = { appointmentId: state.appointmentId, expectedRevision: 1, legacyChangeId: changeId, idempotencyKey: 'legacy-not-received', action: 'cancel' as const, reason: 'Old Mark paid was a mistake; no money received' };
  return { ...state, changeId, input };
}
it('reverses only the proven legacy manual Mark paid, with atomic evidence/history and honest unknown original data', async () => {
  const { t, admin, appointmentId, read, changeId, input } = await legacyPaid();
  expect(await read()).toMatchObject({ legacyManualPayment: { changeId }, payments: [], unitemised: 1200 });
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, reason: ' ' })).rejects.toThrow();
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, expectedRevision: 0 })).rejects.toThrow('changed');
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, action: 'amend', method: 'cash' })).rejects.toThrow('evidence');
  await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, input);
  expect(await read()).toMatchObject({ legacyManualPayment: null, payments: [], refunds: [], money: { gross: 0, refunded: 0, owed: 1200 }, revision: 2 });
  const appointment = (await t.run(ctx => ctx.db.get(appointmentId)))!;
  expect(appointment).toMatchObject({ status: 'completed', paymentStatus: 'unpaid', amountPaid: 0, amountRefunded: 0 });
  expect(appointment.paidAt).toBeUndefined(); expect(appointment.paidBy).toBeUndefined();
  const entries = await admin.query(api.adminServices.listAppointmentHistoryPage, { appointmentId, paginationOpts: { numItems: 10, cursor: null } });
  expect(entries.page[0]).toMatchObject({ kind: 'payment', actor: 'admin@example.com', reason: input.reason, at: now });
  expect(entries.page[0].changes).toEqual(expect.arrayContaining([{ field: 'paymentStatus', from: 'paid', to: 'unpaid' }, { field: 'legacyPaymentChangeId', from: null, to: changeId }]));
  const audit = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'appointment').eq('entityId', appointmentId)).take(20));
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actor: 'admin@example.com', reason: input.reason, recordedAt: now, effectiveAt: now, before: { paymentStatus: 'paid' }, after: { paymentStatus: 'unpaid', legacyPaymentChangeId: changeId } });
  const corrections = await t.run(ctx => ctx.db.query('appointmentPaymentCorrections').take(10));
  expect(corrections).toMatchObject([{ legacyChangeId: changeId, actor: 'admin@example.com', reason: input.reason }]);
  expect(corrections[0].paymentId).toBeUndefined();
  expect(await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, input)).toEqual({ replayed: true });
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, reason: 'Different reason' })).rejects.toThrow('already used');
  expect((await read()).revision).toBe(2);
  expect(await t.run(ctx => ctx.db.query('appointmentPaymentCorrections').take(10))).toHaveLength(1);
  // Unknown original data stays absent; a new real collection is allowed after the mistaken entry is removed.
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const order = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: order.order.revision, expectedDue: 1200, idempotencyKey: 'legacy-then-collected', tenders: [{ method: 'cash', amount: 1200 }] });
  expect(await read()).toMatchObject({ money: { gross: 1200, net: 1200, owed: 0 } });
  expect(await admin.mutation(api.adminServices.correctAppointmentPaymentEntry, input)).toEqual({ replayed: true });
  expect((await read()).money.net).toBe(1200); // Late replay cannot erase newly collected money.
});
it.each(['missing history', 'POS reason', 'provider actor', 'duplicate evidence', 'price correction', 'unknown payment time', 'history overflow', 'refund marker', 'refund counter', 'refund row', 'payment row'])(
  'rejects ambiguous/refunded legacy payment: %s, without any correction writes', async scenario => {
    const { t, admin, appointmentId, read, changeId, input } = await legacyPaid();
    await t.run(async ctx => {
      if (scenario === 'missing history') await ctx.db.delete(changeId);
      if (scenario === 'POS reason') await ctx.db.patch(changeId, { reason: 'Paid at checkout' });
      if (scenario === 'provider actor') await ctx.db.patch(changeId, { actor: 'system:stripe' });
      if (scenario === 'duplicate evidence' || scenario === 'price correction') {
        const original = (await ctx.db.get(changeId))!;
        await ctx.db.insert('appointmentChanges', { appointmentId, at: now - 5000, actor: original.actor, kind: 'payment', currencyBefore: 'THB', currencyAfter: 'THB', changes: scenario === 'duplicate evidence' ? original.changes : [{ field: 'price', from: 1000, to: 1200 }] });
      }
      if (scenario === 'unknown payment time') await ctx.db.insert('appointmentChanges', { appointmentId, at: now - 5000, actor: 'admin@example.com', kind: 'details', currencyBefore: 'THB', currencyAfter: 'THB', changes: [{ field: 'paidAt', from: null, to: now - 5000 }] });
      if (scenario === 'history overflow') for (let i = 0; i < 200; i++) await ctx.db.insert('appointmentChanges', { appointmentId, at: now - 5000, actor: 'admin@example.com', kind: 'details', currencyBefore: 'THB', currencyAfter: 'THB', changes: [{ field: 'notes', from: null, to: 'Earlier edit' }] });
      if (scenario === 'refund marker') await ctx.db.patch(appointmentId, { refundedAt: now - 5000 });
      if (scenario === 'refund counter') await ctx.db.patch(appointmentId, { amountRefunded: 100 });
      if (scenario === 'refund row') await ctx.db.insert('appointmentRefunds', { appointmentId, amount: 100, currency: 'THB', method: 'cash', reason: 'Earlier return', recordedAt: now, effectiveAt: now, recordedBy: 'admin@example.com', idempotencyKey: 'prior-return', netBefore: 1200, netAfter: 1100 });
      if (scenario === 'payment row') await ctx.db.insert('appointmentPayments', { appointmentId, amount: 1200, currency: 'THB', method: 'provider', effectiveAt: now, recordedAt: now, recordedBy: 'stripe', idempotencyKey: 'prior-provider', status: 'recorded', refunded: 0 });
    });
    expect((await read()).legacyManualPayment).toBeNull();
    const before = await t.run(ctx => ctx.db.get(appointmentId));
    await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, input)).rejects.toThrow('evidence');
    expect(await t.run(ctx => ctx.db.get(appointmentId))).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('appointmentPaymentCorrections').take(10))).toHaveLength(0);
  }
);
it.each(['stripe', 'provider', 'order'] as const)('refuses %s ledger money through the manual correction endpoint', async method => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  await t.run(ctx => ctx.db.patch(paid.paymentId, { method }));
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'provider-cancel', action: 'cancel', reason: 'Wrong source' })).rejects.toThrow('Provider');
  expect((await read()).money.net).toBe(1200);
});
it('rejects a legacy reversal while checkout is charging it and after an issued receipt, including a plain void', async () => {
  const { t, admin, appointmentId, read, changeId, input } = await legacyPaid();
  // A paid flag can have been wrongly written while a preexisting order remained open.
  await t.run(ctx => ctx.db.patch(appointmentId, { paymentStatus: 'unpaid' }));
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  await t.run(ctx => ctx.db.patch(appointmentId, { paymentStatus: 'paid' }));
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, input)).rejects.toThrow('still open');
  expect((await read()).revision).toBe(1);
  await t.run(ctx => ctx.db.patch(appointmentId, { paymentStatus: 'unpaid' }));
  const order = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: order.order.revision, expectedDue: 1200, idempotencyKey: 'legacy-real-receipt', tenders: [{ method: 'cash', amount: 1200 }] });
  // Even a contradictory legacy flag/history cannot relabel receipt money as manual.
  await t.run(ctx => ctx.db.patch(appointmentId, { amountPaid: undefined, amountRefunded: undefined, financialRevision: undefined, paidAt: undefined, paidBy: undefined }));
  expect((await read()).legacyManualPayment).toBeNull();
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, expectedRevision: (await read()).revision, legacyChangeId: changeId })).rejects.toThrow('receipt');
  await t.run(ctx => ctx.db.patch(orderId, { status: 'void' }));
  expect((await read()).legacyManualPayment).toBeNull();
  await expect(admin.mutation(api.adminServices.correctAppointmentPaymentEntry, { ...input, expectedRevision: (await read()).revision })).rejects.toThrow('receipt');
});

it.each([
  { paymentStatus: 'unpaid' as const }, { amountPaid: 0 }, { amountRefunded: 0 },
  { financialRevision: 0 }, { paidAt: 0 }, { paidBy: '' }, { refundedAt: 0 },
  { price: 0 }, { price: -1 }, { price: NaN }, { price: Infinity },
] satisfies Partial<Doc<'serviceAppointments'>>[])('rejects non-legacy fields before reading payment history: %o', async patch => {
  const { t, appointmentId } = await setup();
  const original = (await t.run(ctx => ctx.db.get(appointmentId)))!;
  const legacy = { ...original, paymentStatus: 'paid' as const };
  expect(isLegacyManualPaymentCandidate(legacy)).toBe(true);
  const appointment = { ...legacy, ...patch };
  expect(isLegacyManualPaymentCandidate(appointment)).toBe(false);
  const readHistory = vi.fn().mockRejectedValue(new Error('Must not read history'));
  expect(await t.run(ctx => legacyManualPayment(ctx, appointment, { payments: [], refunds: [], orders: [] }, readHistory))).toBeNull();
  expect(readHistory).not.toHaveBeenCalled();
});
