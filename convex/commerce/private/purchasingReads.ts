import { readSupplierActivity, supplierDeliveryActivityReady, supplierOrderActivityReady } from './supplierActivity';
/** Branch-scoped purchasing reads. Lists page 25 headers from one indexed range; details load only when opened. */
import { omit } from 'convex-helpers';
import type { PaginationOptions, PaginationResult } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { readBudget } from '../../lib/readBudget';
import { PURCHASING_MAX_LINES, PURCHASING_PAGE_SIZE, PURCHASING_TEXT_LIMITS, type OrderPhase, type OrderStatus, type RequestStatus } from '../purchasingTables';
import { addDays } from '../../shared/dates';
import { resortTodayIso } from '../../shared/time';
import {
  replacementCoverage, actorOf, availableApproval, canSeeBranchRequests, correctionClosesRemainder, deliveryKey, fail, ISSUED_OPEN, lineDue, purchasingAccess, quantity, readIncoming,
  readOrderLines, readRequestLines, staffDisplayName, type StockAccess,
} from './purchasingCore';
import { readStockLevel } from './stockLedger';
import { assessCorrection, eligibleUnits, openLineForHold, openLineReport } from './purchasingReceipts';
import { supplierNameKey } from './purchasingSuppliers';
import { readStockAccess } from './stockAccess';
import { otherApproverCount } from './stockAccess';
import { stockRead } from './stockLedger';

const page = (opts: PaginationOptions): PaginationOptions => ({ ...opts, numItems: Math.min(Math.max(1, opts.numItems), PURCHASING_PAGE_SIZE) });

/** One metered `db.get`: counts a lookup and the document against the invocation's read budget. */
function get<T extends 'purchaseRequests' | 'purchaseOrders' | 'supplierReceipts' | 'supplierReceiptLines' | 'purchaseOrderLines' | 'purchaseHolds' | 'branches'>(
  ctx: QueryCtx, id: Id<T>,
) {
  return stockRead(ctx, () => ctx.db.get(id));
}

/** Meter one paginated range (a range plus every returned row), then map and drop hidden rows. */
async function mapPage<T, U>(
  ctx: QueryCtx, read: Promise<PaginationResult<T>>, map: (row: T) => Promise<U | null> | U | null,
): Promise<PaginationResult<U>> {
  const budget = readBudget(ctx);
  budget.range();
  const result = await read;
  for (const row of result.page) budget.document(row);
  budget.assert();
  const rows = await Promise.all(result.page.map(map));
  return { ...result, page: rows.filter((row): row is Awaited<U> => row !== null) };
}

// ---------- Projections: actor keys stay on the server ----------

/** Staff appear by a short display name; older rows that stored a login email are reduced on read (P01). */
const named = (label: string | undefined) => (label === undefined ? undefined : staffDisplayName(label));

export function requestRow(request: Doc<'purchaseRequests'>, me: string) {
  return {
    ...omit(request, ['requesterKey', 'decidedByKey']), requesterLabel: staffDisplayName(request.requesterLabel),
    ...(request.decidedByLabel !== undefined ? { decidedByLabel: staffDisplayName(request.decidedByLabel) } : {}),
    mine: request.requesterKey === me,
  };
}
type SupplierSnapshot = Doc<'purchaseOrders'>['supplier'];
/** Supplier contact details are buyer-only, including the snapshots on orders, revisions and receipts. */
export const supplierFor = (supplier: SupplierSnapshot, buyer: boolean): SupplierSnapshot => (buyer ? supplier : { name: supplier.name });
/** Order costs and values are for buyers, approvers and stock leads; requesters and receivers see quantities only. */
export const canSeeCosts = (access: Pick<StockAccess, 'buyer' | 'approver' | 'lead'>) => access.buyer || access.approver || access.lead;

/** The order without its cost fields, for staff who may not see costs. */
function withoutCosts(order: Doc<'purchaseOrders'>) {
  const row: Omit<Doc<'purchaseOrders'>, 'totalCost'> & { totalCost?: number } = { ...order };
  delete row.totalCost;
  delete row.receivedValue;
  delete row.outstandingValue;
  return row;
}

export const orderRow = (order: Doc<'purchaseOrders'>, buyer: boolean, costs = buyer) => ({
  ...omit(costs ? order as Omit<Doc<'purchaseOrders'>, 'totalCost'> & { totalCost?: number } : withoutCosts(order),
    ['createdByKey', 'approvalRequestedByKey', 'supplierActivityApplied']),
  supplier: supplierFor(order.supplier, buyer),
  createdByLabel: staffDisplayName(order.createdByLabel),
  ...(order.approvalRequestedByLabel !== undefined ? { approvalRequestedByLabel: staffDisplayName(order.approvalRequestedByLabel) } : {}),
  ...(order.approvedByLabel !== undefined ? { approvedByLabel: staffDisplayName(order.approvedByLabel) } : {}),
});
/** Cost data (invoice total, accepted value, line unit cost) is for buyers (and stock leads on the receipt detail) only. */
export function receiptRow(receipt: Doc<'supplierReceipts'>, buyer: boolean) {
  const fields: Omit<Doc<'supplierReceipts'>, 'actorKey' | 'deliveryKey' | 'supplierActivityApplied'> = buyer
    ? omit(receipt, ['actorKey', 'deliveryKey', 'supplierActivityApplied'])
    : omit(receipt, ['actorKey', 'deliveryKey', 'invoiceTotal', 'acceptedValue', 'supplierActivityApplied']);
  const row = { ...fields, actorLabel: staffDisplayName(receipt.actorLabel) };
  return receipt.supplier ? { ...row, supplier: supplierFor(receipt.supplier, buyer) } : row;
}
export const holdRow = (hold: Doc<'purchaseHolds'>) => {
  const row = omit(hold, ['resolvedByKey']);
  return hold.resolvedByLabel !== undefined ? { ...row, resolvedByLabel: named(hold.resolvedByLabel) } : row;
};
export const adjustmentRow = (adjustment: Doc<'supplierReceiptAdjustments'>) =>
  ({ ...omit(adjustment, ['actorKey']), actorLabel: staffDisplayName(adjustment.actorLabel) });
