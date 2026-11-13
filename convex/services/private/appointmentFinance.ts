import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { attemptKey, cleanReason, effectiveTime } from '../../lib/bookingMoney';
import { MANUAL_PAYMENT_METHODS } from '../../lib/financeValidators';
import { sourceLineLinks, assertNotOnOpenOrder } from '../../pos/model';
import { lineNet, roundMoney } from '../../lib/orderMath';
import { assertMoney } from '../../lib/stayMoney';
import { syncAffiliateCredit } from '../../marketing/model';
import { assertFresh, recordAppointmentChange, type AppointmentPatch } from './appointmentChanges';

type Appointment = Doc<'appointments'>;

type ReadCtx = QueryCtx | MutationCtx;

const LIMIT = 200;

export function appointmentMoney(a: Appointment) {
  const gross = a.amountPaid ?? 0;
  const refunded = a.amountRefunded ?? 0;
  return { gross, refunded, net: roundMoney(gross - refunded), owed: a.paymentStatus === 'unpaid' && a.status !== 'cancelled' && a.status !== 'no_show' ? a.price : 0 };
}

async function rows(ctx: ReadCtx, a: Appointment) {
  const [payments, refunds, lines] = await Promise.all([
    ctx.db.query('appointmentPayments').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', a._id)).take(LIMIT + 1),
    ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', a._id)).take(LIMIT + 1),
    ctx.db.query('orderLines').withIndex('by_appointmentId', q => q.eq('appointmentId', a._id)).take(LIMIT + 1)
  ]);
  if ([payments, refunds, lines].some(r => r.length > LIMIT)) throw new Error('Too many financial entries to safely correct this appointment. Ask support to review it.');
  // Money an order took for it: a row charged at checkout, or a paid service row linked later (pos.linkPaidLine).
  const charges: Array<{ orderId: Id<'orders'>; charged: number }> = lines.map(line => ({ orderId: line.orderId, charged: lineNet(line) }));
  for (const link of await sourceLineLinks(ctx, { appointmentId: a._id }, 'active')) charges.push({ orderId: link.orderId, charged: link.amount });
  const orders = [];
  for (const charge of charges) {
    const order = await ctx.db.get(charge.orderId);
    if (!order || (order.status !== 'paid' && order.status !== 'void') || order.voidUnreceived) continue;
    orders.push({ orderId: order._id, receiptNumber: order.receiptNumber, charged: charge.charged, refundable: Math.max(0, roundMoney(charge.charged - refunds.filter(r => r.orderId === order._id).reduce((sum, r) => sum + r.amount, 0))) });
  }
  return { payments, refunds, orders };
}

export async function appointmentFinancials(ctx: ReadCtx, a: Appointment) {
  const data = await rows(ctx, a);
  const money = appointmentMoney(a);
  return { ...data, money, revision: a.revision ?? 0 };
}

async function write(ctx: MutationCtx, a: Appointment, patch: AppointmentPatch, actor: string, reason: string | undefined, effectiveAt: number, details?: Array<{ field: string; from: string | number | null; to: string | number | null }>) {
  await recordAppointmentChange(ctx, a, { ...patch, financialRevision: (a.financialRevision ?? 0) + 1 }, { actor, kind: 'payment', reason, effectiveAt, details });
}

