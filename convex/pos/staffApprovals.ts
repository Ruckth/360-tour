import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import { canAccessCheckoutOrderBranch, canReadCheckoutOrder, internalMutation, type MutationCtx, requireCashierAction, staffMutation, staffQuery, type StaffActor } from '../auth/model';
import { readBudget, reserveWrites } from '../lib/readBudget';
import { appendRecordHistory, cashierRules } from '../settings/model';
import {
  adjustmentApprovalDetail, approvalPageWindow, canReviewApproval, checkoutApprovalDetail, effectiveRequestStatus, isCheckoutApproval, isOwnApproval,
  orderFingerprint, ownApprovalStatus, pendingReturnSummary, readApprovalDocument, requesterFingerprint, returnApprovalDetail, rulesFingerprint,
  type ApprovalRequest, type CheckoutApprovalRequest, verifiedQueueStatus,
} from './private/staffApprovalState';
import { APPROVAL_TTL_MS, approvalPayload } from '../shared/staffTypes';
import { executeStaffApproval, previewStaffApproval } from './private/approvalModel';
import { checkoutApprovalKind } from './validators';
import { assertReceiptCorrectionSupported, openOrderReturn, readOrderProjection } from './private/orderLifecycle';
import { orderTitle } from '../shared/orderMath';
import { resortTodayIso } from '../shared/time';

function cleanReason(reason: string) {
  const value = reason.trim();
  if (!value || value.length > 500) throw new ConvexError('Give a reason of 1–500 characters.');
  return value;
}

function canAccessApprovalBranch(actor: StaffActor, request: ApprovalRequest) {
  return request.kind === 'adjustment' || canAccessCheckoutOrderBranch(actor, request);
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
    orderId: order._id, orderNumberAtRequest: order.orderNumber, stockBranchId: order.stockBranchId, ...('lineId' in args.payload ? { lineId: args.payload.lineId } : {}), kind: args.payload.kind, payload: args.payload, reason,
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
  if (!canReviewApproval(actor, request) || !isCheckoutApproval(request) || !canAccessApprovalBranch(actor, request)) {
    throw new ConvexError('Request not found');
  }
  if (request.status !== 'pending') return { status: request.status, replayed: true };
  if (request.payload.kind === 'voidPaidSale' && Date.now() < request.expiresAt) {
    const order = await readApprovalDocument(ctx, () => ctx.db.get(request.orderId));
    if (order?.status === 'paid') await assertReceiptCorrectionSupported(ctx, order);
  }
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
  if (!request || !isCheckoutApproval(request) || request.requesterTokenIdentifier !== actor.tokenIdentifier ||
      !canAccessApprovalBranch(actor, request)) throw new Error('Not authorized');
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
  if (!request || !canReviewApproval(actor, request) || !isCheckoutApproval(request) ||
      !canAccessApprovalBranch(actor, request)) throw new ConvexError('Request not found');
  if (request.status !== 'pending') return { status: request.status };
  const status = await effectiveRequestStatus(ctx, request);
  const next = status === 'pending' ? 'rejected' : status;
  await resolve(ctx, request, next, actor.email, args.reason === undefined ? undefined : cleanReason(args.reason));
  return { status: next };
} });

export const forOrder = staffQuery({
  capability: 'checkout', args: { orderId: v.id('orders') }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const order = await readOrderProjection(ctx, () => ctx.db.get(args.orderId));
  if (!order || !canAccessCheckoutOrderBranch(actor, order)) throw new ConvexError('Order not found');
  if (!canReadCheckoutOrder(actor, order)) {
    const active = order.status === 'paid' ? await openOrderReturn(ctx, order._id) : null;
    if (active?.operator !== actor.tokenIdentifier) throw new ConvexError('Order not found');
    // This receipt subscription lists checkout approvals. Return recovery has its own approval state.
    return [];
  }
  const [recent, pending] = await Promise.all([
    ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_createdAt', q => q.eq('orderId', args.orderId)).order('desc').take(50),
    ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_status', q => q.eq('orderId', args.orderId).eq('status', 'pending')).take(201),
  ]);
  if (pending.length > 200) throw new ConvexError('Too many unresolved requests. Ask a manager to resolve them.');
  const requests = [...new Map([...pending, ...recent].map(request => [request._id, request])).values()];
  return await Promise.all(requests.sort((a, b) => b.createdAt - a.createdAt).filter(isCheckoutApproval).map(async request => requestView(request, await effectiveRequestStatus(ctx, request))));
} });

