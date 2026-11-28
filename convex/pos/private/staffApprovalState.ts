import { validate } from 'convex-helpers/validators';
import { ConvexError, convexToJson, v, type Infer } from 'convex/values';
import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { canAccessCheckoutOrderBranch, canReadCheckoutOrder, type requireStaff, type StaffActor } from '../../auth/model';
import { listAssignedBranches } from '../../branches/model';
import { readBudget } from '../../lib/readBudget';
import { sha256 } from '../../shared/displayTokens';
import { resortTodayIso } from '../../shared/time';
import { cashierRules } from '../../settings/model';
import { orderLineLinks } from './lineLinks';
import { orderLines } from './orderLines';
import { readOrderProjection } from './orderLifecycle';
import { orderRefunds } from './orderRefunds';

/** Stable serialization includes optional fields, revisions, coupons and source records. */
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function rulesFingerprint(rules: Awaited<ReturnType<typeof cashierRules>>) {
  const { revision, discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund } = rules;
  return canonical({ revision, discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund });
}

export type ApprovalRequest = Doc<'staffApprovalRequests'>;
export type CheckoutApprovalRequest = Exclude<ApprovalRequest, { kind: 'adjustment' | 'returnItems' }>;
type AdjustmentRequest = Extract<ApprovalRequest, { kind: 'adjustment' }>;
type ReturnRequest = Extract<ApprovalRequest, { kind: 'returnItems' }>;
export function isCheckoutApproval(request: ApprovalRequest): request is CheckoutApprovalRequest {
  return request.kind !== 'adjustment' && request.kind !== 'returnItems';
}

type ReadCtx = MutationCtx | QueryCtx;

export async function requesterFingerprint(ctx: ReadCtx, tokenIdentifier: string) {
  const grant = await readApprovalDocument(ctx, () =>
    ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier)).unique());
  // This is a stored request freshness check, not authentication. The request
  // was created by a verified cashier; like authentication, bind by account,
  // since its verified primary email may have changed after accepting the invite.
  const branches = grant && grant.role !== 'owner' ? await listAssignedBranches(ctx, grant.branchIds, readBudget(ctx)) : [];
  const role = grant && (grant.role === 'owner' || branches.length > 0) ? grant.role : null;
  return { role, branchIds: branches.map(branch => branch._id), fingerprint: canonical({ role, grant }) };
}

/** Extra targets matter too: paid-link targets and amended customer revisions are checked before execution. */
export async function orderFingerprint(
  ctx: ReadCtx, orderId: Id<'orders'>, payload: CheckoutApprovalRequest['payload'], currentOrder?: Doc<'orders'>,
) {
  const read = <T>(load: () => Promise<T>) => readOrderProjection(ctx, load);
  const [order, lines, links] = await Promise.all([
    currentOrder ?? read(() => ctx.db.get(orderId)), read(() => orderLines(ctx, orderId)), read(() => orderLineLinks(ctx, orderId)),
  ]);
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
  const couponId = order?.promotion?.couponId;
  const coupon = couponId ? await read(() => ctx.db.get(couponId)) : null;
  const couponHistory = coupon ? await read(() => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'coupon').eq('entityId', coupon._id)).order('desc').first()) : null;
  return canonical({ order, lines, links, refunds: await read(() => orderRefunds(ctx, orderId)), coupon, couponHistoryId: couponHistory?._id, businessDate: resortTodayIso(),
    bookings: await Promise.all([...bookingIds].sort().map(id => read(() => ctx.db.get(id)))),
    appointments: await Promise.all([...appointmentIds].sort().map(id => read(() => ctx.db.get(id)))),
    customer: customerId ? await read(() => ctx.db.get(customerId)) : null,
  });
}

/** Queries expose the effective terminal status immediately; mutations persist it when touched. */
export async function effectiveRequestStatus(
  ctx: ReadCtx, request: CheckoutApprovalRequest, currentRules?: Awaited<ReturnType<typeof cashierRules>>,
): Promise<CheckoutApprovalRequest['status']> {
  const status = await checkoutQueueStatus(ctx, request, currentRules);
  return status === 'revoked' ? 'stale' : status;
}

