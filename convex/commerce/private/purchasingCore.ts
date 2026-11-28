/** Shared purchasing rules: access, replay, references, bounded input, snapshots, On order and history. */
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { PAIR_CODE_ALPHABET, sha256 } from '../../shared/displayTokens';
import { resortTodayIso } from '../../shared/time';
import {
  PURCHASING_MAX_LINES, PURCHASING_MAX_LOTS_PER_LINE, PURCHASING_MAX_QUANTITY, PURCHASING_MAX_RECEIPT_LOTS, PURCHASING_MAX_UNIT_COST, PURCHASING_TEXT_LIMITS,
  type CorrectionResult, type OrderPhase, type OrderStatus, type PurchasingResult, type ReceiptLotEvidence,
} from '../purchasingTables';
import { requireStockAccess, type StockPermission } from './stockAccess';
import { stockRead } from './stockLedger';

export type Actor = { actorKey: string; actorLabel: string };
export type StockAccess = Awaited<ReturnType<typeof requireStockAccess>>;

export function fail(code: string, message: string, data: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, message, ...data });
}

export function actorOf(staff: StaffActor): Actor {
  return { actorKey: staff.tokenIdentifier, actorLabel: staffDisplayName(staff.email) };
}

/**
 * A short, human staff name for purchasing documents. Older records stored the login email; it is reduced on every read,
 * so no full address reaches list rows, history or the supplier copy: the local part before any `+tag`, split on
 * separators, without id-like tokens (any digit), title-cased and at most 40 characters. Plain names pass through.
 */
export function staffDisplayName(label: string | undefined) {
  const value = label?.trim() ?? '';
  if (!value) return 'Staff member';
  if (!value.includes('@')) return value.length > 40 ? `${value.slice(0, 39)}…` : value;
  const local = value.split('@')[0].split('+')[0];
  const words = local.split(/[._\-\s]+/).filter(word => word && !/\d/.test(word));
  const name = words.map(word => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  if (!name) return 'Staff member';
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}

/** Current branch and action grant. Always called before replay lookup so revoked access cannot replay. */
export function purchasingAccess(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>, permission: StockPermission) {
  return requireStockAccess(ctx, staff, branchId, permission);
}

export function canSeeBranchRequests(access: StockAccess) {
  return access.approver || access.buyer || access.lead;
}

// ---------- Input bounds ----------

export function quantity(value: number, label: string, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > PURCHASING_MAX_QUANTITY) {
    fail('INVALID_QUANTITY', `${label} must be a whole number from ${min} to ${PURCHASING_MAX_QUANTITY.toLocaleString('en')}.`);
  }
  return value;
}

export function unitCost(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > PURCHASING_MAX_UNIT_COST) {
    fail('INVALID_COST', 'Unit cost must be a whole number of satang.');
  }
  return value;
}

export function text(value: string | undefined, label: string, limit: keyof typeof PURCHASING_TEXT_LIMITS, required = false) {
  const trimmed = value?.trim();
  const max = PURCHASING_TEXT_LIMITS[limit];
  if (required && !trimmed) fail('REASON_REQUIRED', `${label} is required.`);
  if (trimmed && trimmed.length > max) fail('TEXT_TOO_LONG', `${label} must be at most ${max} characters.`);
  return trimmed || undefined;
}

export function reason(value: string | undefined, label = 'Reason') {
  return text(value, label, 'reason', true)!;
}

export function isoDate(value: string | undefined, label: string) {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail('INVALID_DATE', `${label} must be a date.`);
  }
  return value;
}

/**
 * A date that must not be before today in resort time. An unchanged stored value is accepted as-is, so editing an older
 * document never forces a new date.
 */
export function futureIsoDate(value: string | undefined, label: string, previous?: string, now = Date.now()) {
  const date = isoDate(value, label);
  if (date && date !== previous && date < resortTodayIso(now)) {
    fail('DATE_IN_PAST', `${label} can't be in the past.`, { field: label, today: resortTodayIso(now) });
  }
  return date;
}