const APPROVAL_PAGE_SIZE = 20;
const MAX_COMPATIBILITY_QUEUE_ROWS = 500;

// Merge the five checkout-only ranges in expiry order. Each cursor reads at most one row ahead.
async function* pendingCheckoutRequests(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  const now = Date.now();
  const read = async (cursor: AsyncIterator<ApprovalRequest>) => {
    const result = await cursor.next();
    if (result.done) return null;
    budget.document(result.value);
    budget.assert();
    return result.value;
  };
  const sources = await Promise.all(checkoutApprovalKind.members.map(async ({ value: kind }) => {
    budget.range();
    const cursor = ctx.db.query('staffApprovalRequests')
      .withIndex('by_status_and_kind_and_expiresAt', q => q.eq('status', 'pending').eq('kind', kind).gt('expiresAt', now))
      [Symbol.asyncIterator]();
    return { cursor, row: await read(cursor) };
  }));
  try {
    for (let scanned = 0; scanned < MAX_COMPATIBILITY_QUEUE_ROWS; scanned++) {
      sources.sort((a, b) => (a.row?.expiresAt ?? Infinity) - (b.row?.expiresAt ?? Infinity));
      const source = sources[0];
      if (!source.row) break;
      yield source.row;
      if (scanned + 1 < MAX_COMPATIBILITY_QUEUE_ROWS) source.row = await read(source.cursor);
    }
  } finally {
    await Promise.all(sources.filter(source => source.row !== null).map(source => source.cursor.return?.()));
  }
}

/** First page in the original checkout response shape. ApprovalsPanel uses pendingPage after cutover. */
export const pending = staffQuery({
  capability: 'approve', args: {}, handler: async ctx => {
  const list: ReturnType<typeof requestView>[] = [];
  let rules: Awaited<ReturnType<typeof cashierRules>> | undefined;
  for await (const request of pendingCheckoutRequests(ctx)) {
    if (isCheckoutApproval(request) && canReviewApproval(ctx.staff, request) && canAccessApprovalBranch(ctx.staff, request)) {
      rules ??= await readApprovalDocument(ctx, () => cashierRules(ctx));
      if (await effectiveRequestStatus(ctx, request, rules) === 'pending') list.push(requestView(request, 'pending'));
    }
    if (list.length === APPROVAL_PAGE_SIZE) break;
  }
  return { count: list.length, list };
} });

function queueRow(request: ApprovalRequest, actionable: boolean) {
  const common = {
    _id: request._id, requesterEmail: request.requesterEmail,
    createdAt: request.createdAt, expiresAt: request.expiresAt, status: 'pending' as const, actionable,
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
  return { ...common, kind, orderId, lineId, label, orderTitle: request.orderNumberAtRequest === undefined ? undefined : orderTitle(request.orderNumberAtRequest), summary: { amount, percent } };
}

async function queueRows(ctx: QueryCtx, requests: ApprovalRequest[]) {
  const rules = requests.some(isCheckoutApproval) ? await readApprovalDocument(ctx, () => cashierRules(ctx)) : null;
  const fingerprint = rules && rulesFingerprint(rules);
  const today = resortTodayIso();
  return requests.map(request => queueRow(request, !isCheckoutApproval(request) || (
    request.rulesRevision === rules?.revision && request.rulesFingerprint === fingerprint && resortTodayIso(request.createdAt) === today
  )));
}

export const pendingPage = staffQuery({
  capability: 'approve', args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, { paginationOpts }) => {
    const { numItems, cursor, endCursor } = paginationOpts;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > APPROVAL_PAGE_SIZE) {
      throw new ConvexError('Approval page size must be 1–20.');
    }
    const budget = readBudget(ctx);
    budget.range();
    const now = Date.now();
    const window = approvalPageWindow(cursor, endCursor, now);
    const result = await ctx.db.query('staffApprovalRequests')
      .withIndex('by_status_and_expiresAt', q => q.eq('status', 'pending').gt('expiresAt', window.cutoff)).order('desc')
      .paginate({ numItems, cursor: window.cursor, endCursor: window.endCursor, maximumRowsRead: APPROVAL_PAGE_SIZE + 1, maximumBytesRead: 512 * 1024 });
    for (const request of result.page) budget.document(request);
    budget.assert();
    const screened = result.page.filter(request => request.expiresAt > now &&
      canReviewApproval(ctx.staff, request) && canAccessApprovalBranch(ctx.staff, request));
    return {
      ...result,
      page: await queueRows(ctx, screened),
      continueCursor: window.wrap(result.continueCursor),
      ...(result.splitCursor ? { splitCursor: window.wrap(result.splitCursor) } : {}),
    };
  },
});