export const requestLineRow = (line: Doc<'purchaseRequestLines'>) => ({ ...omit(line, ['requesterKey']), available: availableApproval(line) });
export function orderLineRow(line: Doc<'purchaseOrderLines'>, costs = true) {
  const row: Doc<'purchaseOrderLines'> = { ...line };
  if (!costs) {
    delete row.unitCost;
    delete row.acceptedValue;
  }
  return { ...row, due: lineDue(line) };
}
export function receiptLineRow(line: Doc<'supplierReceiptLines'>, seeCost = true) {
  const row: Doc<'supplierReceiptLines'> = seeCost ? line : omit(line, ['unitCost']);
  return { ...row, eligible: eligibleUnits(line) };
}
/** One row shape for every caller; contact fields are simply absent for non-buyers. */
export function supplierRow(supplier: Doc<'suppliers'>, buyer: boolean): Doc<'suppliers'> {
  const { _id, _creationTime, name, nameKey, status, revision, createdAt, updatedAt } = supplier;
  return buyer ? omit(supplier, ['contactKeysApplied', 'emailKey', 'phoneKey']) : { _id, _creationTime, name, nameKey, status, revision, createdAt, updatedAt };
}

/** URL values are untrusted strings. Normalize them before they reach typed queue arguments. */
export async function resolveQueueFilter(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>; variant?: string; supplier?: string;
}) {
  await purchasingAccess(ctx, staff, args.branchId, 'read');
  const variantId = args.variant ? ctx.db.normalizeId('productVariants', args.variant) : null;
  const supplierId = args.supplier ? ctx.db.normalizeId('suppliers', args.supplier) : null;
  const supplier = supplierId ? await stockRead(ctx, () => ctx.db.get(supplierId)) : null;
  return { variantId, supplier: supplier ? { id: supplier._id, name: supplier.name } : null };
}

const REFERENCE_MATCHES = 10;

/**
 * A known reference, its start ('PO-261128') or its 5-character code ('DBKP9') identifies requests and orders at the
 * branch independently of the active queue: a prefix range on the reference plus an exact range on the stored code
 * (older documents without a code match by prefix only). At most 10 of each.
 */
export async function findPurchaseReference(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>, search: string) {
  const access = await purchasingAccess(ctx, staff, branchId, 'read');
  const term = search.trim().toUpperCase();
  if (!term || term.length > PURCHASING_TEXT_LIMITS.reference) return { request: null, order: null, requests: [], orders: [] };
  const code = /^[A-Z0-9]{5}$/.test(term) ? term : null;
  const upper = `${term}\uffff`;
  const [requestsByPrefix, requestsByCode, ordersByPrefix, ordersByCode] = await Promise.all([
    stockRead(ctx, () => ctx.db.query('purchaseRequests').withIndex('by_branchId_and_reference', q =>
      q.eq('branchId', branchId).gte('reference', term).lt('reference', upper)).take(REFERENCE_MATCHES)),
    code ? stockRead(ctx, () => ctx.db.query('purchaseRequests').withIndex('by_branchId_and_referenceCode', q =>
      q.eq('branchId', branchId).eq('referenceCode', code)).take(REFERENCE_MATCHES)) : [],
    stockRead(ctx, () => ctx.db.query('purchaseOrders').withIndex('by_branchId_and_reference', q =>
      q.eq('branchId', branchId).gte('reference', term).lt('reference', upper)).take(REFERENCE_MATCHES)),
    code ? stockRead(ctx, () => ctx.db.query('purchaseOrders').withIndex('by_branchId_and_referenceCode', q =>
      q.eq('branchId', branchId).eq('referenceCode', code)).take(REFERENCE_MATCHES)) : [],
  ]);
  const unique = <T extends { _id: string }>(rows: T[]) => [...new Map(rows.map(row => [row._id, row])).values()].slice(0, REFERENCE_MATCHES);
  const me = actorOf(staff).actorKey;
  const requests = unique([...requestsByCode, ...requestsByPrefix])
    .filter(request => request.status !== 'deleted' && (canSeeBranchRequests(access) || request.requesterKey === me))
    .map(request => requestRow(request, me));
  const orders = unique([...ordersByCode, ...ordersByPrefix]).filter(order => order.status !== 'deleted').map(order => orderRow(order, access.buyer, canSeeCosts(access)));
  // `request`/`order` keep the earlier exact-match contract.
  return {
    request: requests.find(row => row.reference === term) ?? null, order: orders.find(row => row.reference === term) ?? null,
    requests, orders,
  };
}

// ---------- Requests ----------

export type RequestView =
  | { kind: 'mine' } | { kind: 'all' } | { kind: 'status'; status: RequestStatus } | { kind: 'item'; variantId: Id<'productVariants'> }
  /** The caller's own requests in one status (Needs my changes, Drafts, Declined, Closed). */
  | { kind: 'mineStatus'; status: RequestStatus }
  /** Awaiting approval, most urgent need-by first, then oldest submission. */
  | { kind: 'approvalQueue' }
  /** Approved with demand still to order (default), or approved and fully ordered. */
  | { kind: 'approved'; fullyOrdered: boolean };

