import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import { canReadCheckoutOrder, internalMutation, type MutationCtx, requireCashierAction, staffMutation, staffQuery } from '../auth/model';
import { readBudget, reserveWrites } from '../lib/readBudget';
import { appendRecordHistory, cashierRules } from '../settings/model';
import {
  adjustmentApprovalDetail, canReviewApproval, checkoutApprovalDetail, effectiveRequestStatus, isCheckoutApproval, isOwnApproval,
  orderFingerprint, ownApprovalStatus, readApprovalDocument, requesterFingerprint, returnApprovalDetail, rulesFingerprint,
  type ApprovalRequest, type CheckoutApprovalRequest,
} from './private/staffApprovalState';
import { APPROVAL_TTL_MS, approvalPayload } from '../shared/staffTypes';
import { executeStaffApproval, previewStaffApproval } from './private/approvalModel';

function cleanReason(reason: string) {
  const value = reason.trim();
  if (!value || value.length > 500) throw new ConvexError('Give a reason of 1–500 characters.');
  return value;
}

/** Identity tokens and raw fingerprints never leave the backend. */
function requestView(request: CheckoutApprovalRequest, status: CheckoutApprovalRequest['status']) {
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

async function resolve(ctx: MutationCtx, request: CheckoutApprovalRequest, status: CheckoutApprovalRequest['status'], actor: string, reason?: string) {
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
  for (const request of pending.filter(isCheckoutApproval)) {
    const status = await effectiveRequestStatus(ctx, request);
    if (status === 'pending') throw new ConvexError({ code: 'PENDING_APPROVAL', message: 'Resolve the existing request first.', requestId: request._id });
    await resolve(ctx, request, status, actor.email);
  }
  const preview = await previewStaffApproval(ctx, order, args.payload);
  const rules = await cashierRules(ctx);
  const requester = await requesterFingerprint(ctx, actor.tokenIdentifier);
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
  if (isOwnApproval(actor, request)) throw new ConvexError('You cannot approve your own request.');
  if (!canReviewApproval(actor, request) || !isCheckoutApproval(request)) throw new ConvexError('Request not found');
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

export const cancel = staffMutation({ capability: 'checkout', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const request = await ctx.db.get(args.requestId);
  if (!request || !isCheckoutApproval(request) || request.requesterTokenIdentifier !== actor.tokenIdentifier) throw new Error('Not authorized');
  if (request.status !== 'pending') return { status: request.status };
  const status = await effectiveRequestStatus(ctx, request);
  const next = status === 'pending' ? 'cancelled' : status;
  await resolve(ctx, request, next, actor.email);
  return { status: next };
} });

export const reject = staffMutation({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests'), reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const request = await ctx.db.get(args.requestId);
  if (!request || !canReviewApproval(actor, request) || !isCheckoutApproval(request)) throw new ConvexError('Request not found');
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
  return await Promise.all(requests.sort((a, b) => b.createdAt - a.createdAt).filter(isCheckoutApproval).map(async request => requestView(request, await effectiveRequestStatus(ctx, request))));
} });

const APPROVAL_PAGE_SIZE = 20;

/** First page in the original checkout response shape. ApprovalsPanel uses pendingPage after cutover. */
export const pending = staffQuery({
  capability: 'approve', args: {}, handler: async ctx => {
  const budget = readBudget(ctx);
  budget.range();
  const requests = await ctx.db.query('staffApprovalRequests').withIndex('by_status_and_createdAt', q => q.eq('status', 'pending')).take(APPROVAL_PAGE_SIZE);
  for (const request of requests) budget.document(request);
  budget.assert();
  const views = await Promise.all(requests.filter(isCheckoutApproval).filter(request => canReviewApproval(ctx.staff, request)).map(async request => {
    const status = await effectiveRequestStatus(ctx, request);
    return status === 'pending' ? requestView(request, status) : null;
  }));
  const list = views.filter(row => row !== null);
  return { count: list.length, list };
} });

function queueRow(request: ApprovalRequest) {
  const common = {
    _id: request._id, requesterEmail: request.requesterEmail,
    createdAt: request.createdAt, expiresAt: request.expiresAt, status: 'pending' as const,
  };
  if (request.kind === 'adjustment') {
    const { target, adjustmentKind } = request.payload;
    return { ...common, kind: request.kind, target, label: target.targetType, summary: { adjustmentKind } };
  }
  const { orderId, lineId, amount, percent, kind } = request;
  if (kind === 'returnItems') {
    return { ...common, kind, orderId, lineId, label: kind, summary: { amount, partCount: request.payload.parts.length } };
  }
  const label = request.payload.kind === 'customPrice' && request.payload.action === 'addCustomItem'
    ? request.payload.name.slice(0, 160) : kind;
  return { ...common, kind, orderId, lineId, label, summary: { amount, percent } };
}