/** The 5-character random code at the end of a PR/PO/GR reference, for fragment lookup. */
export const referenceCode = (reference: string) => reference.slice(-5);

export function lineCount<T>(lines: T[], label = 'lines') {
  if (lines.length === 0) fail('NO_LINES', `Add at least one of the ${label}.`);
  if (lines.length > PURCHASING_MAX_LINES) fail('TOO_MANY_LINES', `A document can hold at most ${PURCHASING_MAX_LINES} ${label}.`);
  return lines;
}

/** A receipt holds at most 50 entries: posted lines plus held lines (an item both accepted and held counts twice). */
export function receiptEntryCount(lines: unknown[], held: unknown[] | undefined) {
  const count = lines.length + (held?.length ?? 0);
  if (count === 0) fail('NO_LINES', 'Add at least one received or held line.');
  if (count > PURCHASING_MAX_LINES) {
    fail('TOO_MANY_LINES', `A receipt can hold at most ${PURCHASING_MAX_LINES} lines, counting received and held lines together.`);
  }
}

/** Bound lot evidence across one receipt (see PURCHASING_MAX_RECEIPT_LOTS). */
export function receiptLotCount(lines: ReceiptLotEvidence[]) {
  const total = lines.reduce((sum, line) => sum + (line.lotReceipt ? 1 : 0) + (line.lotAllocations?.length ?? 0), 0);
  if (total > PURCHASING_MAX_RECEIPT_LOTS) {
    fail('TOO_MANY_LOTS', `A receipt can name at most ${PURCHASING_MAX_RECEIPT_LOTS} lot entries. Split the delivery across receipts.`, { total });
  }
}

export function uniqueBy<T>(lines: T[], key: (line: T) => string, message: string) {
  const seen = new Set<string>();
  for (const line of lines) {
    const k = key(line);
    if (seen.has(k)) fail('DUPLICATE_LINE', message);
    seen.add(k);
  }
}

/**
 * Duplicate-delivery key: NFKC (full-width, composed and decomposed forms, Thai SARA AM typed as NIKHAHIT + SARA AA),
 * uppercase, Thai digits as ASCII, then letters, combining marks and digits only. So "inv-0042 " and "INV0042" match,
 * Thai references keep their vowels and tone marks (distinct words stay distinct) and are never dropped to empty.
 * ASCII input yields exactly the earlier key, so stored keys stay comparable.
 */
