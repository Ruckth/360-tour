import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertFresh, recordAppointmentChange, type AppointmentPatch } from './appointmentChanges';
import { assertMoney, attemptKey, cleanReason, effectiveTime } from './bookingMoney';
import { lineNet, round2 } from './billMath';
import { assertNotOnOpenOrder } from './orderLinks';
import { MANUAL_PAYMENT_METHODS } from './financeValidators';

type Appointment = Doc<'serviceAppointments'>;
type ReadCtx = QueryCtx | MutationCtx;
const LIMIT = 200;

/** Refunds do not reinstate a collectible service charge. Legacy flags are read, never fabricated as ledger entries. */
export function appointmentMoney(a: Appointment) {
  const gross = a.amountPaid ?? (a.paymentStatus === 'unpaid' ? 0 : a.price);
  const refunded = a.amountRefunded ?? (a.paymentStatus === 'refunded' ? gross : 0);
  return { gross, refunded, net: round2(gross - refunded), owed: a.paymentStatus === 'unpaid' && a.status !== 'cancelled' && a.status !== 'no_show' ? a.price : 0 };
}

async function rows(ctx: ReadCtx, a: Appointment) {
  const [payments, refunds, lines] = await Promise.all([
    ctx.db.query('appointmentPayments').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', a._id)).take(LIMIT + 1),
    ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', a._id)).take(LIMIT + 1),
    ctx.db.query('billLines').withIndex('by_appointmentId', q => q.eq('appointmentId', a._id)).take(LIMIT + 1)
  ]);
  if ([payments, refunds, lines].some(r => r.length > LIMIT)) throw new Error('Too many financial entries to safely correct this appointment. Ask support to review it.');
  const orders = [];
  for (const line of lines) {
    const order = await ctx.db.get(line.billId);
    if (!order || (order.status !== 'paid' && order.status !== 'void') || order.voidUnreceived) continue;
    orders.push({ billId: order._id, receiptNumber: order.receiptNumber, charged: lineNet(line), refundable: Math.max(0, round2(lineNet(line) - refunds.filter(r => r.billId === order._id).reduce((sum, r) => sum + r.amount, 0))) });
  }
  return { payments, refunds, orders };
}

/** The old admin Mark paid wrote exactly this change, without tender or received-at data.
 * POS wrote a reason (and sometimes price); flags alone or other financial changes prove nothing.
 */
async function legacyManualPayment(ctx: ReadCtx, a: Appointment, data: Awaited<ReturnType<typeof rows>>) {
  if (a.paymentStatus !== 'paid' || a.amountPaid !== undefined || a.amountRefunded !== undefined ||
      a.financialRevision !== undefined || a.paidAt !== undefined || a.paidBy !== undefined || a.refundedAt !== undefined ||
      data.payments.length || data.refunds.length || data.orders.length || !Number.isFinite(a.price) || a.price <= 0) return null;
  const history = await ctx.db.query('appointmentChanges').withIndex('by_appointmentId_and_at', q => q.eq('appointmentId', a._id)).take(LIMIT + 1);
  // Missing or truncated evidence cannot authorize a money correction.
  if (history.length > LIMIT) return null;
  const financial = history.filter(h => h.kind === 'payment' || h.changes.some(c =>
    ['paymentStatus', 'price', 'currency', 'amountPaid', 'amountRefunded', 'paidAt', 'paidBy', 'refundedAt', 'financialRevision'].includes(c.field) &&
    (c.from !== null || !['paymentStatus', 'price', 'currency'].includes(c.field) || (c.field === 'paymentStatus' && c.to !== 'unpaid'))));
  if (financial.length !== 1) return null;
  const evidence = financial[0];
  if (evidence.kind !== 'payment' || evidence.reason !== undefined || !/^[^@\s]+@[^@\s]+$/.test(evidence.actor) ||
      evidence.currencyBefore !== a.currency || evidence.currencyAfter !== a.currency || evidence.changes.length !== 1) return null;
  const change = evidence.changes[0];
  return change.field === 'paymentStatus' && change.from === 'unpaid' && change.to === 'paid' ? { changeId: evidence._id } : null;
}