export const pendingPage = staffQuery({
  capability: 'approve', args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, { paginationOpts }) => {
    const { numItems, cursor, endCursor } = paginationOpts;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > APPROVAL_PAGE_SIZE) {
      throw new ConvexError('Approval page size must be 1–20.');
    }
    const budget = readBudget(ctx);
    budget.range();
    const result = await ctx.db.query('staffApprovalRequests')
      .withIndex('by_status_and_createdAt', q => q.eq('status', 'pending')).order('desc')
      .paginate({ numItems, cursor, endCursor, maximumRowsRead: APPROVAL_PAGE_SIZE + 1, maximumBytesRead: 512 * 1024 });
    const now = Date.now();
    for (const request of result.page) budget.document(request);
    budget.assert();
    return {
      ...result,
      page: result.page.filter(request => request.expiresAt > now && canReviewApproval(ctx.staff, request)).map(queueRow),
    };
  },
});

export const detail = staffQuery({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, { requestId }) => {
    const request = await readApprovalDocument(ctx, () => ctx.db.get(requestId));
    if (!request || !canReviewApproval(ctx.staff, request)) return null;
    if (request.kind === 'adjustment') {
      const { target, adjustmentKind, input, reasonCode } = request.payload;
      return {
        kind: request.kind,
        ...(await adjustmentApprovalDetail(ctx, ctx.staff, request, true)),
        request: { _id: request._id, requesterEmail: request.requesterEmail, createdAt: request.createdAt, expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt, approverEmail: request.approverEmail, reason: request.reason,
          payload: { target, adjustmentKind, input, reasonCode },
        },
      };
    }
    if (request.kind === 'returnItems') {
      return {
        kind: request.kind,
        ...(await returnApprovalDetail(ctx, ctx.staff, request, true)),
        request: { _id: request._id, requesterEmail: request.requesterEmail, createdAt: request.createdAt, expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt, approverEmail: request.approverEmail, reason: request.reason, parts: request.payload.parts.slice(0, 20),
          orderId: request.orderId, amount: request.amount, totalBefore: request.totalBefore, totalAfter: request.totalAfter,
        },
      };
    }
    const detail = await checkoutApprovalDetail(ctx, request);
    return { ...detail, kind: request.kind, request: requestView(request, detail.status) };
  },
});

export const myStatus = staffQuery({
  capability: 'checkout', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, { requestId }) => {
    const request = await readApprovalDocument(ctx, () => ctx.db.get(requestId));
    if (!request || request.requesterTokenIdentifier !== ctx.staff.tokenIdentifier) return null;
    return {
      requestId, kind: request.kind, status: await ownApprovalStatus(ctx, ctx.staff, request),
      expiresAt: request.expiresAt, resolvedAt: request.resolvedAt, resolutionReason: request.resolutionReason,
    };
  },
});

async function expireRequest(ctx: MutationCtx, request: ApprovalRequest, now: number) {
  if (request.status !== 'pending' || request.expiresAt > now) return;
  if (isCheckoutApproval(request)) {
    reserveWrites(ctx, 2);
    await resolve(ctx, request, 'expired', 'system');
  } else {
    reserveWrites(ctx, 1);
    await ctx.db.patch(request._id, { status: 'expired', resolvedAt: now });
  }
}

export const expire = internalMutation({ args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, args) => {
  const request = await readApprovalDocument(ctx, () => ctx.db.get(args.requestId));
  if (request) await expireRequest(ctx, request, Date.now());
  return null;
} });

// Reap pending requests without a per-request timer, including adjustment requests from the checkpoint writer.
export const expirePending = internalMutation({
  args: { cursor: v.optional(v.string()), cutoff: v.optional(v.number()) }, handler: async (ctx, { cursor, cutoff }) => {
    const now = Date.now();
    const through = cutoff ?? now - APPROVAL_TTL_MS;
    const budget = readBudget(ctx);
    budget.range();
    const { page, isDone, continueCursor } = await ctx.db.query('staffApprovalRequests')
      .withIndex('by_status_and_createdAt', q => q.eq('status', 'pending').lte('createdAt', through))
      .paginate({ numItems: 100, cursor: cursor ?? null, maximumRowsRead: 101, maximumBytesRead: 2 * 1024 * 1024 });
    for (const request of page) budget.document(request);
    budget.assert();
    for (const request of page) await expireRequest(ctx, request, now);
    if (!isDone) await ctx.scheduler.runAfter(0, internal.pos.staffApprovals.expirePending, { cursor: continueCursor, cutoff: through });
    return null;
  },
});