export function deliveryKey(reference: string | undefined) {
  const key = reference?.normalize('NFKC').toUpperCase()
    .replace(/[\u0E50-\u0E59]/g, digit => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  return key || undefined;
}

export function expectRevision(actual: number, expected: number, label: string) {
  if (actual !== expected) fail('STALE', `This ${label} changed since you opened it. Review the latest version and try again.`, { revision: actual });
}

// ---------- Replay ----------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

/** Stable id of one purchasing command; movement source keys derive from it, never from mutable counters. */
export type CommandId = Id<'purchaseOperations'>;

/**
 * Exact canonical replay returns the first result even after later revisions; a changed payload with the same key fails.
 * Callers authorize first. The ledger row is inserted before `execute` so its id is a unique command id; the row,
 * its result and every write commit together in the caller's transaction.
 */
export async function runOnce<R extends PurchasingResult | CorrectionResult = PurchasingResult>(
  ctx: MutationCtx, actor: Actor, branchId: Id<'branches'>, action: string, operationKey: string, payload: unknown,
  execute: (commandId: CommandId) => Promise<R>,
): Promise<R> {
  const key = operationKey.trim();
  if (key.length < 8 || key.length > 100) fail('INVALID_OPERATION_KEY', 'Operation key must contain 8–100 characters.');
  const fingerprint = await sha256(JSON.stringify(canonical(payload)));
  const prior = await ctx.db.query('purchaseOperations').withIndex('by_actorKey_and_branchId_and_action_and_operationKey', q =>
    q.eq('actorKey', actor.actorKey).eq('branchId', branchId).eq('action', action).eq('operationKey', key)).unique();
  if (prior) {
    if (prior.fingerprint !== fingerprint) fail('OPERATION_KEY_REUSED', 'This request key was already used for different details.');
    // One action always stores one result shape, so the stored row is the shape this action returns.
    return prior.result as R;
  }
  reserveWrites(ctx, 2);
  const commandId = await ctx.db.insert('purchaseOperations', {
    actorKey: actor.actorKey, branchId, action, operationKey: key, fingerprint, result: { id: '' }, createdAt: Date.now(),
  });
  const result = await execute(commandId);
  await ctx.db.patch(commandId, { result });
  return result;
}

// ---------- Lot evidence ----------

/**
 * Bound and normalize optional lot evidence for `units` posted units. Core `writeStockMovement` decides whether the
 * item is tracked and checks lots against balances and the original movement.
 */
export function lotEvidence(evidence: ReceiptLotEvidence, units: number, allowReceipt = true): ReceiptLotEvidence {
  const { lotReceipt, lotAllocations } = evidence;
  if (!lotReceipt && !lotAllocations) return {};
  if (!allowReceipt && lotReceipt) fail('INVALID_LOT_EVIDENCE', 'Choose the lots these units came from.');
  if (lotReceipt && lotAllocations) fail('INVALID_LOT_EVIDENCE', 'Enter a new lot or choose existing lots, not both.');
  if (units === 0) fail('INVALID_LOT_EVIDENCE', 'Lot details apply only to accepted units.');
  if (lotReceipt) {
    const code = lotReceipt.code.trim();
    if (!code || code.length > 80) fail('INVALID_LOT_EVIDENCE', 'Lot code must contain 1–80 characters.');
    if (!Number.isSafeInteger(lotReceipt.expiresAt) || lotReceipt.expiresAt <= 0) fail('INVALID_LOT_EVIDENCE', 'Enter a valid lot expiry.');
    return { lotReceipt: { code, expiresAt: lotReceipt.expiresAt } };
  }
  const lots = lotAllocations!;
  if (lots.length === 0 || lots.length > PURCHASING_MAX_LOTS_PER_LINE) {
    fail('INVALID_LOT_EVIDENCE', `Choose 1–${PURCHASING_MAX_LOTS_PER_LINE} lots for a line.`);
  }
  uniqueBy(lots, lot => lot.lotId, 'Each lot can appear once per line.');
  let total = 0;
  for (const lot of lots) total += quantity(lot.quantity, 'Lot quantity');
  if (total !== units) fail('INVALID_LOT_EVIDENCE', 'Lot quantities must add up to the units on the line.', { units, total });
  return { lotAllocations: lots.map(({ lotId, quantity }) => ({ lotId, quantity })) };
}

// ---------- References ----------

type ReferenceTable = 'purchaseRequests' | 'purchaseOrders' | 'supplierReceipts';

/** PR-261127-7KQ4M: date plus random suffix, checked against the reference index. No shared counter. */
export async function newReference(ctx: MutationCtx, table: ReferenceTable, prefix: 'PR' | 'PO' | 'GR', now = Date.now()) {
  const date = resortTodayIso(now).slice(2).replaceAll('-', '');
  for (let attempt = 0; attempt < 6; attempt++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    const suffix = [...bytes].map(b => PAIR_CODE_ALPHABET[b % PAIR_CODE_ALPHABET.length]).join('');
    const reference = `${prefix}-${date}-${suffix}`;
    const taken = await ctx.db.query(table).withIndex('by_reference', q => q.eq('reference', reference)).first();
    if (!taken) return reference;
  }
  return fail('REFERENCE_UNAVAILABLE', 'Could not allocate a reference. Try again.');
}

// ---------- Items and suppliers ----------

export type ItemRead = { variant: Doc<'productVariants'>; product: Doc<'products'>; item: Doc<'purchaseOrderLines'>['item'] };

export async function readItem(ctx: QueryCtx, variantId: Id<'productVariants'>): Promise<ItemRead> {
  const variant = await ctx.db.get(variantId);
  const product = variant && await ctx.db.get(variant.productId);
  if (!variant || !product) fail('ITEM_NOT_FOUND', 'This item no longer exists.', { variantId });
  return { variant, product, item: { productName: product.name, variantLabel: variant.label, ...(variant.sku ? { sku: variant.sku } : {}) } };
}

export function itemActive({ variant, product }: ItemRead) {
  return variant.status !== 'archived' && product.status !== 'archived';
}

/** Archived items block submission, approval, issue and quantity increases; issued lines remain receivable. */
export async function requireActiveItems(ctx: QueryCtx, variantIds: Id<'productVariants'>[]) {
  const reads = await Promise.all(variantIds.map(id => readItem(ctx, id)));
  const inactive = reads.filter(read => !itemActive(read)).map(read => read.variant._id);
  if (inactive.length) fail('ITEM_INACTIVE', 'Archived items must be removed or replaced before continuing.', { variantIds: inactive });
  return reads;
}

export async function requireSupplier(ctx: QueryCtx, supplierId: Id<'suppliers'>, active = true) {
  const supplier = await ctx.db.get(supplierId);
  if (!supplier) fail('SUPPLIER_NOT_FOUND', 'This supplier no longer exists.');
  if (active && supplier.status !== 'active') fail('SUPPLIER_INACTIVE', 'This supplier is inactive. Choose another supplier.');
  return supplier;
}

export function supplierSnapshot(supplier: Doc<'suppliers'>): Doc<'purchaseOrders'>['supplier'] {
  return {
    name: supplier.name,
    address: supplier.address,
    taxId: supplier.taxId,
    paymentTerms: supplier.paymentTerms,
    leadTimeDays: supplier.leadTimeDays,
    deliveryDays: supplier.deliveryDays,
    minimumOrder: supplier.minimumOrder,
    ...(supplier.contactName ? { contactName: supplier.contactName } : {}),
    ...(supplier.phone ? { phone: supplier.phone } : {}),
    ...(supplier.email ? { email: supplier.email } : {}),
  };
}

// ---------- On order projection ----------

export async function readIncoming(ctx: QueryCtx, branchId: Id<'branches'>, variantId: Id<'productVariants'>) {
  return stockRead(ctx, () => ctx.db.query('stockIncoming').withIndex('by_branch_variant', q => q.eq('branchId', branchId).eq('variantId', variantId)).unique());
}

/** Adjust On order only when due changes, in the same transaction as the PO line. */
export async function adjustIncoming(ctx: MutationCtx, branchId: Id<'branches'>, variantId: Id<'productVariants'>, delta: number) {
  if (delta === 0) return;
  const row = await readIncoming(ctx, branchId, variantId);
  const next = (row?.quantity ?? 0) + delta;
  if (next < 0) fail('INCOMING_DRIFT', 'On order would become negative. Ask an administrator to reconcile purchasing.');
  reserveWrites(ctx, 1);
  if (row) await ctx.db.patch(row._id, { quantity: next });
  else await ctx.db.insert('stockIncoming', { branchId, variantId, quantity: next });
}

// ---------- Order lines ----------

/** Units still due; never negative (an over-delivery accepted within the branch tolerance leaves 0 due). */
export const lineDue = (line: Pick<Doc<'purchaseOrderLines'>, 'ordered' | 'cancelled' | 'accepted'>) =>
  Math.max(0, line.ordered - line.cancelled - line.accepted);

export const ISSUED_OPEN: OrderStatus[] = ['ordered', 'partially_received'];

export function phaseOf(status: OrderStatus): OrderPhase {
  if (status === 'draft' || status === 'awaiting_approval') return 'draft';
  if (status === 'deleted') return 'deleted';
  return status === 'ordered' || status === 'partially_received' ? 'open' : 'closed';
}

/** At most one draft or open replacement can own a hold at a time. */
export async function otherHoldReplacement(ctx: QueryCtx, holdId: Id<'purchaseHolds'>, orderId?: Id<'purchaseOrders'>) {
  for (const phase of ['draft', 'open'] as const) {
    const orders = await stockRead(ctx, () => ctx.db.query('purchaseOrders')
      .withIndex('by_forHoldId_and_phase', q => q.eq('forHoldId', holdId).eq('phase', phase)).take(2));
    const other = orders.find(order => order._id !== orderId);
    if (other) return other;
  }
  return null;
}

export async function correctionClosesRemainder(ctx: QueryCtx, order: Doc<'purchaseOrders'> | null) {
  if (order?.status === 'closed_short' || order?.status === 'cancelled') return true;
  return order?.status === 'received' && !!order.forHoldId &&
    !!(await otherHoldReplacement(ctx, order.forHoldId, order._id));
}

/** A pre-feature line: units were accepted before accepted value and rejection counts were kept. */
export const isLegacyLine = (line: Pick<Doc<'purchaseOrderLines'>, 'accepted' | 'rejected' | 'acceptedValue'>) =>
  line.acceptedValue === undefined || line.rejected === undefined;

/**
 * Accepted value of a line at each receipt's recorded unit cost. A pre-feature line with accepted units has no exact
 * value until it is reconstructed (`seedLegacyLine` or the chunked rebuild); policy checks that must compare amounts use
 * this estimate only on both sides of the same comparison, and it is never persisted.
 */
export const lineAcceptedValue = (line: Pick<Doc<'purchaseOrderLines'>, 'accepted' | 'unitCost' | 'acceptedValue'>) =>
  line.acceptedValue ?? line.accepted * (line.unitCost ?? 0);

/** Receipt lines one transaction reads to reconstruct a pre-feature line; longer histories use the chunked rebuild. */
export const LEGACY_RECEIPT_SCAN = 100;

/** Exact accepted value and rejections from a slice of a line's receipt lines (accepted − corrected at recorded cost). */
export const receiptValuation = (rows: Pick<Doc<'supplierReceiptLines'>, 'accepted' | 'corrected' | 'rejected' | 'unitCost'>[]) => ({
  acceptedValue: rows.reduce((sum, row) => sum + (row.accepted - row.corrected) * (row.unitCost ?? 0), 0),
  rejected: rows.reduce((sum, row) => sum + row.rejected, 0),
});

/**
 * Lines written before accepted value and rejection counts were kept have neither. Reconstruct both exactly from the
 * line's immutable receipt lines, so repricing or a later receipt never revalues history. Call before the current command
 * writes any receipt line or correction for it. A line with more than LEGACY_RECEIPT_SCAN receipts is never estimated:
 * the costing write fails with the retryable VALUATION_PENDING until the operator's chunked rebuild has valued it.
 */
export async function seedLegacyLine(ctx: QueryCtx, line: Doc<'purchaseOrderLines'>): Promise<Doc<'purchaseOrderLines'>> {
  if (!isLegacyLine(line)) return line;
  const receipts = await stockRead(ctx, () => ctx.db.query('supplierReceiptLines')
    .withIndex('by_orderLineId', q => q.eq('orderLineId', line._id)).take(LEGACY_RECEIPT_SCAN + 1));
  if (receipts.length > LEGACY_RECEIPT_SCAN) {
    fail('VALUATION_PENDING', 'This order line has a long receipt history that is still being valued. Try again after the purchasing valuation backfill finishes.', {
      orderLineId: line._id,
    });
  }
  const exact = receiptValuation(receipts);
  return { ...line, acceptedValue: line.acceptedValue ?? exact.acceptedValue, rejected: line.rejected ?? exact.rejected };
}

/**
 * Header counters and status from its lines (≤ 50). An explicitly closed order stays closed.
 * Value: received at receipt costs plus the open commitment (due × current cost); `totalCost` is their sum, so a
 * repriced amendment changes only what is still outstanding. `unpricedLines` counts committed lines with no cost.
 * While any line with accepted units is pre-feature, `receivedValue` is unknown (omitted) and `totalCost` keeps its
 * pre-feature meaning (committed × current cost); no estimated historical value is stored.
 */
export function orderSummary(order: Doc<'purchaseOrders'>, lines: Doc<'purchaseOrderLines'>[]) {
  let orderedUnits = 0, acceptedUnits = 0, dueUnits = 0, openLineCount = 0, receivedValue = 0, outstandingValue = 0;
  let unpricedLines = 0, rejectedUnits = 0, legacyTotal = 0, legacy = false;
  for (const line of lines) {
    const committed = line.ordered - line.cancelled;
    const due = lineDue(line);
    orderedUnits += committed;
    acceptedUnits += line.accepted;
    rejectedUnits += line.rejected ?? 0;
    dueUnits += due;
    if (due > 0) openLineCount++;
    if (line.acceptedValue === undefined && line.accepted > 0) legacy = true;
    receivedValue += line.acceptedValue ?? 0;
    outstandingValue += Math.max(0, due) * (line.unitCost ?? 0);
    legacyTotal += committed * (line.unitCost ?? 0);
    if (committed > 0 && line.unitCost === undefined) unpricedLines++;
  }
  let status: OrderStatus = order.status;
  if (status === 'closed_short' || status === 'cancelled') {
    status = acceptedUnits > 0 ? 'closed_short' : 'cancelled';
  } else if (status !== 'draft' && status !== 'deleted' && status !== 'awaiting_approval') {
    status = dueUnits === 0 ? 'received' : acceptedUnits > 0 ? 'partially_received' : 'ordered';
  }
  return {
    orderedUnits, acceptedUnits, dueUnits, openLineCount, totalCost: legacy ? legacyTotal : receivedValue + outstandingValue,
    receivedValue: legacy ? undefined : receivedValue, outstandingValue, unpricedLines, rejectedUnits,
    status, phase: phaseOf(status), lineCount: lines.length,
  };
}

/** Line subtotals and the order total must stay exact integers of satang. Checked wherever cost or quantity can grow. */
export function assertSafeTotals(lines: Pick<Doc<'purchaseOrderLines'>, 'ordered' | 'cancelled' | 'unitCost'>[]) {
  let total = 0;
  for (const line of lines) {
    const subtotal = (line.ordered - line.cancelled) * (line.unitCost ?? 0);
    total += subtotal;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total)) {
      fail('TOTAL_TOO_LARGE', 'This order total is too large. Split it into smaller orders.');
    }
  }
}