/** Independent subscriptions keep each revision check within the existing detail read budget. */
export const queueStatus = staffQuery({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, { requestId }) => {
    const request = await readApprovalDocument(ctx, () => ctx.db.get(requestId));
    if (!request || !canReviewApproval(ctx.staff, request) || !canAccessApprovalBranch(ctx.staff, request)) return null;
    return await verifiedQueueStatus(ctx, ctx.staff, request);
  },
});

/** Newest expired requests. Includes records whose scheduled expiry has not committed yet. */
export const recentExpired = staffQuery({
  capability: 'approve', args: {}, handler: async (ctx) => {
    const now = Date.now();
    const budget = readBudget(ctx);
    const candidates = await Promise.all((['expired', 'pending'] as const).map(async status => {
      budget.range();
      const rows = await ctx.db.query('staffApprovalRequests')
        .withIndex('by_status_and_expiresAt', q => q.eq('status', status).lte('expiresAt', now))
        .order('desc').take(APPROVAL_PAGE_SIZE);
      for (const row of rows) budget.document(row);
      budget.assert();
      return rows;
    }));
    return candidates.flat()
      .filter(request => canReviewApproval(ctx.staff, request) && canAccessApprovalBranch(ctx.staff, request))
      .sort((a, b) => b.expiresAt - a.expiresAt).slice(0, APPROVAL_PAGE_SIZE)
      .map(request => ({ ...queueRow(request, false), status: 'expired' as const }));
  },
});

export const detail = staffQuery({
  capability: 'approve', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, { requestId }) => {
    const request = await readApprovalDocument(ctx, () => ctx.db.get(requestId));
    if (!request || !canReviewApproval(ctx.staff, request) || !canAccessApprovalBranch(ctx.staff, request)) return null;
    if (request.kind === 'adjustment') {
      const { target, adjustmentKind, input, reasonCode } = request.payload;
      return {
        kind: request.kind,
        ...(await adjustmentApprovalDetail(ctx, ctx.staff.accessReads, request, true)),
        request: { _id: request._id, requesterEmail: request.requesterEmail, createdAt: request.createdAt, expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt, approverEmail: request.approverEmail, reason: request.reason,
          payload: { target, adjustmentKind, input, reasonCode },
        },
      };
    }
    if (request.kind === 'returnItems') {
      return {
        kind: request.kind,
        ...(await returnApprovalDetail(ctx, ctx.staff.accessReads, request, true)),
        request: { _id: request._id, requesterEmail: request.requesterEmail, createdAt: request.createdAt, expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt, approverEmail: request.approverEmail, reason: request.reason, parts: request.payload.parts.slice(0, 20),
          orderId: request.orderId, amount: request.amount, totalBefore: request.totalBefore, totalAfter: request.totalAfter,
        },
      };
    }
    const detail = await checkoutApprovalDetail(ctx, request, ctx.staff);
    return detail && { ...detail, kind: request.kind, request: requestView(request, detail.status) };
  },
});

export const myStatus = staffQuery({
  capability: 'checkout', args: { requestId: v.id('staffApprovalRequests') }, handler: async (ctx, { requestId }) => {
    const request = await readApprovalDocument(ctx, () => ctx.db.get(requestId));
    if (!request || request.requesterTokenIdentifier !== ctx.staff.tokenIdentifier ||
        !canAccessApprovalBranch(ctx.staff, request)) return null;
    const status = await ownApprovalStatus(ctx, ctx.staff, request);
    return {
      requestId, kind: request.kind, status,
      ...(request.kind === "returnItems" && status === "pending" ? { summary: pendingReturnSummary(ctx, request) } : {}),
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