export async function recordAppointmentPayment(ctx: MutationCtx, a: Appointment, input: {
  expectedRevision?: number; effectiveAt?: number; method?: Doc<'appointmentPayments'>['method']; idempotencyKey?: string;
}, actor: string) {
  if ((input.method !== undefined || input.idempotencyKey !== undefined) && (input.expectedRevision === undefined || !input.idempotencyKey || !input.method)) throw new Error('Payment requires a reviewed revision, method and attempt key');
  const key = attemptKey(input.idempotencyKey ?? `manual-payment:${a._id}:${a.revision ?? 0}`);
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
  effectiveAt?: number; idempotencyKey?: string; paymentId?: Id<'appointmentPayments'>; orderId?: Id<'orders'>;
}, actor: string) {
  const modern = [input.amount, input.currency, input.method, input.reason, input.idempotencyKey, input.paymentId, input.orderId].some(value => value !== undefined);
  if (modern && (input.amount === undefined || input.expectedRevision === undefined || !input.idempotencyKey || !input.method || !input.reason || !input.currency)) throw new Error('Refund requires revision, attempt key, currency, method and reason');
  const key = attemptKey(input.idempotencyKey ?? `manual-refund:${a._id}`);
  const replay = await ctx.db.query('appointmentRefunds').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
  if (replay) {
    if (!modern && !input.idempotencyKey) throw new Error('Only paid appointments can be refunded');
    if (replay.appointmentId !== a._id || (modern && (replay.amount !== input.amount || replay.currency !== input.currency || replay.method !== input.method || replay.reason !== input.reason?.trim() || replay.paymentId !== input.paymentId || replay.orderId !== input.orderId || (input.effectiveAt !== undefined && replay.effectiveAt !== input.effectiveAt)))) throw new Error('Refund attempt key was already used for different details');
    return { refundId: replay._id, replayed: true };
  }
  if (input.expectedRevision !== undefined) assertFresh(a, input.expectedRevision);
  const money = appointmentMoney(a);
  const amount = input.amount ?? money.net;
  if (a.paymentStatus !== 'paid') throw new Error('Only paid appointments can be refunded');
  assertMoney(amount, 'Refund');
  if (a.paymentStatus !== 'paid' || amount > money.net) throw new Error(`At most ${money.net / 100} is left to refund`);
  if (input.currency !== undefined && input.currency !== a.currency) throw new Error(`Refund currency must be ${a.currency}`);
  if (input.paymentId && input.orderId) throw new Error('Choose one source payment or receipt');
  const data = await rows(ctx, a);
  let orderId = input.orderId;
  let paymentId = input.paymentId;

  if (!modern && !orderId && !paymentId) {
    if (data.orders.length === 1) orderId = data.orders[0].orderId;
    else if (data.payments.filter(p => p.status === 'recorded').length === 1) paymentId = data.payments.find(p => p.status === 'recorded')!._id;
  }
  if (orderId) {
    const source = data.orders.find(o => o.orderId === orderId);
    if (!source || amount > source.refundable) throw new Error('Refund exceeds the actual money remaining on this receipt');
  } else if (paymentId) {
    const p = data.payments.find(p => p._id === paymentId);
    if (!p || p.status !== 'recorded' || amount > roundMoney(p.amount - p.refunded)) throw new Error('Refund exceeds the actual money remaining on this payment');
    await ctx.db.patch(p._id, { refunded: roundMoney(p.refunded + amount) });
  } else {
    if (data.orders.length || data.payments.some(p => p.status === 'recorded')) throw new Error('Choose the payment or receipt this refund came from');
    throw new Error('Choose the payment or receipt this refund came from');
  }
  const reason = cleanReason(input.reason ?? 'Full refund recorded at the desk', 'Refund reason')!;
  const effectiveAt = effectiveTime(input.effectiveAt);
  const netAfter = roundMoney(money.net - amount);
  const refundId = await ctx.db.insert('appointmentRefunds', { appointmentId: a._id, amount, currency: a.currency, method: input.method ?? 'unrecorded', reason, effectiveAt, recordedAt: Date.now(), recordedBy: actor, idempotencyKey: key, ...(paymentId ? { paymentId } : {}), ...(orderId ? { orderId } : {}), netBefore: money.net, netAfter });
  await write(ctx, a, { amountPaid: money.gross, amountRefunded: roundMoney(money.refunded + amount), ...(netAfter === 0 ? { paymentStatus: 'refunded', refundedAt: effectiveAt } : {}) }, actor, reason, effectiveAt, [{ field: 'refundId', from: null, to: refundId }, { field: 'refundMethod', from: null, to: input.method ?? 'unrecorded' }, { field: 'refundAmount', from: null, to: amount }]);
  if (orderId) await syncAffiliateCredit(ctx, {orderId}, actor);
  return { refundId, replayed: false };
}

export async function correctAppointmentPayment(ctx: MutationCtx, a: Appointment, input: {
  expectedRevision: number; paymentId: Id<'appointmentPayments'>; idempotencyKey: string; reason: string; action: 'amend' | 'cancel';
  method?: Doc<'appointmentPayments'>['method']; effectiveAt?: number;
}, actor: string) {
  const reason = cleanReason(input.reason)!;
  const key = attemptKey(input.idempotencyKey);
  const requestFingerprint = JSON.stringify({ appointmentId: a._id, paymentId: input.paymentId, action: input.action, reason, method: input.method ?? null, effectiveAt: input.effectiveAt ?? null });
  const replay = await ctx.db.query('appointmentPaymentCorrections').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
  if (replay) {
    if (replay.actor !== actor || replay.requestFingerprint !== requestFingerprint) throw new Error('Correction attempt key was already used for different details');
    return { replayed: true };
  }
  assertFresh(a, input.expectedRevision);
  const data = await rows(ctx, a);
  if (data.orders.length) throw new Error('Correct the tender/date or void an unreceived payment from the original order receipt');
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