async function checkoutQueueStatus(ctx: ReadCtx, request: CheckoutApprovalRequest, currentRules?: Awaited<ReturnType<typeof cashierRules>>, currentOrder?: Doc<'orders'>): Promise<CheckoutApprovalRequest['status'] | 'revoked'> {
  if (request.status !== 'pending') return request.status;
  if (Date.now() >= request.expiresAt) return 'expired' as const;
  const rules = currentRules ?? await readApprovalDocument(ctx, () => cashierRules(ctx));
  if (rules.revision !== request.rulesRevision || rulesFingerprint(rules) !== request.rulesFingerprint) return 'stale';
  const requester = await requesterFingerprint(ctx, request.requesterTokenIdentifier);
  if (requester.role !== 'cashier' || requester.fingerprint !== request.requesterAccessFingerprint) return 'revoked' as const;
  const order = currentOrder ?? await getApprovalTarget(ctx, request.orderId);
  if (!order || order.revision !== request.orderRevision ||
    await orderFingerprint(ctx, request.orderId, request.payload, order) !== request.orderFingerprint) return 'stale';
  return 'pending';
}

export function isOwnApproval(actor: StaffActor, request: ApprovalRequest) {
  return request.requesterTokenIdentifier === actor.tokenIdentifier || request.requesterEmail === actor.email;
}

export function canReviewApproval(actor: StaffActor, request: ApprovalRequest) {
  if (!actor.capabilities.approve || isOwnApproval(actor, request)) return false;
  if (request.kind !== 'adjustment' || actor.role === 'owner') return true;
  const { target, expectedRevisions, adjustmentKind } = request.payload;
  return target.targetType !== 'settings' && expectedRevisions.every(ref => ref.target.targetType !== 'settings') &&
    adjustmentKind !== 'updateSettings' && adjustmentKind !== 'shorten' && adjustmentKind !== 'narrowServices';
}

/** Convex cursors are bound to the index range, so keep its expiry cutoff across a page window. */
export function approvalPageWindow(cursor: string | null, endCursor: string | null | undefined, now: number) {
  const boundary = cursor ?? endCursor;
  const cutoff = boundary == null ? now : Number(/^([0-9]+):/.exec(boundary)?.[1]);
  if (!Number.isSafeInteger(cutoff) || cutoff > now) throw new ConvexError('InvalidCursor: Reopen the approvals queue.');
  const prefix = `${cutoff}:`;
  const unwrap = (value: string) => {
    if (!value.startsWith(prefix)) throw new ConvexError('InvalidCursor: Reopen the approvals queue.');
    return value.slice(prefix.length);
  };
  return {
    cutoff, cursor: cursor === null ? null : unwrap(cursor), endCursor: endCursor == null ? endCursor : unwrap(endCursor),
    wrap: (value: string) => prefix + value,
  };
}

export async function readApprovalDocument<T>(ctx: ReadCtx, read: () => Promise<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const row = await read();
  if (row !== null) budget.document(row);
  budget.assert();
  return row;
}

function getApprovalTarget<Table extends TableNames>(ctx: ReadCtx, id: Id<Table>) {
  return readApprovalDocument(ctx, () => ctx.db.get(id));
}

// The staff builder reads the reviewer's bound grant and each assigned branch for desk staff.
// Reserve those reads separately from the detail handler's measured reads.
const DETAIL_READS = 130;
function availableDetailReads(ctx: ReadCtx, accessReads: number) {
  return DETAIL_READS - readBudget(ctx).ranges - accessReads;
}

function checkDetailReads(ctx: ReadCtx, accessReads: number) {
  if (availableDetailReads(ctx, accessReads) < 0) throw new Error('Approval detail exceeded its read budget.');
}

