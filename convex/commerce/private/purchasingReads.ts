/** Branch-scoped purchasing reads. Lists page 25 headers from one indexed range; details load only when opened. */
import { omit } from 'convex-helpers';
import type { PaginationOptions, PaginationResult } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { readBudget } from '../../lib/readBudget';
import { PURCHASING_MAX_LINES, PURCHASING_PAGE_SIZE, type OrderPhase, type OrderStatus, type RequestStatus } from '../purchasingTables';
import {
  actorOf, availableApproval, canSeeBranchRequests, correctionClosesRemainder, fail, ISSUED_OPEN, lineDue, purchasingAccess, quantity, readIncoming,
  readOrderLines, readRequestLines, type StockAccess,
} from './purchasingCore';
import { assessCorrection, eligibleUnits, openLineReport } from './purchasingReceipts';
import { supplierNameKey } from './purchasingSuppliers';
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

export function requestRow(request: Doc<'purchaseRequests'>, me: string) {
  return { ...omit(request, ['requesterKey', 'decidedByKey']), mine: request.requesterKey === me };
}
type SupplierSnapshot = Doc<'purchaseOrders'>['supplier'];
/** Supplier contact details are buyer-only, including the snapshots on orders, revisions and receipts. */
export const supplierFor = (supplier: SupplierSnapshot, buyer: boolean): SupplierSnapshot => (buyer ? supplier : { name: supplier.name });
export const orderRow = (order: Doc<'purchaseOrders'>, buyer: boolean) =>
  ({ ...omit(order, ['createdByKey']), supplier: supplierFor(order.supplier, buyer) });
export function receiptRow(receipt: Doc<'supplierReceipts'>, buyer: boolean) {
  const row = omit(receipt, ['actorKey', 'deliveryKey']);
  return receipt.supplier ? { ...row, supplier: supplierFor(receipt.supplier, buyer) } : row;
}
export const holdRow = (hold: Doc<'purchaseHolds'>) => omit(hold, ['resolvedByKey']);
export const adjustmentRow = (adjustment: Doc<'supplierReceiptAdjustments'>) => omit(adjustment, ['actorKey']);
export const requestLineRow = (line: Doc<'purchaseRequestLines'>) => ({ ...omit(line, ['requesterKey']), available: availableApproval(line) });
export function orderLineRow(line: Doc<'purchaseOrderLines'>) { return { ...line, due: lineDue(line) }; }
export function receiptLineRow(line: Doc<'supplierReceiptLines'>) { return { ...line, eligible: eligibleUnits(line) }; }
/** One row shape for every caller; contact fields are simply absent for non-buyers. */
export function supplierRow(supplier: Doc<'suppliers'>, buyer: boolean): Doc<'suppliers'> {
  const { contactName, phone, email, note, ...rest } = supplier;
  return buyer ? { ...rest, contactName, phone, email, note } : rest;
}

// ---------- Requests ----------

export type RequestView =
  | { kind: 'mine' } | { kind: 'all' } | { kind: 'status'; status: RequestStatus } | { kind: 'item'; variantId: Id<'productVariants'> };

/** Requesters see their own requests; approvers, buyers and stock leads see the branch. */
export async function listRequests(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; view: RequestView; paginationOpts: PaginationOptions }) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const me = actorOf(staff).actorKey;
  const branchWide = canSeeBranchRequests(access);
  const { view, branchId } = args;
  if (!branchWide && (view.kind === 'all' || view.kind === 'status')) fail('STOCK_FORBIDDEN', 'You can view only your own requests at this branch.');
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

export async function getRequest(ctx: QueryCtx, staff: StaffActor, requestId: Id<'purchaseRequests'>) {
  const { request, access } = await readableRequest(ctx, staff, requestId);
  const [lines, orders] = await Promise.all([
    readRequestLines(ctx, request._id),
    stockRead(ctx, () => ctx.db.query('purchaseOrders').withIndex('by_requestId', q => q.eq('requestId', request._id)).take(PURCHASING_PAGE_SIZE)),
  ]);
  return {
    request: requestRow(request, actorOf(staff).actorKey), lines: lines.map(requestLineRow),
    orders: orders.filter(order => order.status !== 'deleted').map(order => orderRow(order, access.buyer)), permissions: permissions(access),
  };
}

export function permissions(access: StockAccess) {
  return {
    requester: access.requester, approver: access.approver, buyer: access.buyer, receiver: access.receiver, lead: access.lead,
    directOrder: access.directOrder, directReceipt: access.directReceipt,
  };
}

// ---------- Orders ----------

export type OrderView =
  | { kind: 'phase'; phase: OrderPhase } | { kind: 'status'; status: OrderStatus }
  | { kind: 'supplier'; supplierId: Id<'suppliers'> } | { kind: 'item'; variantId: Id<'productVariants'>; openOnly: boolean };