export function readOrderLines(ctx: QueryCtx, orderId: Id<'purchaseOrders'>) {
  return stockRead(ctx, () => ctx.db.query('purchaseOrderLines').withIndex('by_orderId_and_sort', q => q.eq('orderId', orderId)).take(PURCHASING_MAX_LINES));
}

export function readRequestLines(ctx: QueryCtx, requestId: Id<'purchaseRequests'>) {
  return stockRead(ctx, () => ctx.db.query('purchaseRequestLines').withIndex('by_requestId_and_sort', q => q.eq('requestId', requestId)).take(PURCHASING_MAX_LINES));
}

/** Approved quantity not yet committed; zero unless the request is still open (approved). */
export function availableApproval(line: Doc<'purchaseRequestLines'>) {
  return line.requestStatus === 'approved' ? Math.max(0, line.approvedQuantity - line.committedQuantity) : 0;
}

/**
 * Release or commit approved quantity for a request-backed line. Releases always apply; reuse depends on status.
 * Callers refresh the request's Fully ordered flag once afterwards (`refreshFullyOrdered`; an order has one source request).
 */
export async function shiftCommitment(ctx: MutationCtx, requestLineId: Id<'purchaseRequestLines'> | undefined, delta: number) {
  if (!requestLineId || delta === 0) return;
  const line = await ctx.db.get(requestLineId);
  if (!line) fail('REQUEST_LINE_NOT_FOUND', 'The approved request line no longer exists.');
  if (delta > 0 && delta > availableApproval(line)) {
    fail('ALLOCATION_CHANGED', 'Another order used this approval. Review the quantities still available.', {
      lines: [{ requestLineId, available: availableApproval(line) }],
    });
  }
  reserveWrites(ctx, 1);
  await ctx.db.patch(requestLineId, { committedQuantity: Math.max(0, line.committedQuantity + delta) });
}

