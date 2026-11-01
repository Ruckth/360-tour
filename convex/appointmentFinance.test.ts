// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
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
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'booked', paymentStatus: 'paid', paidAt: now - 1000 });
  await expect(admin.mutation(api.adminServices.refundAppointment, { ...args, amount: 401 })).rejects.toThrow('already used');
  await expect(admin.mutation(api.adminServices.refundAppointment, { ...args, idempotencyKey: 'stale-refund-001' })).rejects.toThrow('changed');
  await admin.mutation(api.adminServices.refundAppointment, { ...args, expectedRevision: 2, amount: 800, idempotencyKey: 'refund-full-001' });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'booked', paymentStatus: 'refunded', refundedAt: now - 500, amountPaid: 1200, amountRefunded: 1200 });
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
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'booked', paymentStatus: 'unpaid' });
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