export async function appointmentFinancials(ctx: ReadCtx, a: Appointment) {
  const data = await rows(ctx, a);
  const money = appointmentMoney(a);
  return { ...data, money, revision: a.revision ?? 0, legacyManualPayment: await legacyManualPayment(ctx, a, data),
    unitemised: Math.max(0, round2(money.gross - data.payments.filter(p => p.status === 'recorded').reduce((sum, p) => sum + p.amount, 0))) };
}

async function write(ctx: MutationCtx, a: Appointment, patch: AppointmentPatch, actor: string, reason: string | undefined, effectiveAt: number, details?: Array<{ field: string; from: string | number | null; to: string | number | null }>) {
  await recordAppointmentChange(ctx, a, { ...patch, financialRevision: (a.financialRevision ?? 0) + 1 }, { actor, kind: 'payment', reason, effectiveAt, details });
}

export async function recordAppointmentPayment(ctx: MutationCtx, a: Appointment, input: {
  expectedRevision?: number; effectiveAt?: number; method?: Doc<'appointmentPayments'>['method']; idempotencyKey?: string;
}, actor: string) {
  if ((input.method !== undefined || input.idempotencyKey !== undefined) && (input.expectedRevision === undefined || !input.idempotencyKey || !input.method)) throw new Error('Payment requires a reviewed revision, method and attempt key');
  const key = attemptKey(input.idempotencyKey ?? `legacy-payment:${a._id}:${a.revision ?? 0}`);
  const replay = await ctx.db.query('appointmentPayments').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
  if (replay) {
    if (replay.appointmentId !== a._id || replay.method !== (input.method ?? 'unrecorded') || (input.effectiveAt !== undefined && replay.effectiveAt !== input.effectiveAt)) throw new Error('Payment attempt key was already used for different details');
    return { paymentId: replay._id, replayed: true };
  }
  if (input.expectedRevision !== undefined) assertFresh(a, input.expectedRevision);
  if (a.status === 'cancelled') throw new Error('Cancelled appointment cannot be paid');
  if (a.paymentStatus !== 'unpaid' || appointmentMoney(a).refunded > 0) throw new Error('Only unpaid appointments can be marked paid; refunded payments require the payment correction workflow');
  await assertNotOnOpenOrder(ctx, { appointmentId: a._id }, 'This appointment');
  // A paid POS source must never be relabelled as a manual entry after a mistaken status write.
  if ((await rows(ctx, a)).orders.length) throw new Error('This appointment has receipt-owned money. Correct its receipt first.');
  assertMoney(a.price);
  const effectiveAt = effectiveTime(input.effectiveAt);
  const paymentId = await ctx.db.insert('appointmentPayments', { appointmentId: a._id, amount: a.price, currency: a.currency, method: input.method ?? 'unrecorded', effectiveAt, recordedAt: Date.now(), recordedBy: actor, idempotencyKey: key, status: 'recorded', refunded: 0 });
  await write(ctx, a, { paymentStatus: 'paid', amountPaid: a.price, amountRefunded: 0, paidAt: effectiveAt, paidBy: actor, refundedAt: undefined }, actor, 'Payment recorded at the desk', effectiveAt, [{ field: 'paymentId', from: null, to: paymentId }, { field: 'method', from: null, to: input.method ?? 'unrecorded' }]);
  return { paymentId, replayed: false };
}