/**
 * An approved request whose every line is fully committed shows Fully ordered and leaves the default Approved queue.
 * Closing a PO remainder releases commitment, which clears the flag again. Reads the request's lines (≤ 50).
 */
export async function refreshFullyOrdered(ctx: MutationCtx, requestId: Id<'purchaseRequests'> | undefined) {
  if (!requestId) return;
  const request = await ctx.db.get(requestId);
  if (!request) return;
  const lines = await readRequestLines(ctx, requestId);
  const fullyOrdered = request.status === 'approved' && lines.some(line => line.approvedQuantity > 0) &&
    lines.every(line => line.committedQuantity >= line.approvedQuantity);
  if ((request.fullyOrdered ?? false) === fullyOrdered && request.fullyOrdered !== undefined) return;
  reserveWrites(ctx, 1);
  await ctx.db.patch(requestId, { fullyOrdered });
}

// ---------- History ----------

type HistoryChange = NonNullable<Doc<'purchaseEvents'>['changes']>[number];
type HistoryValue = HistoryChange['before'];
/** One edit event keeps at most this many changes, each value at most this many characters. */
export const HISTORY_MAX_CHANGES = 20;
const HISTORY_MAX_TEXT = 120;

const historyValue = (value: string | number | boolean | null | undefined): HistoryValue =>
  value === undefined ? null : typeof value === 'string' && value.length > HISTORY_MAX_TEXT ? `${value.slice(0, HISTORY_MAX_TEXT - 1)}…` : value;