async function adjustmentAuthorityStatus(ctx: ReadCtx, request: AdjustmentRequest) {
  const [rules, grant] = await Promise.all([
    readApprovalDocument(ctx, () => cashierRules(ctx)),
    readApprovalDocument(ctx, () => ctx.db.query('staffGrants')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', request.requesterTokenIdentifier)).unique()),
  ]);
  if (rules.revision !== request.rulesRevision || await sha256(JSON.stringify(convexToJson(rules))) !== request.rulesFingerprint) return 'stale';
  const grantCurrent = request.payload.requester === request.requesterTokenIdentifier &&
    grant?.role === 'cashier' && await sha256(JSON.stringify(convexToJson(grant))) === request.requesterAccessFingerprint &&
    (await listAssignedBranches(ctx, grant.branchIds, readBudget(ctx))).length > 0;
  return grantCurrent ? 'current' : 'revoked';
}

function pendingStatus(request: ApprovalRequest) {
  return request.status === 'pending' && Date.now() >= request.expiresAt ? 'expired' : request.status;
}

type RevisionDoc = Doc<TableNames>;
function revisionOf(row: RevisionDoc | null, correction = false) {
  if (!row) return null;
  if (correction && 'orderNumber' in row) return row.correctionRevision ?? 0;
  return 'revision' in row ? row.revision ?? 0 : 0;
}

function lineView(line: Doc<'orderLines'>) {
  return {
    lineId: line._id, label: line.saleSnapshot?.label ?? line.name, kind: line.kind,
    quantity: line.qty, unitPrice: line.unitPrice,
  };
}

function orderView(order: Doc<'orders'>) {
  return {
    orderId: order._id, orderNumber: order.orderNumber, receiptNumber: order.receiptNumber,
    status: order.status, total: order.total, currency: order.currency,
  };
}

type AdjustmentTargetTable = AdjustmentRequest['payload']['target']['targetId']['__tableName'];

async function adjustmentTargetView(ctx: ReadCtx, row: Doc<AdjustmentTargetTable> | null) {
  if (!row) return null;
  if ('effectiveExpiresAt' in row) {
    const code = row.activeCodeId ? await getApprovalTarget(ctx, row.activeCodeId) : null;
    // Derive a fixed-length mask, even if a stored mask is malformed.
    const suffix = code?.voucherId === row._id ? code.code.slice(-4) : undefined;
    const maskedCode = suffix && /^[a-z0-9]{4}$/i.test(suffix) ? `GV-••••-${suffix}` : undefined;
    return {
      label: row.name ?? maskedCode, maskedCode, status: row.status, paidBalance: row.paidBalance,
      goodwillBalance: row.goodwillBalance, expiresAt: row.effectiveExpiresAt, pause: row.pause,
    };
  }
  if ('grantServiceIds' in row) {
    const version = await getApprovalTarget(ctx, row.packageVersionId);
    return {
      label: version?.name, ownerId: row.ownerId, total: row.total, used: row.used, paidUnits: row.paidUnits,
      goodwillUnits: row.goodwillUnits, expiresAt: row.expiresAt, pause: row.pause,
    };
  }
  if ('onHand' in row) {
    const variant = await getApprovalTarget(ctx, row.variantId);
    return { label: variant?.label, variantId: row.variantId, onHand: row.onHand, needsRecount: row.needsRecount };
  }
  if ('withGuest' in row) {
    const line = await getApprovalTarget(ctx, row.lineId);
    return {
      label: line?.orderId === row.orderId ? line.saleSnapshot?.label ?? line.name : undefined,
      orderId: row.orderId, lineId: row.lineId, status: row.status, withGuest: row.withGuest,
      quantity: row.quantity, unitPrice: row.unitPrice,
    };
  }
  if ('orderNumber' in row) return orderView(row);
  if ('saleSwitches' in row) {
    const {
      revision, preserveExpiredPackageValue, unusedFullRefundDays, refundDueDays, packageValidityDays,
      voucherValidityDays, allowSessionTransfer, packageSplit, packageVatTiming, pointsVatTreatment,
      pointsExpiryMonths, saleSwitches, paymentsMode,
    } = row;
    return { settings: {
      revision, preserveExpiredPackageValue, unusedFullRefundDays, refundDueDays, packageValidityDays,
      voucherValidityDays, allowSessionTransfer, packageSplit, packageVatTiming, pointsVatTreatment,
      pointsExpiryMonths, saleSwitches, paymentsMode,
    } };
  }
  if ('optionValueIds' in row) return { label: row.label, productId: row.productId, price: row.price, status: row.status };
  if ('pricePerNight' in row) return { label: row.name, price: row.pricePerNight, status: row.status };
  if ('price' in row) return { label: row.name, price: row.price, status: row.status };
  if ('faceValue' in row) return { label: row.name, faceValue: row.faceValue, validityDays: row.validityDays, status: row.status };
  if ('minPrice' in row) return { label: row.name, minPrice: row.minPrice, maxPrice: row.maxPrice, status: row.status };
  return { label: row.name, status: row.status };
}

export async function adjustmentApprovalDetail(ctx: ReadCtx, accessReads: number, request: AdjustmentRequest, includeTarget: boolean) {
  const { target, expectedRevisions, adjustmentKind } = request.payload;
  const baseStatus = pendingStatus(request);
  const [primary] = expectedRevisions;
  // The checkpoint writer accepts up to 24 distinct targets.
  const valid = primary?.target.targetType === target.targetType && primary.target.targetId === target.targetId &&
    expectedRevisions.length <= 24 && new Set(expectedRevisions.map(ref => ref.target.targetId)).size === expectedRevisions.length;
  const targets = valid ? await Promise.all(expectedRevisions.map(async ref => {
    const row = await getApprovalTarget(ctx, ref.target.targetId);
    return {
      row, revision: {
        ...ref.target, expected: ref.revision, current: revisionOf(row, adjustmentKind === 'amendPayment'),
        blockedByReturn: !!(row && 'pendingReturnId' in row && row.pendingReturnId),
      },
    };
  })) : [];
  const current = valid && targets.every(({ revision }) => revision.current === revision.expected && !revision.blockedByReturn);
  const authority = baseStatus === 'pending' ? await adjustmentAuthorityStatus(ctx, request) : null;
  const status = baseStatus === 'pending' && (!current || authority !== 'current') ? 'stale' : baseStatus;
  const targetView = includeTarget ? await adjustmentTargetView(ctx, targets[0]?.row ?? null) : null;
  checkDetailReads(ctx, accessReads);
  return { status, authorityRevoked: authority === 'revoked', target: targetView, revisions: targets.map(({ revision }) => revision) };
}

const returnRevision = v.union(
  v.object({ table: v.literal('sessionGrants'), id: v.id('sessionGrants'), revision: v.number() }),
  v.object({ table: v.literal('vouchers'), id: v.id('vouchers'), revision: v.number() }),
  v.object({ table: v.literal('stockLevels'), id: v.id('stockLevels'), revision: v.number() }),
  v.object({ table: v.literal('appointments'), id: v.id('appointments'), revision: v.number() }),
  v.object({ table: v.literal('handovers'), id: v.id('handovers'), revision: v.number() }),
);
const returnReview = v.object({
  version: v.literal(1),
  correctionRevision: v.optional(v.number()),
  revisions: v.array(returnRevision),
  rows: v.array(v.object({ lineId: v.id('orderLines'), label: v.string() })),
});
const returnRevisionLimits = { sessionGrants: 20, vouchers: 22, stockLevels: 60, appointments: 5, handovers: 20 };
const MAX_RETURN_PARTS = 20;

/** Return writers store this compact review in the returnItems request's existing orderFingerprint field. */
export function encodeReturnApprovalReview(review: Omit<Infer<typeof returnReview>, 'version'>) {
  return JSON.stringify({ version: 1, ...review });
}

/** Capture from the same transaction and documents as the quote. Execution still checks every target. */
export function returnApprovalCheckpoint(
  order: Doc<'orders'>, review: Parameters<typeof encodeReturnApprovalReview>[0], handovers: readonly Doc<'handovers'>[],
) {
  const byId = new Map(handovers.map(row => [row._id, row]));
  for (const ref of review.revisions) {
    if (ref.table !== 'handovers') continue;
    const row = byId.get(ref.id);
    if (!row || row.revision !== ref.revision || (row.orderId !== order._id && row.successorOrderId !== order._id)) {
      throw new ConvexError({ code: 'RETURN_STALE', message: 'Review the current return targets before requesting approval.' });
    }
  }
  return {
    orderRevision: order.revision, commerceRevision: order.commerceRevision ?? 0,
    orderFingerprint: encodeReturnApprovalReview(review),
  };
}

function parseReturnReview(ctx: ReadCtx, request: ReturnRequest) {
  if (!request.orderFingerprint || request.orderFingerprint.length > 32 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(request.orderFingerprint);
  } catch {
    return null;
  }
  if (!validate(returnReview, value) || value.rows.length > MAX_RETURN_PARTS ||
    (value.correctionRevision !== undefined && (!Number.isSafeInteger(value.correctionRevision) || value.correctionRevision < 0)) ||
    value.rows.some(row => !ctx.db.normalizeId('orderLines', row.lineId))) return null;
  const counts = { ...returnRevisionLimits };
  const ids = new Set<string>();
  for (const ref of value.revisions) {
    if (--counts[ref.table] < 0 || ids.has(ref.id) || !ctx.db.normalizeId(ref.table, ref.id) ||
      !Number.isSafeInteger(ref.revision) || ref.revision < 0) return null;
    ids.add(ref.id);
  }
  return value;
}

export function pendingReturnSummary(ctx: ReadCtx, request: ReturnRequest) {
  const review = parseReturnReview(ctx, request);
  return {
    parts: request.payload.parts.slice(0, MAX_RETURN_PARTS).map(part => ({
      lineId: part.lineId,
      label: review?.rows.find(row => row.lineId === part.lineId)?.label,
      kind: part.kind,
      contentKey: 'contentKey' in part ? part.contentKey : undefined,
      units: 'units' in part ? part.units : 1,
    })),
    payouts: request.payoutSummary,
  };
}

export async function returnApprovalDetail(ctx: ReadCtx, accessReads: number, request: ReturnRequest, includeTarget: boolean) {
  const baseStatus = pendingStatus(request);
  let authorityCurrent = true;
  let authorityRevoked = false;
  if (baseStatus === 'pending') {
    const [rules, requester] = await Promise.all([
      readApprovalDocument(ctx, () => cashierRules(ctx)),
      requesterFingerprint(ctx, request.requesterTokenIdentifier),
    ]);
    authorityRevoked = requester.role !== 'cashier' || requester.fingerprint !== request.requesterAccessFingerprint;
    authorityCurrent = !authorityRevoked && rules.revision === request.rulesRevision &&
      (request.rulesFingerprint === undefined || rulesFingerprint(rules) === request.rulesFingerprint);
  }
  const order = await getApprovalTarget(ctx, request.orderId);
  const review = parseReturnReview(ctx, request);
  const lineIds = new Set(request.payload.parts.slice(0, MAX_RETURN_PARTS).map(part => part.lineId));
  const validParts = request.payload.parts.length > 0 && request.payload.parts.length <= MAX_RETURN_PARTS;
  // Rows in the saved review were resolved when the return parts were quoted. The checkpoint
  // shape without a review can still display its order's selected rows.
  const rows = !includeTarget ? [] : review
    ? review.rows.filter(row => lineIds.has(row.lineId))
    : (await Promise.all([...lineIds].map(id => getApprovalTarget(ctx, id))))
      .flatMap(line => line?.orderId === request.orderId ? [lineView(line)] : []);
  // A checkpoint covers all handovers owned by this order. Shared stock, vouchers,
  // grants and appointments can change on other receipts and are compared directly.
  const hasCheckpoint = request.commerceRevision !== undefined;
  const directTargets = review?.revisions.filter(ref => !hasCheckpoint || ref.table !== 'handovers') ?? [];
  const checked = review !== null && directTargets.length <= availableDetailReads(ctx, accessReads);
  const targets = checked ? directTargets : [];
  const revisions = await Promise.all(targets.map(async ref => ({
    table: ref.table, id: ref.id, expected: ref.revision, current: revisionOf(await getApprovalTarget(ctx, ref.id)),
  })));
  const orderRevision = {
    expected: request.orderRevision, current: revisionOf(order),
    expectedCorrection: review?.correctionRevision, currentCorrection: order ? order.correctionRevision ?? 0 : null,
    expectedCommerce: request.commerceRevision, currentCommerce: order ? order.commerceRevision ?? 0 : null,
  };
  const stale = !checked || !authorityCurrent || !validParts || !order || order.status !== 'paid' ||
    orderRevision.current !== orderRevision.expected ||
    (orderRevision.expectedCorrection !== undefined && orderRevision.expectedCorrection !== orderRevision.currentCorrection) ||
    (hasCheckpoint && orderRevision.expectedCommerce !== orderRevision.currentCommerce) ||
    revisions.some(ref => ref.current !== ref.expected);
  const status = baseStatus === 'pending' && stale ? 'stale' : baseStatus;
  const freshness = baseStatus !== 'pending' ? 'resolved' as const
    : checked ? 'checked' as const : 'partial' as const;
  checkDetailReads(ctx, accessReads);
  return {
    status, freshness, authorityRevoked, authorityCurrent: baseStatus === 'pending' ? authorityCurrent : null,
    target: order && orderView(order), orderRevision, rows, revisions,
  };
}

export async function checkoutApprovalDetail(ctx: ReadCtx, request: CheckoutApprovalRequest, actor: StaffActor) {
  const [order, line, status] = await Promise.all([
    getApprovalTarget(ctx, request.orderId),
    request.lineId ? getApprovalTarget(ctx, request.lineId) : null,
    effectiveRequestStatus(ctx, request),
  ]);
  if (order && !canAccessCheckoutOrderBranch(actor, order)) return null;
  return {
    status, target: order && orderView(order),
    orderRevision: { expected: request.orderRevision, current: revisionOf(order) },
    rows: line?.orderId === request.orderId ? [lineView(line)] : [],
  };
}

/** Verify only the queue state, using the same revision and authority checks as review. */
export async function verifiedQueueStatus(ctx: ReadCtx, actor: StaffActor & { accessReads: number }, request: ApprovalRequest) {
  const status = pendingStatus(request);
  if (status !== 'pending') return status;
  if (isCheckoutApproval(request)) {
    const order = await getApprovalTarget(ctx, request.orderId);
    if (!order || !canAccessCheckoutOrderBranch(actor, order)) return 'revoked' as const;
    return checkoutQueueStatus(ctx, request, undefined, order);
  }
  const detail = request.kind === 'adjustment'
    ? await adjustmentApprovalDetail(ctx, actor.accessReads, request, false)
    : await returnApprovalDetail(ctx, actor.accessReads, request, false);
  return detail.authorityRevoked ? 'revoked' as const : detail.status;
}

export async function ownApprovalStatus(ctx: ReadCtx, actor: Awaited<ReturnType<typeof requireStaff>>, request: ApprovalRequest) {
  const baseStatus = pendingStatus(request);
  if (baseStatus !== 'pending') return baseStatus;
  if (request.kind === 'adjustment') return (await adjustmentApprovalDetail(ctx, actor.accessReads, request, false)).status;
  if (request.kind === 'returnItems') return (await returnApprovalDetail(ctx, actor.accessReads, request, false)).status;
  if (!canReadCheckoutOrder(actor, await getApprovalTarget(ctx, request.orderId))) return 'stale';
  return await effectiveRequestStatus(ctx, request);
}

export async function assertNoPendingApprovals(ctx: MutationCtx, orderId: Id<'orders'>, action = 'taking payment') {
  const requests = await ctx.db.query('staffApprovalRequests').withIndex('by_orderId_and_status', q => q.eq('orderId', orderId).eq('status', 'pending')).take(201);
  if (requests.length > 200) throw new ConvexError('Too many unresolved requests. Ask a manager to resolve them.');
  for (const request of requests) {
    if (isCheckoutApproval(request) && await effectiveRequestStatus(ctx, request) === 'pending') throw new ConvexError({ code: 'PENDING_APPROVAL', message: `Resolve the manager request before ${action}.`, requestId: request._id });
  }
}