export async function recordAppointmentRefund(ctx: MutationCtx, a: Appointment, input: {
  expectedRevision?: number; amount?: number; currency?: string; method?: Doc<'appointmentRefunds'>['method']; reason?: string;
  effectiveAt?: number; idempotencyKey?: string; paymentId?: Id<'appointmentPayments'>; billId?: Id<'bills'>;
}, actor: string) {
  const modern = [input.amount, input.currency, input.method, input.reason, input.idempotencyKey, input.paymentId, input.billId].some(value => value !== undefined);
  if (modern && (input.amount === undefined || input.expectedRevision === undefined || !input.idempotencyKey || !input.method || !input.reason || !input.currency)) throw new Error('Refund requires revision, attempt key, currency, method and reason');
  const key = attemptKey(input.idempotencyKey ?? `legacy-refund:${a._id}`);
  const replay = await ctx.db.query('appointmentRefunds').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
  if (replay) {
    if (!modern && !input.idempotencyKey) throw new Error('Only paid appointments can be refunded');
    if (replay.appointmentId !== a._id || (modern && (replay.amount !== input.amount || replay.currency !== input.currency || replay.method !== input.method || replay.reason !== input.reason?.trim() || replay.paymentId !== input.paymentId || replay.billId !== input.billId || (input.effectiveAt !== undefined && replay.effectiveAt !== input.effectiveAt)))) throw new Error('Refund attempt key was already used for different details');
    return { refundId: replay._id, replayed: true };
  }
  if (input.expectedRevision !== undefined) assertFresh(a, input.expectedRevision);
  const money = appointmentMoney(a);
  const amount = input.amount ?? money.net;
  if (a.paymentStatus !== 'paid') throw new Error('Only paid appointments can be refunded');
  assertMoney(amount, 'Refund');
  if (a.paymentStatus !== 'paid' || amount > money.net) throw new Error(`At most ${money.net} is left to refund`);
  if (input.currency !== undefined && input.currency !== a.currency) throw new Error(`Refund currency must be ${a.currency}`);
  if (input.paymentId && input.billId) throw new Error('Choose one source payment or receipt');
  const data = await rows(ctx, a);
  let billId = input.billId;
  let paymentId = input.paymentId;
  // Legacy full-refund callers still get a truthful source when exactly one source is provable.
  if (!modern && !billId && !paymentId) {
    if (data.orders.length === 1) billId = data.orders[0].billId;
    else if (data.payments.filter(p => p.status === 'recorded').length === 1) paymentId = data.payments.find(p => p.status === 'recorded')!._id;
  }
  if (billId) {
    const source = data.orders.find(o => o.billId === billId);
    if (!source || amount > source.refundable) throw new Error('Refund exceeds the actual money remaining on this receipt');
  } else if (paymentId) {
    const p = data.payments.find(p => p._id === paymentId);
    if (!p || p.status !== 'recorded' || amount > round2(p.amount - p.refunded)) throw new Error('Refund exceeds the actual money remaining on this payment');
    await ctx.db.patch(p._id, { refunded: round2(p.refunded + amount) });
  } else {
    if (data.orders.length || data.payments.some(p => p.status === 'recorded')) throw new Error('Choose the payment or receipt this refund came from');
    // Legacy unitemised payment: amount is known, its original tender/actor/time is not.
  }
  const reason = cleanReason(input.reason ?? 'Legacy full refund recorded; method and reason were not entered', 'Refund reason')!;
  const effectiveAt = effectiveTime(input.effectiveAt);
  const netAfter = round2(money.net - amount);
  const refundId = await ctx.db.insert('appointmentRefunds', { appointmentId: a._id, amount, currency: a.currency, method: input.method ?? 'unrecorded', reason, effectiveAt, recordedAt: Date.now(), recordedBy: actor, idempotencyKey: key, ...(paymentId ? { paymentId } : {}), ...(billId ? { billId } : {}), netBefore: money.net, netAfter });
  await write(ctx, a, { amountPaid: money.gross, amountRefunded: round2(money.refunded + amount), ...(netAfter === 0 ? { paymentStatus: 'refunded', refundedAt: effectiveAt } : {}) }, actor, reason, effectiveAt, [{ field: 'refundId', from: null, to: refundId }, { field: 'refundMethod', from: null, to: input.method ?? 'unrecorded' }, { field: 'refundAmount', from: null, to: amount }]);
  return { refundId, replayed: false };
}