/** Requesters see their own requests; approvers, buyers and stock leads see the branch. */
export async function listRequests(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; view: RequestView; paginationOpts: PaginationOptions }) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const me = actorOf(staff).actorKey;
  const branchWide = canSeeBranchRequests(access);
  const { view, branchId } = args;
  if (!branchWide && (view.kind === 'all' || view.kind === 'status' || view.kind === 'approvalQueue' || view.kind === 'approved')) {
    fail('STOCK_FORBIDDEN', 'You can view only your own requests at this branch.');
  }
  if (view.kind === 'approvalQueue') {
    return mapPage(ctx, ctx.db.query('purchaseRequests').withIndex('by_branchId_and_status_and_needBySort_and_submittedAt', q =>
      q.eq('branchId', branchId).eq('status', 'awaiting_approval')).order('asc').paginate(page(args.paginationOpts)), request => requestRow(request, me));
  }
  if (view.kind === 'approved') {
    // Older approvals without the flag (undefined) sort with the not-yet-fully-ordered ones.
    const range = ctx.db.query('purchaseRequests').withIndex('by_branchId_and_status_and_fullyOrdered_and_updatedAt', q => {
      const approved = q.eq('branchId', branchId).eq('status', 'approved');
      return view.fullyOrdered ? approved.eq('fullyOrdered', true) : approved.lt('fullyOrdered', true);
    });
    return mapPage(ctx, range.order('desc').paginate(page(args.paginationOpts)), request => requestRow(request, me));
  }
  if (view.kind === 'mineStatus') {
    if (view.status === 'deleted') fail('STOCK_FORBIDDEN', 'Deleted requests are not listed.');
    return mapPage(ctx, ctx.db.query('purchaseRequests').withIndex('by_branchId_and_requesterKey_and_status_and_updatedAt', q =>
      q.eq('branchId', branchId).eq('requesterKey', me).eq('status', view.status)).order('desc').paginate(page(args.paginationOpts)),
    request => requestRow(request, me));
  }
  if (view.kind === 'item') {
    const lines = branchWide
      ? ctx.db.query('purchaseRequestLines').withIndex('by_branchId_and_variantId', q => q.eq('branchId', branchId).eq('variantId', view.variantId))
      : ctx.db.query('purchaseRequestLines').withIndex('by_branchId_and_requesterKey_and_variantId', q =>
        q.eq('branchId', branchId).eq('requesterKey', me).eq('variantId', view.variantId));
    return mapPage(ctx, lines.order('desc').paginate(page(args.paginationOpts)), async line => {
      const request = await get(ctx, line.requestId);
      return request && request.status !== 'deleted' ? requestRow(request, me) : null;
    });
  }
  const headers = view.kind === 'status'
    ? ctx.db.query('purchaseRequests').withIndex('by_branchId_and_status_and_updatedAt', q => q.eq('branchId', branchId).eq('status', view.status))
    : view.kind === 'all'
      ? ctx.db.query('purchaseRequests').withIndex('by_branchId_and_updatedAt', q => q.eq('branchId', branchId))
      : ctx.db.query('purchaseRequests').withIndex('by_branchId_and_requesterKey_and_updatedAt', q => q.eq('branchId', branchId).eq('requesterKey', me));
  return mapPage(ctx, headers.order('desc').paginate(page(args.paginationOpts)), request =>
    request.status === 'deleted' && view.kind !== 'status' ? null : requestRow(request, me));
}

/** Detail reads authorize at the record's branch, then hide logically deleted drafts. */
async function readableRequest(ctx: QueryCtx, staff: StaffActor, requestId: Id<'purchaseRequests'>) {
  const request = await get(ctx, requestId);
  if (!request) fail('REQUEST_NOT_FOUND', 'This request no longer exists.');
  const access = await purchasingAccess(ctx, staff, request.branchId, 'read');
  if (request.status === 'deleted') fail('REQUEST_NOT_FOUND', 'This request no longer exists.');
  if (!canSeeBranchRequests(access) && request.requesterKey !== actorOf(staff).actorKey) fail('STOCK_FORBIDDEN', 'You can view only your own requests.');
  return { request, access };
}

/** Requests listed per line for one item (bounded) when summing other open demand. */
const DEMAND_SCAN = 50;

/**
 * Decision context for one request line at the request's branch (P05): On hand from the balance, On order from the
 * projection, other approved-but-uncommitted demand for the item on other requests, and the most recent PO unit cost.
 * Bounded: ≤ 50 lines × (1 balance + 1 projection + ≤ 50 request lines + 2 order lines).
 */
async function lineContext(ctx: QueryCtx, branchId: Id<'branches'>, requestId: Id<'purchaseRequests'>, line: Doc<'purchaseRequestLines'>, showCost: boolean) {
  const [level, incoming, demand, openLine, closedLine] = await Promise.all([
    readStockLevel(ctx, branchId, line.variantId),
    readIncoming(ctx, branchId, line.variantId),
    stockRead(ctx, () => ctx.db.query('purchaseRequestLines').withIndex('by_branchId_and_variantId', q =>
      q.eq('branchId', branchId).eq('variantId', line.variantId)).order('desc').take(DEMAND_SCAN)),
    showCost ? stockRead(ctx, () => ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q =>
      q.eq('branchId', branchId).eq('variantId', line.variantId).eq('open', true)).order('desc').first()) : null,
    showCost ? stockRead(ctx, () => ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q =>
      q.eq('branchId', branchId).eq('variantId', line.variantId).eq('open', false)).order('desc').first()) : null,
  ]);
  const otherDemand = demand.filter(row => row.requestId !== requestId).reduce((sum, row) => sum + availableApproval(row), 0);
  const latest = [openLine, closedLine].filter((row): row is Doc<'purchaseOrderLines'> => !!row && row.unitCost !== undefined)
    .sort((a, b) => b._creationTime - a._creationTime)[0];
  return {
    onHand: level?.onHand ?? 0, onOrder: incoming?.quantity ?? 0, otherDemand,
    ...(latest?.unitCost !== undefined ? { lastUnitCost: latest.unitCost } : {}),
  };
}

