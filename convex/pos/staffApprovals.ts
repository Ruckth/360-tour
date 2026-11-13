import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { authenticatedMutation, canReadCheckoutOrder, internalMutation, type MutationCtx, requireCashierAction, staffMutation, staffQuery } from '../auth/model';
import { appendRecordHistory } from '../settings/model';
import { cashierRules } from '../settings/model';
import { effectiveRequestStatus, orderFingerprint, requesterFingerprint, rulesFingerprint } from '../lib/staffApprovalState';
import { APPROVAL_TTL_MS, approvalPayload } from '../lib/staffTypes';
import { executeStaffApproval, previewStaffApproval } from './private/approvalModel';

function cleanReason(reason: string) {
  const value = reason.trim();
  if (!value || value.length > 500) throw new ConvexError('Give a reason of 1–500 characters.');
  return value;
}

/** Identity tokens and raw fingerprints never leave the backend. */
function requestView(request: Doc<'staffApprovalRequests'>, status: Doc<'staffApprovalRequests'>['status']) {
  return {
    _id: request._id, _creationTime: request._creationTime,
    orderId: request.orderId, lineId: request.lineId, kind: request.kind, payload: request.payload,
    reason: request.reason, requesterEmail: request.requesterEmail, approverEmail: request.approverEmail,
    orderRevision: request.orderRevision, rulesRevision: request.rulesRevision, status,
    createdAt: request.createdAt, expiresAt: request.expiresAt, resolvedAt: request.resolvedAt,
    resolutionReason: request.resolutionReason, amount: request.amount, percent: request.percent,
    totalBefore: request.totalBefore, totalAfter: request.totalAfter,
  };
}

async function resolve(ctx: MutationCtx, request: Doc<'staffApprovalRequests'>, status: Doc<'staffApprovalRequests'>['status'], actor: string, reason?: string) {
  await ctx.db.patch(request._id, { status, resolvedAt: Date.now(), ...(reason ? { resolutionReason: reason } : {}) });
  await appendRecordHistory(ctx, { entityType: 'staffApproval', entityId: request.orderId, actor, kind: status, reason: reason ?? request.reason,
    after: { requestId: request._id, kind: request.kind, requesterEmail: request.requesterEmail, payload: request.payload } });
}

export const create = staffMutation({
  capability: 'checkout', args: { orderId: v.id('orders'), payload: approvalPayload, reason: v.string() }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  if (actor.role !== 'cashier') throw new ConvexError('Only cashiers request manager approval.');
  if (args.payload.kind === 'paymentFix' && ['linkPaidLine', 'unlinkPaidLine'].includes(args.payload.action)) await requireCashierAction(ctx, actor, 'paymentFix');
  const reason = cleanReason(args.reason);
  const order = await ctx.db.get(args.orderId);
  if (!order || !canReadCheckoutOrder(actor, order)) throw new ConvexError('Order not found');
  const pending = await ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_status', q => q.eq('orderId', order._id).eq('status', 'pending')).take(201);
  if (pending.length > 200) throw new ConvexError('Too many unresolved requests. Ask a manager to resolve them.');
  for (const request of pending) {
    const status = await effectiveRequestStatus(ctx, request);
    if (status === 'pending') throw new ConvexError({ code: 'PENDING_APPROVAL', message: 'Resolve the existing request first.', requestId: request._id });
    await resolve(ctx, request, status, actor.email);
  }
  const preview = await previewStaffApproval(ctx, order, args.payload);
  const rules = await cashierRules(ctx);
  const requester = await requesterFingerprint(ctx, actor.email, actor.tokenIdentifier);
  const createdAt = Date.now();
  const requestId = await ctx.db.insert('staffApprovalRequests', {
    orderId: order._id, ...('lineId' in args.payload ? { lineId: args.payload.lineId } : {}), kind: args.payload.kind, payload: args.payload, reason,
    requesterEmail: actor.email, requesterTokenIdentifier: actor.tokenIdentifier, requesterAccessFingerprint: requester.fingerprint,
    orderFingerprint: await orderFingerprint(ctx, order._id, args.payload), orderRevision: order.revision, rulesRevision: rules.revision, rulesFingerprint: rulesFingerprint(rules),
    status: 'pending', createdAt, expiresAt: createdAt + APPROVAL_TTL_MS, ...preview,
  });
  await appendRecordHistory(ctx, { entityType: 'staffApproval', entityId: order._id, actor: actor.email, kind: 'requested', reason,
    after: { requestId, payload: args.payload, ...preview } });
  await ctx.scheduler.runAfter(APPROVAL_TTL_MS, internal.pos.staffApprovals.expire, { requestId });
  return { requestId, status: 'pending' as const, expiresAt: createdAt + APPROVAL_TTL_MS, ...preview };
} });

