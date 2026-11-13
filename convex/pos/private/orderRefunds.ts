import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { canReadCheckoutOrder, requireCashierAction, type StaffActor } from '../../auth/model';
import { resortTodayIso } from '../../lib/dates';
import { MAX_ORDER_REFUNDS, lineNet } from '../../shared/orderMath';
import { readBudget } from '../../lib/readBudget';
import { syncAffiliateCredit } from '../../marketing/model';
import { appendRecordHistory } from '../../settings/model';
import { activeLineLink } from './lineLinks';

type ReadCtx = QueryCtx | MutationCtx;

export type OrderRefundInput = Pick<Doc<'orderRefunds'>, 'orderId' | 'lineId' | 'amount' | 'currency' | 'method' | 'reason' | 'idempotencyKey'>;

function fail(code: string, message: string): never { throw new ConvexError({ code, message }); }

/** Never silently truncate money. Complete older history remains available through pagination. */
export async function orderRefunds(ctx: ReadCtx, orderId: Id<'orders'>, allowTruncated = false) {
  const rows = await ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId)).order('desc').take(MAX_ORDER_REFUNDS + 1);
  if (!allowTruncated && rows.length > MAX_ORDER_REFUNDS) fail('REFUND_HISTORY_LIMIT', 'Too many refunds on this order. Contact support.');
  return rows.reverse();
}

/** Indexed, bounded per order and across all rows of a list invocation. */
export async function orderRefundTotal(ctx: ReadCtx, orderId: Id<'orders'>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  let count = 0;
  let total = 0;
  for await (const row of ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId))) {
    budget.document(row);
    budget.assert();
    if (++count > MAX_ORDER_REFUNDS) fail('REFUND_HISTORY_LIMIT', 'Too many refunds on this order. Contact support.');
    total += row.amount;
  }
  return total;
}

export function orderRefundView(row: Doc<'orderRefunds'>) {
  return {
    _id: row._id, _creationTime: row._creationTime, orderId: row.orderId, lineId: row.lineId, amount: row.amount,
    currency: row.currency, method: row.method, reason: row.reason, idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt, createdByEmail: row.createdByEmail, businessDate: row.businessDate,
  };
}

/** Attached and allocated rows use their source's finance controls. */
export function isWalkInLine(line: Doc<'orderLines'>) {
  return !line.bookingId && !line.appointmentId && line.kind !== 'booking' && line.kind !== 'appointment';
}

export async function assertNoPosRefunds(ctx: ReadCtx, orderId: Id<'orders'>) {
  if (await ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId)).first())
    fail('ORDER_HAS_REFUNDS', 'This order has recorded refunds and cannot be voided. Refund the remaining walk-in lines instead.');
}

export async function assertLineHasNoPosRefunds(ctx: ReadCtx, lineId: Id<'orderLines'>) {
  if (await ctx.db.query('orderRefunds').withIndex('by_lineId', q => q.eq('lineId', lineId)).first())
    fail('LINE_HAS_REFUNDS', 'A refunded line cannot be allocated to a stay or appointment.');
}

function cleanInput(input: OrderRefundInput): OrderRefundInput {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) fail('INVALID_REFUND_AMOUNT', 'Refund must be a positive integer in satang.');
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) fail('INVALID_REFUND_REASON', 'Give a refund reason of 1–500 characters.');
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) fail('INVALID_IDEMPOTENCY_KEY', 'Use an attempt key of 8–100 characters.');
  return { orderId: input.orderId, lineId: input.lineId, amount: input.amount, currency: input.currency, method: input.method, reason, idempotencyKey };
}

/** Preview and execution re-read the same cap. The mutation's index reads serialize competing returns. */
export async function refundState(ctx: ReadCtx, input: OrderRefundInput) {
  const args = cleanInput(input);
  const order = await ctx.db.get(args.orderId);
  if (!order || order.status !== 'paid' || order.paidAt === undefined || order.voidUnreceived)
    fail('ORDER_NOT_PAID', 'Only a paid, settled order can be refunded.');
  const line = await ctx.db.get(args.lineId);
  if (!line || line.orderId !== order._id || !isWalkInLine(line) || await activeLineLink(ctx, line._id))
    fail('LINE_NOT_REFUNDABLE', 'Use the stay or appointment refund flow for attached lines; choose a walk-in line on this order.');
  if (args.currency !== line.currency || args.currency !== order.currency) fail('REFUND_CURRENCY_MISMATCH', `Refund currency must be ${order.currency}.`);
  const refunds = await orderRefunds(ctx, order._id);
  const refunded = refunds.filter(row => row.lineId === line._id).reduce((sum, row) => sum + row.amount, 0);
  const remaining = Math.max(0, lineNet(line) - refunded);
  if (args.amount > remaining) throw new ConvexError({ code: 'REFUND_EXCEEDS_REMAINING', message: `At most ${remaining} satang remains refundable.`, remaining });
  if (refunds.length >= MAX_ORDER_REFUNDS) fail('REFUND_HISTORY_LIMIT', 'Too many refunds on this order. Contact support.');
  return { args, order, line, refunds, remaining };
}

/** Shared by direct checkout and manager approval; no payment provider is called. */
export async function executeOrderRefund(ctx: MutationCtx, input: OrderRefundInput, actor: StaffActor) {
  const args = cleanInput(input);
  const order = await ctx.db.get(args.orderId);
  if (!order || !canReadCheckoutOrder(actor, order)) fail('ORDER_NOT_FOUND', 'Order not found.');
  const existing = await ctx.db.query('orderRefunds').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', args.idempotencyKey)).unique();
  if (existing) {
    if (existing.orderId !== args.orderId || existing.lineId !== args.lineId || existing.amount !== args.amount || existing.currency !== args.currency || existing.method !== args.method || existing.reason !== args.reason)
      fail('IDEMPOTENCY_CONFLICT', 'This refund key was already used for different details.');
    return { refund: orderRefundView(existing), replayed: true };
  }
  await requireCashierAction(ctx, actor, 'refund');
  const state = await refundState(ctx, args);
  const now = Date.now();
  const refundId = await ctx.db.insert('orderRefunds', { ...args, createdBy: actor.tokenIdentifier, createdByEmail: actor.email, createdAt: now, businessDate: resortTodayIso(now) });
  await ctx.db.patch(order._id, { revision: order.revision + 1, correctionRevision: (order.correctionRevision ?? 0) + 1, updatedAt: now });
  await ctx.db.insert('orderAudit', { orderId: order._id, lineId: args.lineId, at: now, actor: actor.email, kind: 'refund',
    note: `${state.line.name}: ${args.amount / 100} ${args.currency} returned (${args.method}). ${args.reason}`,
    fromPrice: state.remaining, toPrice: state.remaining - args.amount });
  await appendRecordHistory(ctx, { entityType: 'order', entityId: order._id, actor: actor.email, kind: 'refund', reason: args.reason,
    after: { refundId, lineId: args.lineId, amount: args.amount, currency: args.currency, method: args.method, businessDate: resortTodayIso(now) } });
  await syncAffiliateCredit(ctx, { orderId: order._id }, actor.email);
  return { refund: orderRefundView((await ctx.db.get(refundId))!), replayed: false };
}