export async function getRequest(ctx: QueryCtx, staff: StaffActor, requestId: Id<'purchaseRequests'>) {
  const { request, access } = await readableRequest(ctx, staff, requestId);
  const [lines, orders] = await Promise.all([
    readRequestLines(ctx, request._id),
    stockRead(ctx, () => ctx.db.query('purchaseOrders').withIndex('by_requestId', q => q.eq('requestId', request._id)).take(PURCHASING_PAGE_SIZE)),
  ]);
  const showCost = canSeeBranchRequests(access);
  const context = await Promise.all(lines.map(line => lineContext(ctx, request.branchId, request._id, line, showCost)));
  return {
    request: requestRow(request, actorOf(staff).actorKey), lines: lines.map((line, i) => ({ ...requestLineRow(line), context: context[i] })),
    orders: orders.filter(order => order.status !== 'deleted').map(order => orderRow(order, access.buyer, canSeeCosts(access))), permissions: permissions(access),
  };
}

/** Badge counts for a requester's own work (capped at 100): sent back for changes, and drafts. */
export async function myRequestCounts(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>) {
  await purchasingAccess(ctx, staff, branchId, 'read');
  const me = actorOf(staff).actorKey;
  const count = (status: RequestStatus) => stockRead(ctx, () => ctx.db.query('purchaseRequests')
    .withIndex('by_branchId_and_requesterKey_and_status_and_updatedAt', q => q.eq('branchId', branchId).eq('requesterKey', me).eq('status', status))
    .take(100)).then(rows => rows.length);
  const [needsChanges, drafts] = await Promise.all([count('needs_changes'), count('draft')]);
  return { needsChanges, drafts };
}

/** Whether anyone else at the branch can approve the caller's requests (P10). */
export async function approverCoverage(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>) {
  const access = await purchasingAccess(ctx, staff, branchId, 'read');
  const grantId = staff.grantId ?? (await ctx.db.query('staffGrants')
    .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', staff.tokenIdentifier)).unique())?._id;
  const others = await otherApproverCount(ctx, branchId, grantId);
  return { otherApprovers: others, branchName: access.branch.name, canManageAccess: staff.capabilities.manageTeam === true };
}

export function permissions(access: StockAccess) {
  return {
    requester: access.requester, approver: access.approver, buyer: access.buyer, receiver: access.receiver, lead: access.lead,
    directOrder: access.directOrder, directReceipt: access.directReceipt,
    separateReceiving: access.policy.separateReceiving, directOrderLimit: access.policy.directOrderLimit,
    seeCosts: canSeeCosts(access),
  };
}

// ---------- Orders ----------

export type OrderView =
  | { kind: 'phase'; phase: OrderPhase } | { kind: 'status'; status: OrderStatus }
  | { kind: 'supplier'; supplierId: Id<'suppliers'> } | { kind: 'item'; variantId: Id<'productVariants'>; openOnly: boolean }
  | { kind: 'openSearch'; search: string }
  /** Open orders by expected date (P11): past due, or due from today through the next 6 days. Undated orders are excluded. */
  | { kind: 'overdue' } | { kind: 'dueSoon' };

export async function listOrders(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; view: OrderView; paginationOpts: PaginationOptions }) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const { buyer } = access;
  const costs = canSeeCosts(access);
  const { view, branchId } = args;
  if (view.kind === 'openSearch') {
    const term = view.search.trim().slice(0, PURCHASING_TEXT_LIMITS.name);
    const supplierTerms = term.match(/[\p{L}\p{M}\p{N}]+/gu)?.slice(0, 16).join(' ');
    const matchByReference = /^po(?:-\d{0,6}(?:-[a-z0-9]{0,5})?)?$/i.test(term);
    const headers = matchByReference
      ? ctx.db.query('purchaseOrders').withIndex('by_branchId_and_phase_and_reference', q => {
        const reference = term.toUpperCase();
        return q.eq('branchId', branchId).eq('phase', 'open').gte('reference', reference).lt('reference', reference + '\uffff');
      })
      : supplierTerms
        ? ctx.db.query('purchaseOrders').withSearchIndex('search_supplier_name', q =>
          q.search('supplier.name', supplierTerms).eq('branchId', branchId).eq('phase', 'open'))
        : ctx.db.query('purchaseOrders').withIndex('by_branchId_and_phase_and_reference', q =>
          q.eq('branchId', branchId).eq('phase', 'open').eq('reference', ''));
    return mapPage(ctx, headers.paginate(page(args.paginationOpts)), order => ({ ...orderRow(order, buyer, costs), line: null }));
  }
  if (view.kind === 'item') {
    const lines = view.openOnly
      ? ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q => q.eq('branchId', branchId).eq('variantId', view.variantId).eq('open', true))
      : ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q => q.eq('branchId', branchId).eq('variantId', view.variantId));
    return mapPage(ctx, lines.order('desc').paginate(page(args.paginationOpts)), async line => {
      const order = await get(ctx, line.orderId);
      return order && order.status !== 'deleted' ? { ...orderRow(order, buyer, costs), line: orderLineRow(line, costs) } : null;
    });
  }
  if (view.kind === 'overdue' || view.kind === 'dueSoon') {
    const today = resortTodayIso();
    const range = ctx.db.query('purchaseOrders').withIndex('by_branchId_and_phase_and_expectedDate', q => {
      const open = q.eq('branchId', branchId).eq('phase', 'open');
      return view.kind === 'overdue' ? open.gt('expectedDate', '').lt('expectedDate', today) : open.gte('expectedDate', today).lte('expectedDate', addDays(today, 6));
    });
    return mapPage(ctx, range.order('asc').paginate(page(args.paginationOpts)), order => ({ ...orderRow(order, buyer, costs), line: null }));
  }
  const headers = view.kind === 'phase'
    ? ctx.db.query('purchaseOrders').withIndex('by_branchId_and_phase_and_updatedAt', q => q.eq('branchId', branchId).eq('phase', view.phase))
    : view.kind === 'status'
      ? ctx.db.query('purchaseOrders').withIndex('by_branchId_and_status_and_updatedAt', q => q.eq('branchId', branchId).eq('status', view.status))
      : ctx.db.query('purchaseOrders').withIndex('by_branchId_and_supplierId_and_updatedAt', q => q.eq('branchId', branchId).eq('supplierId', view.supplierId));
  return mapPage(ctx, headers.order('desc').paginate(page(args.paginationOpts)), order =>
    order.status === 'deleted' && view.kind !== 'status' ? null : { ...orderRow(order, buyer, costs), line: null });
}