export async function listOrders(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; view: OrderView; paginationOpts: PaginationOptions }) {
  const { buyer } = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const { view, branchId } = args;
  if (view.kind === 'item') {
    const lines = view.openOnly
      ? ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q => q.eq('branchId', branchId).eq('variantId', view.variantId).eq('open', true))
      : ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q => q.eq('branchId', branchId).eq('variantId', view.variantId));
    return mapPage(ctx, lines.order('desc').paginate(page(args.paginationOpts)), async line => {
      const order = await get(ctx, line.orderId);
      return order && order.status !== 'deleted' ? { ...orderRow(order, buyer), line: orderLineRow(line) } : null;
    });
  }
  const headers = view.kind === 'phase'
    ? ctx.db.query('purchaseOrders').withIndex('by_branchId_and_phase_and_updatedAt', q => q.eq('branchId', branchId).eq('phase', view.phase))
    : view.kind === 'status'
      ? ctx.db.query('purchaseOrders').withIndex('by_branchId_and_status_and_updatedAt', q => q.eq('branchId', branchId).eq('status', view.status))
      : ctx.db.query('purchaseOrders').withIndex('by_branchId_and_supplierId_and_updatedAt', q => q.eq('branchId', branchId).eq('supplierId', view.supplierId));
  return mapPage(ctx, headers.order('desc').paginate(page(args.paginationOpts)), order =>
    order.status === 'deleted' && view.kind !== 'status' ? null : { ...orderRow(order, buyer), line: null });
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
  return {
    order: orderRow(order, access.buyer), lines: lines.map(orderLineRow),
    holds: related.map(holdRow), acceptableHolds: ISSUED_OPEN.includes(order.status) ? acceptableHolds(order, lines, related) : [],
    permissions: permissions(access),
  };
}

const revisionSummary = ({ revision, issuedAt, actorLabel, reason }: Doc<'purchaseOrderRevisions'>) => ({ revision, issuedAt, actorLabel, reason });

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
  return { ...omit(row, ['actorKey']), supplier: supplierFor(row.supplier, access.buyer), branchName: (await get(ctx, order.branchId))?.name ?? '' };
}

export async function listOrderReceipts(ctx: QueryCtx, staff: StaffActor, orderId: Id<'purchaseOrders'>, paginationOpts: PaginationOptions) {
  const { order, access } = await readableOrder(ctx, staff, orderId);
  return mapPage(ctx, ctx.db.query('supplierReceipts').withIndex('by_orderId', q => q.eq('orderId', order._id)).order('desc').paginate(page(paginationOpts)),
    receipt => receiptRow(receipt, access.buyer));
}

// ---------- Receipts and holds ----------

export async function getReceipt(ctx: QueryCtx, staff: StaffActor, receiptId: Id<'supplierReceipts'>) {
  const receipt = await get(ctx, receiptId);
  if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt no longer exists.');
  const access = await purchasingAccess(ctx, staff, receipt.branchId, 'read');
  const [lines, holds] = await Promise.all([
    stockRead(ctx, () => ctx.db.query('supplierReceiptLines').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id)).take(PURCHASING_MAX_LINES)),
    stockRead(ctx, () => ctx.db.query('purchaseHolds').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id)).take(PURCHASING_MAX_LINES)),
  ]);
  return {
    receipt: receiptRow(receipt, access.buyer), lines: lines.map(receiptLineRow),
    holds: holds.map(holdRow), permissions: permissions(access),
  };
}

/** Held goods queue: unresolved holds from orders of any status. */
export async function listHolds(ctx: QueryCtx, staff: StaffActor, args: { branchId: Id<'branches'>; status: Doc<'purchaseHolds'>['status']; paginationOpts: PaginationOptions }) {
  await purchasingAccess(ctx, staff, args.branchId, 'read');
  return mapPage(ctx, ctx.db.query('purchaseHolds').withIndex('by_branchId_and_status_and_createdAt', q =>
    q.eq('branchId', args.branchId).eq('status', args.status)).order('desc').paginate(page(args.paginationOpts)), holdRow);
}

/** Receipt adjustments (corrections, supplier returns, reversals), newest first. */
export async function listReceiptAdjustments(ctx: QueryCtx, staff: StaffActor, receiptId: Id<'supplierReceipts'>, paginationOpts: PaginationOptions) {
  const receipt = await get(ctx, receiptId);
  if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt no longer exists.');
  await purchasingAccess(ctx, staff, receipt.branchId, 'read');
  return mapPage(ctx, ctx.db.query('supplierReceiptAdjustments').withIndex('by_receiptId', q => q.eq('receiptId', receipt._id))
    .order('desc').paginate(page(paginationOpts)), adjustmentRow);
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
    dueAfter: orderLine ? (closed ? 0 : lineDue(orderLine) + args.quantity) : null,
    remainderClosed: closed,
  };
}

// ---------- Suppliers, On order and history ----------

export async function listSuppliers(ctx: QueryCtx, staff: StaffActor, args: {
  branchId: Id<'branches'>; search?: string; status: Doc<'suppliers'>['status']; paginationOpts: PaginationOptions;
}) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'read');
  const prefix = supplierNameKey(args.search ?? '').slice(0, 120);
  return mapPage(ctx, ctx.db.query('suppliers').withIndex('by_status_and_nameKey', q => {
    const status = q.eq('status', args.status);
    return prefix ? status.gte('nameKey', prefix).lt('nameKey', `${prefix}￿`) : status;
  }).paginate(page(args.paginationOpts)), supplier => supplierRow(supplier, access.buyer));
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
  return mapPage(ctx, ctx.db.query('purchaseEvents').withIndex('by_entity_and_entityId_and_createdAt', q =>
    q.eq('entity', args.entity).eq('entityId', args.entityId)).order('desc').paginate(page(args.paginationOpts)), event => omit(event, ['actorKey']));
}
