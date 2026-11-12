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
  const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc', workingHours: [0,1,2,3,4,5,6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
  const serviceId = await admin.mutation(api.services.commands.createService.createService, { slug: 'massage', name: 'Massage', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [staffId] });
  const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { serviceId, staffId, start: now - 86_400_000, guestName: 'Guest', guestPhone: '' });
  const read = () => admin.query(api.services.admin.getAppointmentFinancials, { appointmentId });
  const payment = () => admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', effectiveAt: now - 1000, idempotencyKey: 'manual-pay-001' });
  return { t, admin, appointmentId, read, payment };
}
it('refuses an unreceived-payment reversal after a partial appointment refund and exposes the actual refund on its receipt', async () => {
  const { t, admin, appointmentId, read } = await setup();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const view = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, idempotencyKey: 'appt-pos-settle', expectedRevision: view.order.revision!, expectedDue: 120000, tenders: [{ method: 'cash', amount: 120000 }] });
  expect(await read()).toMatchObject({ money: { gross: 120000, net: 120000 } });
  await admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId, expectedRevision: (await read()).revision, amount: 40000, currency: 'THB', method: 'cash', reason: 'Partial adjustment', orderId: orderId, idempotencyKey: 'appt-pos-refund' });
  const before = await t.run(ctx => ctx.db.get(appointmentId));
  await expect(admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'appt-no-reversal', reason: 'Mistake' })).rejects.toThrow('refunded');
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toEqual(before);
  const receipt = (await admin.query(api.pos.getOrder, { orderId }))!;
  expect(receipt.order.status).toBe('paid');
  expect(receipt.payments[0].amount).toBe(120000);
  expect(receipt.refunds).toMatchObject([{ sourceType: 'appointment', appointmentId, amount: 40000 }]);
  expect((await admin.query(api.pos.ordersForBooking, { appointmentId }))!.balance).toMatchObject({ paid: 80000, refunded: 40000, owed: 0 });
});