async function readableOrder(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>) {
  const order = await get(ctx, orderId);
  if (!order) fail('ORDER_NOT_FOUND', 'This order no longer exists.');
  const access = await purchasingAccess(ctx, staff, order.branchId, 'read');
  if (order.status === 'deleted') fail('ORDER_NOT_FOUND', 'This order no longer exists.');
  return { order, access };
}

export async function getOrder(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>) {
  const { order, access } = await readableOrder(ctx, staff, orderId);
  const [lines, open, recent] = await Promise.all([
    readOrderLines(ctx, order._id),
    // Open holds come from their own status range, so any number of resolved holds never hides an active one.
    stockRead(ctx, () => ctx.db.query('purchaseHolds').withIndex('by_orderId_and_status', q => q.eq('orderId', order._id).eq('status', 'open')).take(PURCHASING_MAX_LINES)),
    stockRead(ctx, () => ctx.db.query('purchaseHolds').withIndex('by_orderId', q => q.eq('orderId', order._id)).order('desc').take(PURCHASING_PAGE_SIZE)),
  ]);
  const openIds = new Set(open.map(hold => hold._id));
  const holds = [...open, ...recent.filter(hold => !openIds.has(hold._id))];
  // The hold a replacement order was raised for was received on another order; include it so it can be accepted here.
  const linked = order.forHoldId && !holds.some(hold => hold._id === order.forHoldId) ? await get(ctx, order.forHoldId) : null;
  const related = linked && linked.branchId === order.branchId ? [...holds, linked] : holds;
  const request = order.requestId ? await get(ctx, order.requestId) : null;
  return {
    order: orderRow(order, access.buyer, canSeeCosts(access)), lines: lines.map(line => orderLineRow(line, canSeeCosts(access))),
    addableRequestLines: await addableRequestLines(ctx, order, request, lines),
    holds: related.map(holdRow), acceptableHolds: ISSUED_OPEN.includes(order.status) ? acceptableHolds(order, lines, related) : [],
    permissions: permissions(access),
    overReceiptTolerancePct: order.replacesReturnId ? 0 : access.policy.overReceiptTolerancePct,
    returnsAwaitingCredit: await returnsAwaitingCredit(ctx, order._id),
    sourceRequest: request ? { id: request._id, reference: request.reference, status: request.status } : null,
  };
}

/**
 * Approved lines of the order's own source request that an amendment may add (P16): the request is still approved,
 * approval is left and the item is not already on the order.
 */
async function addableRequestLines(ctx: QueryCtx, order: Doc<'purchaseOrders'>, request: Doc<'purchaseRequests'> | null, lines: Doc<'purchaseOrderLines'>[]) {
  if (!request || request.status !== 'approved' || !ISSUED_OPEN.includes(order.status)) return [];
  const onOrder = new Set(lines.map(line => line.variantId));
  return (await readRequestLines(ctx, request._id))
    .filter(line => availableApproval(line) > 0 && !onOrder.has(line.variantId))
    .map(line => ({ requestLineId: line._id, variantId: line.variantId, item: line.item, available: availableApproval(line) }));
}

/** Supplier returns on this order still expecting a credit note (bounded), for the order banner. */
async function returnsAwaitingCredit(ctx: QueryCtx, orderId: Id<'purchaseOrders'>) {
  const returns = await stockRead(ctx, () => ctx.db.query('supplierReceiptAdjustments').withIndex('by_orderId_and_kind', q =>
    q.eq('orderId', orderId).eq('kind', 'supplier_return')).take(PURCHASING_MAX_LINES));
  const open = returns.filter(row => row.returnOutcome === 'credit_expected' && row.quantity > row.reversedQuantity);
  return { count: open.length, units: open.reduce((sum, row) => sum + row.quantity - row.reversedQuantity, 0) };
}

const revisionSummary = ({ revision, issuedAt, actorLabel, reason }: Doc<'purchaseOrderRevisions'>) =>
  ({ revision, issuedAt, actorLabel: staffDisplayName(actorLabel), reason });

/**
 * Open holds this order can accept now, each paired with the order line to receive it on: holds received on this order
 * (after an amend made units due again) and the hold a linked replacement order was raised for.
 */
function acceptableHolds(order: Doc<'purchaseOrders'>, lines: Doc<'purchaseOrderLines'>[], holds: Doc<'purchaseHolds'>[]) {
  return holds.flatMap(hold => {
    const line = hold.status === 'open' ? lines.find(row => row.variantId === hold.variantId && lineDue(row) > 0) : undefined;
    if (!line || (hold.orderId !== order._id && order.forHoldId !== hold._id)) return [];
    return [{
      holdId: hold._id, holdRevision: hold.revision, orderLineId: line._id, variantId: hold.variantId,
      remaining: hold.quantity - hold.acceptedQuantity, due: lineDue(line),
      link: hold.orderId === order._id ? 'own_order' as const : 'replacement' as const,
    }];
  });
}

/** Issued revisions of an order, newest first; each opens as a printable copy through `getOrderRevision`. */
export async function listOrderRevisions(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>, paginationOpts: PaginationOptions) {
  const { order } = await readableOrder(ctx, staff, orderId);
  return mapPage(ctx, ctx.db.query('purchaseOrderRevisions').withIndex('by_orderId_and_revision', q => q.eq('orderId', order._id))
    .order('desc').paginate(page(paginationOpts)), revisionSummary);
}