export const approve = staffMutation({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new ConvexError('Request not found');
  if (request.requesterTokenIdentifier === actor.tokenIdentifier || request.requesterEmail === actor.email) throw new ConvexError('You cannot approve your own request.');
  if (request.status !== 'pending') return { status: request.status, replayed: true };
  const status = await effectiveRequestStatus(ctx, request);
  if (status !== 'pending') {
    await resolve(ctx, request, status, actor.email);
    return { status, replayed: false };
  }
  // All writes, audit rows and the terminal status commit together; a thrown validation rolls all back.
  await executeStaffApproval(ctx, request, actor);
  await ctx.db.patch(request._id, { approverEmail: actor.email, approverTokenIdentifier: actor.tokenIdentifier });
  await resolve(ctx, request, 'applied', actor.email);
  return { status: 'applied' as const, replayed: false };
} });

export const cancel = authenticatedMutation({ args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, args) => {
  const identity = ctx.identity;
  if (!identity) throw new Error('Not authenticated');
  const request = await ctx.db.get(args.requestId);
  if (!request || request.requesterTokenIdentifier !== identity.tokenIdentifier) throw new Error('Not authorized');
  if (request.status !== 'pending') return { status: request.status };
  const status = await effectiveRequestStatus(ctx, request);
  const next = status === 'pending' ? 'cancelled' : status;
  await resolve(ctx, request, next, identity.email ?? request.requesterEmail);
  return { status: next };
} });

export const reject = staffMutation({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests'), reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new ConvexError('Request not found');
  if (request.status !== 'pending') return { status: request.status };
  const status = await effectiveRequestStatus(ctx, request);
  const next = status === 'pending' ? 'rejected' : status;
  await resolve(ctx, request, next, actor.email, args.reason === undefined ? undefined : cleanReason(args.reason));
  return { status: next };
} });

export const forOrder = staffQuery({
  capability: 'checkout', args: { orderId: v.id('orders') }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  if (actor.role === 'cashier' && !canReadCheckoutOrder(actor, await ctx.db.get(args.orderId))) throw new ConvexError('Order not found');
  const [recent, pending] = await Promise.all([
    ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_createdAt', q => q.eq('orderId', args.orderId)).order('desc').take(50),
    ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_status', q => q.eq('orderId', args.orderId).eq('status', 'pending')).take(201),
  ]);
  if (pending.length > 200) throw new ConvexError('Too many unresolved requests. Ask a manager to resolve them.');
  const requests = [...new Map([...pending, ...recent].map(request => [request._id, request])).values()];
  return await Promise.all(requests.sort((a, b) => b.createdAt - a.createdAt).map(async request => requestView(request, await effectiveRequestStatus(ctx, request))));
} });

export const pending = staffQuery({
  capability: 'approve', args: {}, handler: async ctx => {
  const requests = await ctx.db.query('staffApprovalRequests').withIndex('by_status_and_createdAt', q => q.eq('status', 'pending')).take(501);
  if (requests.length > 500) throw new ConvexError('Approval queue is too large. Contact support.');
  const views = await Promise.all(requests.map(async request => {
    const status = await effectiveRequestStatus(ctx, request);
    return status === 'pending' ? requestView(request, status) : null;
  }));
  const list = views.filter(row => row !== null);
  return { count: list.length, list };
} });

export const expire = internalMutation({ args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, args) => {
  const request = await ctx.db.get(args.requestId);
  if (!request || request.status !== 'pending') return null;
  const status = await effectiveRequestStatus(ctx, request);
  if (status !== 'pending') await resolve(ctx, request, status, 'system');
  return null;
} });