it('records independent partial/full refunds, source/actor/times, replay safety and no recollection, preserving lifecycle', async () => {
  const { t, admin, appointmentId, read, payment } = await setup();
  const paid = await payment();
  await payment(); // lost-response replay despite now stale revision
  const args = { appointmentId, expectedRevision: 1, amount: 40000, currency: 'THB', method: 'cash' as const, reason: 'Service adjustment', effectiveAt: now - 500, idempotencyKey: 'refund-part-001', paymentId: paid.paymentId };
  const result = await admin.mutation(api.services.commands.refundAppointment.refundAppointment, args);
  expect(await admin.mutation(api.services.commands.refundAppointment.refundAppointment, args)).toMatchObject({ ...result, replayed: true });
  expect(await read()).toMatchObject({ money: { gross: 120000, refunded: 40000, net: 80000, owed: 0 }, payments: [{ refunded: 40000 }], refunds: [{ recordedAt: now, effectiveAt: now - 500, recordedBy: 'admin@example.com', paymentId: paid.paymentId }] });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'paid', paidAt: now - 1000 });
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { ...args, amount: 40100 })).rejects.toThrow('already used');
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { ...args, idempotencyKey: 'stale-refund-001' })).rejects.toThrow('changed');
  await admin.mutation(api.services.commands.refundAppointment.refundAppointment, { ...args, expectedRevision: 2, amount: 80000, idempotencyKey: 'refund-full-001' });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'refunded', refundedAt: now - 500, amountPaid: 120000, amountRefunded: 120000 });
  await expect(admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId })).rejects.toThrow('Only unpaid');
  const audit = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'appointment').eq('entityId', appointmentId)).take(20));
  expect(audit).toHaveLength(4);
  expect(JSON.stringify(audit)).not.toContain((await t.run(ctx => ctx.db.get(appointmentId)))!.accessToken);
});
it.each([NaN, Infinity, -1, 0, 0.001, 1200.01])('rejects invalid/overrefund %s without ledger writes', async amount => {
  const { admin, appointmentId, read, payment } = await setup();
  const paid = await payment();
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId, expectedRevision: 1, amount, currency: 'THB', method: 'cash', reason: 'reason', idempotencyKey: 'invalid-refund', paymentId: paid.paymentId })).rejects.toThrow();
  expect((await read()).refunds).toHaveLength(0);
  expect((await read()).revision).toBe(1);
});
it('refuses currency/foreign-source/anonymous corrections and preserves drafts after stale revisions', async () => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  const args = { appointmentId, expectedRevision: 1, amount: 1000, currency: 'USD', method: 'cash' as const, reason: 'reason', idempotencyKey: 'wrong-currency', paymentId: paid.paymentId };
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, args)).rejects.toThrow('currency');
  await expect(t.mutation(api.services.commands.refundAppointment.refundAppointment, { ...args, currency: 'THB' })).rejects.toThrow('authenticated');
  await expect(t.query(api.services.admin.getAppointmentFinancials, { appointmentId })).rejects.toThrow('authenticated');
  await expect(t.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'cancel-payment-001', action: 'cancel', reason: 'mistake' })).rejects.toThrow('authenticated');
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { ...args, currency: 'THB', effectiveAt: now + 86_400_000 })).rejects.toThrow('future');
  expect((await read()).refunds).toHaveLength(0);
});
it('amends manual tender/date with old values in history and reverses only unreceived manual money', async () => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  await admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'amend-payment-001', action: 'amend', method: 'transfer', effectiveAt: now - 5000, reason: 'Wrong tender and day' });
  expect((await read()).payments[0]).toMatchObject({ method: 'transfer', effectiveAt: now - 5000, recordedAt: now, recordedBy: 'admin@example.com', amendedBy: 'admin@example.com' });
  const history = await admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId, paginationOpts: { numItems: 10, cursor: null } });
  expect(history.page[0].changes).toContainEqual({ field: 'method', from: 'cash', to: 'transfer' });
  await admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 2, paymentId: paid.paymentId, idempotencyKey: 'cancel-payment-001', action: 'cancel', reason: 'No money received' });
  expect(await read()).toMatchObject({ money: { gross: 0, refunded: 0, owed: 120000 }, payments: [{ status: 'cancelled' }] });
  expect(await t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'completed', paymentStatus: 'unpaid' });
});
it('preserves POS receipts, references their actual collected money, and blocks manual correction of refunded money', async () => {
  const { t, admin, appointmentId, read } = await setup();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const view = (await admin.query(api.pos.getOrder, { orderId }))!;
  await admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: view.order.revision, expectedDue: 120000, idempotencyKey: 'pos-appointment-001', tenders: [{ method: 'cash', amount: 120000 }] });
  const receipt = await t.run(ctx => ctx.db.get(orderId));
  await admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId, expectedRevision: 1, amount: 20000, currency: 'THB', method: 'cash', reason: 'Partial courtesy refund', orderId: orderId, idempotencyKey: 'pos-refund-001' });
  expect(await read()).toMatchObject({ money: { net: 100000, owed: 0 }, orders: [{ refundable: 100000 }], refunds: [{ orderId: orderId }] });
  expect(await t.run(ctx => ctx.db.get(orderId))).toEqual(receipt);
});
it('replays an acknowledged/lost manual correction before checking stale revision and blocks correction key reuse', async () => {
  const { admin, appointmentId, payment, read } = await setup(); const paid = await payment();
  const args = { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'cancel-replay-001', action: 'cancel' as const, reason: 'Never received' };
  await admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, args);
  expect(await admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, args)).toEqual({ replayed: true });
  expect((await read()).revision).toBe(2);
  await expect(admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, { ...args, reason: 'Changed reason' })).rejects.toThrow('already used');
});
it('refuses a refund from another appointment payment and non-admin staff access', async () => {
  const { t, admin, appointmentId, payment } = await setup(); await payment();
  const original = (await t.run(ctx => ctx.db.get(appointmentId)))!;
  const { appointmentId: foreignAppointment } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { serviceId: original.serviceId, staffId: original.staffId, start: original.start - 86_400_000, guestName: 'Other', guestPhone: '' });
  const foreignPaymentId = (await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId: foreignAppointment, expectedRevision: 0, method: 'cash', idempotencyKey: 'foreign-payment-001' })).paymentId;
  await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId, expectedRevision: 1, amount: 1000, currency: 'THB', method: 'cash', reason: 'Wrong source', idempotencyKey: 'wrong-source-001', paymentId: foreignPaymentId })).rejects.toThrow('remaining');
  const other = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
  await expect(other.query(api.services.admin.getAppointmentFinancials, { appointmentId })).rejects.toThrow();
  await expect(other.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId })).rejects.toThrow();
});
it.each(['stripe', 'provider', 'order'] as const)('refuses %s ledger money through the manual correction endpoint', async method => {
  const { t, admin, appointmentId, payment, read } = await setup();
  const paid = await payment();
  await t.run(ctx => ctx.db.patch(paid.paymentId, { method }));
  await expect(admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, { appointmentId, expectedRevision: 1, paymentId: paid.paymentId, idempotencyKey: 'provider-cancel', action: 'cancel', reason: 'Wrong source' })).rejects.toThrow('Provider');
  expect((await read()).money.net).toBe(120000);
});