/** Printable supplier-facing copy of any issued revision. */
export async function getOrderRevision(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>, revision: number) {
  const { order, access } = await readableOrder(ctx, staff, orderId);
  const row = await stockRead(ctx, () => ctx.db.query('purchaseOrderRevisions').withIndex('by_orderId_and_revision', q =>
    q.eq('orderId', order._id).eq('revision', revision)).unique());
  if (!row) fail('REVISION_NOT_FOUND', 'This order revision does not exist.');
  const branch = await get(ctx, order.branchId);
  // The supplier copy names the buyer business, delivery address and receiving contact from current branch settings, and
  // the issuer by display name only: no staff login reaches the supplier (P02). Older revisions print the same way.
  const contact = staffDisplayName(row.actorLabel);
  return {
    ...omit(row, ['actorKey']), actorLabel: contact, supplier: supplierFor(row.supplier, access.buyer), branchName: branch?.name ?? '',
    lines: canSeeCosts(access) ? row.lines : row.lines.map(line => {
      const copy = { ...line };
      delete copy.unitCost;
      return copy;
    }),
    buyer: {
      legalName: branch?.issuer.legalName || branch?.name || '', taxId: branch?.issuer.taxId || undefined,
      address: branch?.issuer.address || undefined, branchCode: branch?.issuer.branchCode || undefined,
      receivingContact: access.policy.receivingContact ?? contact, receivingPhone: access.policy.receivingPhone,
      contactName: contact,
    },
  };
}

/** Whole days between two ISO dates (b − a). */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * An order's receipts with the revision they were received on and their lateness against the expected date in force on
 * that revision (its snapshot), in resort time (P42). `lateDays` is null when that revision had no expected date.
 */
export async function listOrderReceipts(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>, paginationOpts: PaginationOptions) {
  const { order, access } = await readableOrder(ctx, staff, orderId);
  const expected = new Map<number, Promise<string | undefined>>();
  const expectedOn = (revision: number) => {
    if (!expected.has(revision)) {
      expected.set(revision, stockRead(ctx, () => ctx.db.query('purchaseOrderRevisions').withIndex('by_orderId_and_revision', q =>
        q.eq('orderId', order._id).eq('revision', revision)).unique()).then(row => row?.expectedDate));
    }
    return expected.get(revision)!;
  };
  return mapPage(ctx, ctx.db.query('supplierReceipts').withIndex('by_orderId', q => q.eq('orderId', order._id)).order('desc').paginate(page(paginationOpts)),
    async receipt => {
      const expectedDate = receipt.orderRevision === undefined ? order.expectedDate : await expectedOn(receipt.orderRevision);
      const receivedOn = resortTodayIso(receipt.createdAt);
      return {
        ...receiptRow(receipt, access.buyer), expectedDate: expectedDate ?? null, receivedOn,
        lateDays: expectedDate ? dayDiff(expectedDate, receivedOn) : null,
      };
    });
}

// ---------- Receipts and holds ----------

export async function listReceipts(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>;
  supplierId?: Id<'suppliers'>;
  /** Receipts with rejected or held units (P37). Older receipts without the flag are not listed here. */
  exceptionsOnly?: boolean;
  match?: { kind: 'receipt' | 'delivery'; reference: string };
  paginationOpts: PaginationOptions;
}) {
  const { buyer } = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const { branchId, match } = args;
  const reference = match?.reference.trim().slice(0, PURCHASING_TEXT_LIMITS.reference) ?? '';
  const headers = args.exceptionsOnly
    ? ctx.db.query('supplierReceipts').withIndex('by_branchId_and_hasExceptions_and_createdAt', q =>
      q.eq('branchId', branchId).eq('hasExceptions', true))
    : args.supplierId
    ? ctx.db.query('supplierReceipts').withIndex('by_branchId_and_supplierId_and_createdAt', q =>
      q.eq('branchId', branchId).eq('supplierId', args.supplierId))
    : match?.kind === 'receipt'
    ? ctx.db.query('supplierReceipts').withIndex('by_branchId_and_reference', q =>
      q.eq('branchId', branchId).eq('reference', reference.toUpperCase()))
    : match?.kind === 'delivery'
      ? ctx.db.query('supplierReceipts').withIndex('by_branchId_and_deliveryKey_and_createdAt', q =>
        q.eq('branchId', branchId).eq('deliveryKey', deliveryKey(reference) ?? ''))
      : ctx.db.query('supplierReceipts').withIndex('by_branchId_and_createdAt', q => q.eq('branchId', branchId));
  return mapPage(ctx, headers.order('desc').paginate(page(args.paginationOpts)), receipt => receiptRow(receipt, buyer));
}

export async function getReceipt(ctx: QueryCtx, staff: StaffActor, receiptId: Id<'supplierReceipts'>) {
  const receipt = await get(ctx, receiptId);
  if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt no longer exists.');
  const access = await purchasingAccess(ctx, staff, receipt.branchId, 'read');
  const [lines, holds] = await Promise.all([
    stockRead(ctx, () => ctx.db.query('supplierReceiptLines').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id)).take(PURCHASING_MAX_LINES)),
    stockRead(ctx, () => ctx.db.query('purchaseHolds').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id)).take(PURCHASING_MAX_LINES)),
  ]);
  return {
    receipt: receiptRow(receipt, access.buyer || access.lead), lines: lines.map(line => receiptLineRow(line, access.buyer || access.lead)),
    holds: holds.map(holdRow), permissions: permissions(access),
  };
}

export type HoldQueueFilter = { receiptReference?: string; variantId?: Id<'productVariants'> };

/**
 * How an open hold can be accepted now: on its own open order line with units still due, by amending an open order
 * with nothing due, or (closed order, or no order) only by a linked replacement order or a decline.
 */