export async function correctAppointmentPayment(ctx: MutationCtx, a: Appointment, input: {
  expectedRevision: number; paymentId?: Id<'appointmentPayments'>; legacyChangeId?: Id<'appointmentChanges'>; idempotencyKey: string; reason: string; action: 'amend' | 'cancel';
  method?: Doc<'appointmentPayments'>['method']; effectiveAt?: number;
}, actor: string) {
  const reason = cleanReason(input.reason)!;
  const key = attemptKey(input.idempotencyKey);
  const requestFingerprint = JSON.stringify({ appointmentId: a._id, paymentId: input.paymentId, ...(input.legacyChangeId ? { legacyChangeId: input.legacyChangeId } : {}), action: input.action, reason, method: input.method ?? null, effectiveAt: input.effectiveAt ?? null });
  const replay = await ctx.db.query('appointmentPaymentCorrections').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
  if (replay) {
    if (replay.actor !== actor || replay.requestFingerprint !== requestFingerprint) throw new Error('Correction attempt key was already used for different details');
    return { replayed: true };
  }
  assertFresh(a, input.expectedRevision);
  const data = await rows(ctx, a);
  if (data.orders.length) throw new Error('Correct the tender/date or void an unreceived payment from the original order receipt');
  if (Boolean(input.paymentId) === Boolean(input.legacyChangeId)) throw new Error('Choose one manual payment entry or proven legacy payment change');
  if (input.legacyChangeId) {
    const evidence = await legacyManualPayment(ctx, a, data);
    if (input.action !== 'cancel' || input.method !== undefined || input.effectiveAt !== undefined || evidence?.changeId !== input.legacyChangeId) {
      throw new Error('Original manual payment evidence is missing or ambiguous; this legacy payment cannot be reversed');
    }
    await assertNotOnOpenOrder(ctx, { appointmentId: a._id }, 'This appointment');
    await write(ctx, a, { paymentStatus: 'unpaid', amountPaid: 0, amountRefunded: 0 }, actor, reason, Date.now(),
      [{ field: 'legacyPaymentChangeId', from: null, to: evidence.changeId }]);
    // No reconstructed payment: its original tender and received-at time remain unknown.
    await ctx.db.insert('appointmentPaymentCorrections', { appointmentId: a._id, legacyChangeId: evidence.changeId, idempotencyKey: key, requestFingerprint, actor, recordedAt: Date.now(), reason });
    return { replayed: false };
  }
  const payment = data.payments.find(p => p._id === input.paymentId);
  if (!payment || payment.status !== 'recorded') throw new Error('Choose an active manual payment entry');
  if (payment.method !== 'unrecorded' && !MANUAL_PAYMENT_METHODS.some(method => method === payment.method)) throw new Error('Provider or receipt-owned money cannot be corrected as a manual payment');
  const money = appointmentMoney(a);
  if (input.action === 'cancel') {
    if (payment.refunded > 0 || money.refunded > 0 || data.refunds.length || a.refundedAt !== undefined) throw new Error('Refunded money cannot be cancelled as unreceived');
    await assertNotOnOpenOrder(ctx, { appointmentId: a._id }, 'This appointment');
    if (money.gross !== payment.amount) throw new Error('Other payments need review before reversing this entry');
    await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: actor, cancelReason: reason });
    await write(ctx, a, { paymentStatus: 'unpaid', amountPaid: 0, amountRefunded: 0, paidAt: undefined, paidBy: undefined }, actor, reason, Date.now());
  } else {
    const effectiveAt = effectiveTime(input.effectiveAt ?? payment.effectiveAt);
    await ctx.db.patch(payment._id, { method: input.method ?? payment.method, effectiveAt, amendedAt: Date.now(), amendedBy: actor });
    await write(ctx, a, { paidAt: effectiveAt }, actor, reason, effectiveAt, [{ field: 'method', from: payment.method, to: input.method ?? payment.method }, { field: 'paymentId', from: null, to: payment._id }]);
  }
  await ctx.db.insert('appointmentPaymentCorrections', { appointmentId: a._id, paymentId: input.paymentId, idempotencyKey: key, requestFingerprint, actor, recordedAt: Date.now(), reason });
  return { replayed: false };
}