/** A draft line as history shows it: identity (variant), display label, quantity and optional unit cost. */
export type DiffLine = { variantId: string; item: ItemRead['item']; quantity: number; unitCost?: number };
export const itemLabel = (item: ItemRead['item']) => `${item.productName} · ${item.variantLabel}${item.sku ? ` (${item.sku})` : ''}`;

/**
 * Concise before/after changes for a draft edit: changed header scalars, then added, removed and changed lines keyed by
 * variant. Bounded to HISTORY_MAX_CHANGES entries; any overflow is summarized by one `changes.omitted` count.
 */
export function draftChanges(
  header: { before: Record<string, string | number | null | undefined>; after: Record<string, string | number | null | undefined> },
  lines: { before: DiffLine[]; after: DiffLine[] },
): HistoryChange[] {
  const changes: HistoryChange[] = [];
  const push = (field: string, before: string | number | null | undefined, after: string | number | null | undefined) => {
    if ((before ?? null) !== (after ?? null)) changes.push({ field, before: historyValue(before), after: historyValue(after) });
  };
  for (const field of Object.keys(header.after)) push(field, header.before[field], header.after[field]);
  const old = new Map(lines.before.map(line => [line.variantId, line]));
  for (const line of lines.after) {
    const prior = old.get(line.variantId);
    const label = `lines[${itemLabel(line.item)}]`;
    old.delete(line.variantId);
    if (!prior) { push(label, null, line.quantity); continue; }
    push(`${label}.item`, itemLabel(prior.item), itemLabel(line.item));
    push(`${label}.quantity`, prior.quantity, line.quantity);
    push(`${label}.unitCost`, prior.unitCost, line.unitCost);
  }
  for (const line of old.values()) push(`lines[${itemLabel(line.item)}]`, line.quantity, null);
  if (changes.length <= HISTORY_MAX_CHANGES) return changes;
  const kept = changes.slice(0, HISTORY_MAX_CHANGES - 1);
  return [...kept, { field: 'changes.omitted', before: null, after: changes.length - kept.length }];
}

type EventInput = Omit<Doc<'purchaseEvents'>, '_id' | '_creationTime' | 'createdAt' | 'actorKey' | 'actorLabel'>;

export async function recordEvent(ctx: MutationCtx, actor: Actor, event: EventInput) {
  reserveWrites(ctx, 1);
  await ctx.db.insert('purchaseEvents', { ...event, ...actor, createdAt: Date.now() });
}