async function holdAcceptPath(ctx: QueryCtx, hold: Doc<'purchaseHolds'>) {
  if (hold.status !== 'open') return null;
  const target = hold.orderId ? await openLineForHold(ctx, hold) : null;
  if (!target) return { kind: 'no_order' as const };
  const { order, line } = target;
  const base = { orderId: order._id, orderReference: order.reference, status: order.status };
  if (!ISSUED_OPEN.includes(order.status)) return { kind: 'order_closed' as const, ...base };
  if (!line) return { kind: 'no_due' as const, ...base };
  return { kind: 'own_order' as const, ...base, orderLineId: line._id, due: lineDue(line) };
}

/**
 * Held goods queue for one branch and status, newest first. An exact receipt reference or an item narrows it through
 * its own index, so a match beyond the first page is found and other branches never match. Rows carry the unresolved
 * units, the supplier name (older holds read it from their receipt; contact details never leave) and, for open holds,
 * the acceptance path.
 */
export async function listHolds(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>; status: Doc<'purchaseHolds'>['status']; paginationOpts: PaginationOptions;
} & HoldQueueFilter) {
  await purchasingAccess(ctx, staff, args.branchId, 'read');
  const { branchId, status, variantId } = args;
  const reference = args.receiptReference?.trim().slice(0, PURCHASING_TEXT_LIMITS.reference).toUpperCase();
  const range = reference
    ? ctx.db.query('purchaseHolds').withIndex('by_branchId_and_status_and_receiptReference', q =>
      q.eq('branchId', branchId).eq('status', status).eq('receiptReference', reference))
    : variantId
      ? ctx.db.query('purchaseHolds').withIndex('by_branchId_and_status_and_variantId', q =>
        q.eq('branchId', branchId).eq('status', status).eq('variantId', variantId))
      : ctx.db.query('purchaseHolds').withIndex('by_branchId_and_status_and_createdAt', q => q.eq('branchId', branchId).eq('status', status));
  return mapPage(ctx, range.order('desc').paginate(page(args.paginationOpts)), async hold => {
    const supplierName = hold.supplierName ?? (await get(ctx, hold.receiptId))?.supplier?.name;
    return {
      ...holdRow(hold), ...(supplierName ? { supplierName } : {}),
      unresolved: hold.status === 'open' ? hold.quantity - hold.acceptedQuantity : 0,
      acceptPath: await holdAcceptPath(ctx, hold),
    };
  });
}

export const OPEN_HOLD_COUNT_CAP = 99;

/**
 * Open held goods at a branch, for the Stock nav badge: one bounded index range. Branch staff without any stock
 * permission get `null` without a hold read; a branch the caller cannot access still fails.
 */
export async function countOpenHolds(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>) {
  const access = await readStockAccess(ctx, staff, branchId);
  if (!access.read) return null;
  const rows = await stockRead(ctx, () => ctx.db.query('purchaseHolds').withIndex('by_branchId_and_status_and_createdAt', q =>
    q.eq('branchId', branchId).eq('status', 'open')).take(OPEN_HOLD_COUNT_CAP + 1));
  return { count: Math.min(rows.length, OPEN_HOLD_COUNT_CAP), capped: rows.length > OPEN_HOLD_COUNT_CAP };
}

export const REJECTION_SUMMARY_RECEIPTS = 25;

/**
 * Rejected units by reason code for one supplier at a branch, over its most recent receipts (bounded). Lines rejected
 * before reason codes existed count as `uncoded`.
 */
export async function supplierRejections(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; supplierId: Id<'suppliers'> }) {
  await purchasingAccess(ctx, staff, args.branchId, 'read');
  const receipts = await stockRead(ctx, () => ctx.db.query('supplierReceipts').withIndex('by_branchId_and_supplierId_and_createdAt', q =>
    q.eq('branchId', args.branchId).eq('supplierId', args.supplierId)).order('desc').take(REJECTION_SUMMARY_RECEIPTS));
  const counts = new Map<string, number>();
  for (const receipt of receipts.filter(row => row.rejectedUnits > 0)) {
    const lines = await stockRead(ctx, () => ctx.db.query('supplierReceiptLines').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id))
      .take(PURCHASING_MAX_LINES));
    for (const line of lines) {
      const code = line.rejectReasonCode ?? 'uncoded';
      if (line.rejected > 0) counts.set(code, (counts.get(code) ?? 0) + line.rejected);
    }
  }
  return {
    receiptsScanned: receipts.length,
    byReason: [...counts].map(([reason, units]) => ({ reason, units })).sort((a, b) => b.units - a.units),
  };
}

/** Receipt adjustments (corrections, supplier returns, reversals), newest first. */
export async function listReceiptAdjustments(ctx: QueryCtx, staff: StaffActor, receiptId: Id<'supplierReceipts'>, paginationOpts: PaginationOptions) {
  const receipt = await get(ctx, receiptId);
  if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt no longer exists.');
  await purchasingAccess(ctx, staff, receipt.branchId, 'read');
  // Supplier returns carry the authoritative replaceable quantity and any live replacement, for the replacement action.
  return mapPage(ctx, ctx.db.query('supplierReceiptAdjustments').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id))
    .order('desc').paginate(page(paginationOpts)), async row => {
    type Replacement = { remaining: number; activeReference?: string; activeOrderId?: Id<'purchaseOrders'> };
    let replacement: Replacement | undefined;
    if (row.kind === 'supplier_return') {
      const coverage = await replacementCoverage(ctx, row);
      replacement = { remaining: coverage.remaining, ...(coverage.active ? { activeReference: coverage.active.reference, activeOrderId: coverage.active._id } : {}) };
    }
    return { ...adjustmentRow(row), ...(replacement ? { replacement } : {}) } as ReturnType<typeof adjustmentRow> & { replacement?: Replacement };
  });
}

/**
 * Preview a correction against today's balance before posting. `stockRevision` is what a negative override must name;
 * `blockedBy` says whether posting would open a reconciliation report instead, and `reportId` is the line's open report.
 */
