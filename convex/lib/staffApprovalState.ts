import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { accessForIdentity, cashierRules } from './staffAccess';
import { orderLines } from './orderLines';
import { orderLineLinks } from './lineLinks';
import { resortTodayIso } from './dates';

/** Stable serialization includes optional fields, revisions, coupons and source records. */
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
type ReadCtx = MutationCtx | QueryCtx;
export async function requesterFingerprint(ctx: ReadCtx, email: string, tokenIdentifier: string) {
  const access = await accessForIdentity(ctx, { email, tokenIdentifier });
  const grant = await ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier)).unique();
  return { role: access.role, fingerprint: canonical({ role: access.role, grant }) };
}
/** Extra targets matter too: paid-link targets and amended customer revisions are checked before execution. */
export async function orderFingerprint(ctx: ReadCtx, orderId: Id<'bills'>, payload: Doc<'staffApprovalRequests'>['payload']) {
  const order = await ctx.db.get(orderId);
  const lines = await orderLines(ctx, orderId);
  const links = await orderLineLinks(ctx, orderId);
  const bookingIds = new Set(lines.flatMap(line => line.bookingId ? [line.bookingId] : []));
  const appointmentIds = new Set(lines.flatMap(line => line.appointmentId ? [line.appointmentId] : []));
  for (const line of lines) if (line.feeAppointmentId) appointmentIds.add(line.feeAppointmentId);
  for (const link of links) {
    if (link.bookingId) bookingIds.add(link.bookingId);
    if (link.appointmentId) appointmentIds.add(link.appointmentId);
  }
  if ((payload.kind === 'paymentFix' && payload.action === 'linkPaidLine') || (payload.kind === 'customPrice' && payload.action === 'attachSource')) {
    if (payload.bookingId) bookingIds.add(payload.bookingId);
    if (payload.appointmentId) appointmentIds.add(payload.appointmentId);
  }
  const customerId = payload.kind === 'paymentFix' && payload.action === 'amendOrderPayment' ? payload.customer?.customerId : order?.customerId;
  const coupon = order?.promotion ? await ctx.db.get(order.promotion.couponId) : null;
  const couponHistory = coupon ? await ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'coupon').eq('entityId', coupon._id)).order('desc').first() : null;
  return canonical({ order, lines, links, coupon, couponHistoryId: couponHistory?._id, businessDate: resortTodayIso(),
    bookings: await Promise.all([...bookingIds].sort().map(id => ctx.db.get(id))),
    appointments: await Promise.all([...appointmentIds].sort().map(id => ctx.db.get(id))),
    customer: customerId ? await ctx.db.get(customerId) : null,
  });
}
/** Queries expose the effective terminal status immediately; mutations persist it when touched. */
export async function effectiveRequestStatus(ctx: ReadCtx, request: Doc<'staffApprovalRequests'>): Promise<Doc<'staffApprovalRequests'>['status']> {
  if (request.status !== 'pending') return request.status;
  if (Date.now() >= request.expiresAt) return 'expired';
  const [rules, requester] = await Promise.all([
    cashierRules(ctx), requesterFingerprint(ctx, request.requesterEmail, request.requesterTokenIdentifier),
  ]);
  if (rules.revision !== request.rulesRevision || requester.role !== 'cashier' || requester.fingerprint !== request.requesterAccessFingerprint) return 'stale';
  if (await orderFingerprint(ctx, request.orderId, request.payload) !== request.orderFingerprint) return 'stale';
  return 'pending';
}
export async function assertNoPendingApprovals(ctx: MutationCtx, orderId: Id<'bills'>) {
  const requests = await ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_status', q => q.eq('orderId', orderId).eq('status', 'pending')).take(201);
  if (requests.length > 200) throw new ConvexError('Too many unresolved requests. Ask a manager to resolve them.');
  for (const request of requests) {
    if (await effectiveRequestStatus(ctx, request) === 'pending') throw new ConvexError({ code: 'PENDING_APPROVAL', message: 'Resolve the manager request before taking payment.', requestId: request._id });
  }
}