export async function previewCorrection(ctx: QueryCtx, staff: StaffActor, args: { receiptLineId: Id<'supplierReceiptLines'>; quantity: number }) {
  const line = await get(ctx, args.receiptLineId);
  if (!line) fail('RECEIPT_NOT_FOUND', 'This receipt line no longer exists.');
  await purchasingAccess(ctx, staff, line.branchId, 'lead');
  quantity(args.quantity, 'Correction quantity');
  const [check, report, orderLine, order] = await Promise.all([
    assessCorrection(ctx, line, args.quantity),
    openLineReport(ctx, line),
    line.orderLineId ? get(ctx, line.orderLineId) : null,
    line.orderId ? get(ctx, line.orderId) : null,
  ]);
  const closed = await correctionClosesRemainder(ctx, order);
  return {
    eligible: eligibleUnits(line), onHand: check.onHand, onHandAfter: check.onHand - args.quantity, negative: check.negative,
    stockRevision: check.stockRevision, blockedBy: check.blockedBy ?? null, reportId: report?._id ?? null,
    dueBefore: orderLine ? lineDue(orderLine) : null,
    dueAfter: orderLine ? (closed ? 0 : lineDue({ ...orderLine, accepted: orderLine.accepted - args.quantity })) : null,
    remainderClosed: closed,
  };
}

// ---------- Suppliers, On order and history ----------

export async function listSuppliers(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>; search?: string; status: Doc<'suppliers'>['status'] | 'all'; includeActivity?: boolean; paginationOpts: PaginationOptions;
}) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const search = supplierNameKey(args.search ?? '').slice(0, 120);
  const status = args.status;
  const query = ctx.db.query('suppliers');
  const suppliers = search ? query.withSearchIndex('search_name', q => {
    const match = q.search('name', search);
    return status === 'all' ? match : match.eq('status', status);
  }) : status === 'all' ? query.withIndex('by_nameKey') : query.withIndex('by_status_and_nameKey', q => q.eq('status', status));
  type SupplierDirectoryRow = Doc<'suppliers'> & {
    openOrders?: number; lastDeliveryAt?: number; datedDeliveries?: number;
    onTimeDeliveries?: number; rejectedUnits?: number; activityPending?: boolean;
  };
  const [ordersReady, deliveriesReady] = args.includeActivity ? await Promise.all([
    supplierOrderActivityReady(ctx, args.branchId),
    supplierDeliveryActivityReady(ctx, args.branchId),
  ]) : [false, false];
  return mapPage<Doc<'suppliers'>, SupplierDirectoryRow>(ctx, suppliers.paginate(page(args.paginationOpts)), async supplier => {
    const row = supplierRow(supplier, access.buyer);
    if (!args.includeActivity) return row;
    const activity = await readSupplierActivity(ctx, supplier._id, args.branchId);
    return {
      ...row,
      activityPending: !ordersReady || !deliveriesReady,
      openOrders: ordersReady ? activity?.openOrders ?? 0 : undefined,
      ...(deliveriesReady ? {
        lastDeliveryAt: activity?.lastDeliveryAt,
        datedDeliveries: activity?.datedDeliveries ?? 0,
        onTimeDeliveries: activity?.onTimeDeliveries ?? 0,
        rejectedUnits: activity?.rejectedUnits ?? 0,
      } : {}),
    };
  });
}

/** On order for up to 25 visible variants; missing rows read as zero. */
export async function readIncomingFor(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; variantIds: Id<'productVariants'>[] }) {
  await purchasingAccess(ctx, staff, args.branchId, 'read');
  if (args.variantIds.length > PURCHASING_PAGE_SIZE) fail('TOO_MANY_LINES', 'Ask for at most 25 items at a time.');
  return Promise.all(args.variantIds.map(async variantId => ({
    variantId, quantity: (await readIncoming(ctx, args.branchId, variantId))?.quantity ?? 0,
  })));
}

type Entity = Doc<'purchaseEvents'>['entity'];
const ENTITY_TABLE = {
  request: 'purchaseRequests', order: 'purchaseOrders', receipt: 'supplierReceipts', hold: 'purchaseHolds',
} as const;

export async function listHistory(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>; entity: Entity; entityId: string; paginationOpts: PaginationOptions;
}) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  if (args.entity !== 'supplier') {
    const id = ctx.db.normalizeId(ENTITY_TABLE[args.entity], args.entityId);
    const record = id && await stockRead(ctx, () => ctx.db.get(id));
    if (!record || record.branchId !== args.branchId) fail('NOT_FOUND', 'This record is not available at this branch.');
    if (args.entity === 'request' && !canSeeBranchRequests(access) && (record as Doc<'purchaseRequests'>).requesterKey !== actorOf(staff).actorKey) {
      fail('STOCK_FORBIDDEN', 'You can view only your own requests.');
    }
  } else if (!access.buyer) {
    // Supplier edits record contact diffs; like contact details themselves, they are buyer-only.
    fail('STOCK_FORBIDDEN', 'Only buyers can view supplier history.');
  } else if (!ctx.db.normalizeId('suppliers', args.entityId)) {
    fail('NOT_FOUND', 'This supplier does not exist.');
  }
  const events = ctx.db.query('purchaseEvents').withIndex('by_entity_and_entityId_and_createdAt', q =>
    q.eq('entity', args.entity).eq('entityId', args.entityId)).order('desc');
  const scoped = args.entity === 'supplier' && staff.role !== 'owner'
    ? events.filter(q => q.or(
      q.neq(q.field('action'), 'deactivation_requested'),
      q.eq(q.field('branchId'), args.branchId),
      q.and(q.eq(q.field('branchId'), undefined), q.eq(q.field('relatedId'), args.branchId)),
    ))
    : events;
  return mapPage(ctx, scoped.paginate({ ...page(args.paginationOpts), maximumRowsRead: 250 }),
    event => ({ ...omit(event, ['actorKey']), actorLabel: staffDisplayName(event.actorLabel) }));
}
