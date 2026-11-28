import { projectSupplierOrder } from './supplierActivity';
import { addDays } from '../../shared/dates';
import { resortTodayIso } from '../../shared/time';
/** Purchase orders: Draft → Ordered → Partially received → Received; Close remainder → Closed short | Cancelled. */
import { omit } from 'convex-helpers';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import type { PurchasingResult } from '../purchasingTables';
import {
  actorOf, adjustIncoming, assertReplacementLines, assertSafeTotals, availableApproval, draftChanges, expectRevision, fail, futureIsoDate, ISSUED_OPEN, itemLabel, lineCount, lineDue,
  newReference, orderSummary, otherHoldReplacement, purchasingAccess, quantity, readItem, readOrderLines, readRequestLines, reason,
  recordEvent, referenceCode, refreshFullyOrdered, requireActiveItems, requireSupplier, runOnce, shiftCommitment, supplierSnapshot, text, uniqueBy, unitCost,
  isLegacyLine, LEGACY_RECEIPT_SCAN, lineAcceptedValue, receiptValuation, seedLegacyLine, type Actor, type StockAccess,
} from './purchasingCore';

type DraftLine = {
  variantId: Id<'productVariants'>; quantity: number; unitCost?: number; requestLineId?: Id<'purchaseRequestLines'>;
  /** Price to be confirmed: lets the line issue without a unit cost (prints as TBC). */
  priceTbc?: boolean;
};

/**
 * Issue needs a price on every line, or an explicit TBC flag. Drafts stay lenient, and so does a linked replacement for
 * held or returned goods (the supplier usually replaces them at no charge).
 */
function requirePrices(order: Pick<Doc<'purchaseOrders'>, 'forHoldId' | 'replacesReturnId'>, lines: Pick<Doc<'purchaseOrderLines'>, '_id' | 'unitCost' | 'priceTbc'>[]) {
  if (order.forHoldId || order.replacesReturnId) return;
  const unpriced = lines.filter(line => line.unitCost === undefined && !line.priceTbc).map(line => line._id);
  if (unpriced.length) {
    fail('PRICE_REQUIRED', 'Enter a unit cost on every line, or mark it Price to be confirmed, before issuing.', { orderLineIds: unpriced });
  }
}

export type SaveOrderArgs = {
  branchId: Id<'branches'>; orderId?: Id<'purchaseOrders'>; expectedRevision?: number;
  supplierId: Id<'suppliers'>; requestId?: Id<'purchaseRequests'>;
  expectedDate?: string; supplierReference?: string; note?: string;
  replacesReturnId?: Id<'supplierReceiptAdjustments'>; forHoldId?: Id<'purchaseHolds'>;
  lines: DraftLine[]; operationKey: string;
};

function requireDirect(access: StockAccess) {
  if (!access.directOrder) fail('DIRECT_ORDER_DISABLED', 'Direct orders are off for this branch. Start from an approved request.');
}

/** Any stored order, including a logically deleted draft, so callers can authorize and replay before checking state. */
async function loadOrder(ctx: MutationCtx, orderId: Id<'purchaseOrders'>) {
  const order = await ctx.db.get(orderId);
  if (!order) fail('ORDER_NOT_FOUND', 'This order no longer exists.');
  return order;
}

function requireLive(order: Doc<'purchaseOrders'>) {
  if (order.status === 'deleted') fail('ORDER_NOT_FOUND', 'This order no longer exists.');
}

/** Each request-backed line links to an approved line of the one source request, for the same variant. */
async function validateSource(ctx: MutationCtx, branchId: Id<'branches'>, requestId: Id<'purchaseRequests'> | undefined, lines: DraftLine[]) {
  if (!requestId) {
    if (lines.some(line => line.requestLineId)) fail('REQUEST_LINE_MISMATCH', 'Choose the source request for these lines.');
    return;
  }
  const request = await ctx.db.get(requestId);
  if (!request || request.branchId !== branchId) fail('REQUEST_NOT_FOUND', 'The source request is not available for this branch.');
  if (request.status !== 'approved') fail('REQUEST_STATE', 'Orders can only start from an open approved request.');
  const requestLines = new Map((await readRequestLines(ctx, requestId)).map(line => [line._id, line]));
  for (const line of lines) {
    const source = line.requestLineId && requestLines.get(line.requestLineId);
    if (!source || source.variantId !== line.variantId) fail('REQUEST_LINE_MISMATCH', 'Each line must match an approved line on the request.');
  }
}

/** A replacement goes to the supplier that delivered the source goods; a substitution changes the item, not the supplier. */
async function requireSourceSupplier(ctx: MutationCtx, receiptId: Id<'supplierReceipts'>, supplierId: Id<'suppliers'>) {
  const source = await ctx.db.get(receiptId);
  if (source?.supplierId && source.supplierId !== supplierId) {
    fail('SUPPLIER_MISMATCH', 'A replacement order must go to the supplier that delivered the original goods.', { supplierId: source.supplierId });
  }
}

/**
 * Linked return or hold must belong to this branch and come from this order's supplier (when the source receipt names one).
 * A hold must still be open, its item must be on the order, and it has at most one outstanding (draft or open) replacement.
 */
async function validateLink(
  ctx: MutationCtx, branchId: Id<'branches'>, args: Pick<SaveOrderArgs, 'replacesReturnId' | 'forHoldId' | 'supplierId'>,
  variantIds: Id<'productVariants'>[], orderId?: Id<'purchaseOrders'>,
) {
  if (args.replacesReturnId) {
    const ret = await ctx.db.get(args.replacesReturnId);
    if (!ret || ret.branchId !== branchId || ret.kind !== 'supplier_return') fail('LINK_NOT_FOUND', 'The supplier return is not available.');
    await requireSourceSupplier(ctx, ret.receiptId, args.supplierId);
  }
  if (args.forHoldId) {
    const holdId = args.forHoldId;
    const hold = await ctx.db.get(holdId);
    if (!hold || hold.branchId !== branchId || hold.status !== 'open') fail('LINK_NOT_FOUND', 'The held goods are no longer open.');
    if (!variantIds.includes(hold.variantId)) fail('LINK_MISMATCH', 'Add the held item to this order before linking the held goods.');
    await requireSourceSupplier(ctx, hold.receiptId, args.supplierId);
    const other = await otherHoldReplacement(ctx, holdId, orderId);
    if (other) {
      fail('REPLACEMENT_EXISTS', 'These held goods already have a replacement order. Use or cancel that order first.', { orderId: other._id, reference: other.reference });
    }
  }
}

export async function saveOrderDraft(ctx: MutationCtx, staff: StaffActor, args: SaveOrderArgs) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'order.save', operationKey, payload, async (): Promise<PurchasingResult> => {
    if (!args.requestId) requireDirect(access);
    lineCount(args.lines, 'order lines');
    uniqueBy(args.lines, line => line.variantId, 'Each item can appear once per order.');
    for (const line of args.lines) {
      quantity(line.quantity, 'Order quantity'); unitCost(line.unitCost);
      if (line.priceTbc && line.unitCost !== undefined) fail('INVALID_COST', 'A line with a unit cost is not Price to be confirmed.');
    }
    assertSafeTotals(args.lines.map(line => ({ ordered: line.quantity, cancelled: 0, unitCost: line.unitCost })));
    await validateSource(ctx, args.branchId, args.requestId, args.lines);
    await validateLink(ctx, args.branchId, args, args.lines.map(line => line.variantId), args.orderId);
    if (args.replacesReturnId) await assertReplacementLines(ctx, args.replacesReturnId, args.lines, args.orderId);
    const supplier = await requireSupplier(ctx, args.supplierId);
    const reads = await Promise.all(args.lines.map(line => readItem(ctx, line.variantId)));
    const previous = args.orderId ? await ctx.db.get(args.orderId) : null;
    const header = {
      supplierId: supplier._id, supplier: supplierSnapshot(supplier), requestId: args.requestId,
      expectedDate: !args.orderId && args.expectedDate === undefined && supplier.leadTimeDays !== undefined
        ? addDays(resortTodayIso(), supplier.leadTimeDays)
        : futureIsoDate(args.expectedDate, 'Expected date', previous?.expectedDate),
      supplierReference: text(args.supplierReference, 'Supplier reference', 'reference'),
      note: text(args.note, 'Note', 'note'),
      replacesReturnId: args.replacesReturnId, forHoldId: args.forHoldId,
    };
    const now = Date.now();
    let orderId: Id<'purchaseOrders'>, reference: string, revision: number;
    let changes: ReturnType<typeof draftChanges> | undefined;
    if (args.orderId) {
      const order = await loadOrder(ctx, args.orderId);
      requireLive(order);
      if (order.branchId !== args.branchId) fail('ORDER_NOT_FOUND', 'This order belongs to another branch.');
      if (order.status !== 'draft') fail('ORDER_STATE', 'Only a draft can be edited. Use Amend on an issued order.');
      expectRevision(order.revision, args.expectedRevision ?? -1, 'order');
      const old = await readOrderLines(ctx, order._id);
      const headerView = (h: Pick<Doc<'purchaseOrders'>, 'supplier' | 'requestId' | 'expectedDate' | 'supplierReference' | 'note' | 'replacesReturnId' | 'forHoldId'>) => ({
        supplier: h.supplier.name, requestId: h.requestId, expectedDate: h.expectedDate, supplierReference: h.supplierReference,
        note: h.note, replacesReturnId: h.replacesReturnId, forHoldId: h.forHoldId,
      });
      changes = draftChanges(
        { before: headerView(order), after: headerView(header) },
        { before: old.map(line => ({ variantId: line.variantId, item: line.item, quantity: line.ordered, unitCost: line.unitCost })),
          after: args.lines.map((line, i) => ({ variantId: line.variantId, item: reads[i].item, quantity: line.quantity, unitCost: line.unitCost })) },
      );
      reserveWrites(ctx, old.length + 1);
      for (const line of old) await ctx.db.delete(line._id);
      ({ _id: orderId, reference } = order);
      revision = order.revision + 1;
      await ctx.db.patch(orderId, { ...header, revision, updatedAt: now });
    } else {
      reference = await newReference(ctx, 'purchaseOrders', 'PO', now);
      revision = 1;
      reserveWrites(ctx, 1);
      orderId = await ctx.db.insert('purchaseOrders', {
        branchId: args.branchId, reference, referenceCode: referenceCode(reference), status: 'draft', phase: 'draft', ...header,
        issuedRevision: 0, revision, lineCount: 0, openLineCount: 0, orderedUnits: 0, acceptedUnits: 0, dueUnits: 0, totalCost: 0,
        createdByKey: actor.actorKey, createdByLabel: actor.actorLabel, createdAt: now, updatedAt: now,
      });
    }
    reserveWrites(ctx, args.lines.length + 1);
    const lines: Doc<'purchaseOrderLines'>[] = [];
    for (const [sort, line] of args.lines.entries()) {
      const id = await ctx.db.insert('purchaseOrderLines', {
        orderId, branchId: args.branchId, variantId: line.variantId, item: reads[sort].item, requestLineId: line.requestLineId,
        ordered: line.quantity, cancelled: 0, accepted: 0, corrected: 0, returned: 0, unitCost: line.unitCost,
        ...(line.priceTbc ? { priceTbc: true } : {}), open: false, sort,
      });
      lines.push((await ctx.db.get(id))!);
    }
    const order = (await ctx.db.get(orderId))!;
    const summary = omit(orderSummary(order, lines), ['status', 'phase']);
    // Drafts make no contribution to On order.
    await ctx.db.patch(orderId, { ...summary, openLineCount: 0, dueUnits: 0 });
    await recordEvent(ctx, actor, {
      entity: 'order', entityId: orderId, branchId: args.branchId, action: args.orderId ? 'edited' : 'created', ...(changes?.length ? { changes } : {}),
    });
    return { id: orderId, reference, revision };
  });
}

type OrderAction = { orderId: Id<'purchaseOrders'>; expectedRevision: number; operationKey: string };

async function orderTransition(
  ctx: MutationCtx, staff: StaffActor, args: OrderAction & Record<string, unknown>, action: string,
  apply: (order: Doc<'purchaseOrders'>, actor: Actor, access: StockAccess) => Promise<PurchasingResult>,
  permission: 'buyer' | 'approver' = 'buyer',
) {
  const order = await loadOrder(ctx, args.orderId);
  const access = await purchasingAccess(ctx, staff, order.branchId, permission);
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, order.branchId, `order.${action}`, operationKey, payload, async () => {
    requireLive(order);
    expectRevision(order.revision, args.expectedRevision, 'order');
    return apply(order, actor, access);
  });
}

async function writeRevision(ctx: MutationCtx, order: Doc<'purchaseOrders'>, lines: Doc<'purchaseOrderLines'>[], revision: number, actor: Actor, why?: string) {
  reserveWrites(ctx, 1);
  await ctx.db.insert('purchaseOrderRevisions', {
    orderId: order._id, branchId: order.branchId, revision, reference: order.reference, supplier: order.supplier,
    expectedDate: order.expectedDate, supplierReference: order.supplierReference, note: order.note,
    lines: lines.map(line => ({
      orderLineId: line._id, variantId: line.variantId, item: line.item, ordered: line.ordered, cancelled: line.cancelled, unitCost: line.unitCost,
      ...(line.priceTbc ? { priceTbc: true } : {}),
    })),
    reason: why, ...actor, issuedAt: Date.now(),
  });
}

async function saveSummary(ctx: MutationCtx, order: Doc<'purchaseOrders'>, patch: Partial<Doc<'purchaseOrders'>> = {}) {
  const lines = await readOrderLines(ctx, order._id);
  const summary = orderSummary({ ...order, ...patch }, lines);
  const revision = order.revision + 1;
  reserveWrites(ctx, 1);
  const projection = await projectSupplierOrder(ctx, order, summary.phase);
  await ctx.db.patch(order._id, { ...patch, ...summary, ...projection, revision, updatedAt: Date.now() });
  return { lines, revision, summary };
}

/**
 * The direct (not request-backed) commitment of an order under the branch's direct order limit: accepted value at
 * receipt costs plus what is still due at the current price. A committed direct line without a price (TBC) makes the
 * value unknown, so it can never prove the order is under the limit. Linked replacements for holds or returns are
 * exempt from pricing and carry no unknown value.
 */
export function directCommitment(order: Pick<Doc<'purchaseOrders'>, 'forHoldId' | 'replacesReturnId'>, lines: Doc<'purchaseOrderLines'>[]) {
  let value = 0, unknown = 0, unknownUnits = 0;
  for (const line of lines) {
    if (line.requestLineId) continue;
    const committed = line.ordered - line.cancelled;
    value += lineAcceptedValue(line) + Math.max(0, lineDue(line)) * (line.unitCost ?? 0);
    if (committed > 0 && line.unitCost === undefined && !order.forHoldId && !order.replacesReturnId) {
      unknown++;
      // More units of an unpriced line is more unvalued commitment, even with the same number of unpriced lines.
      unknownUnits += committed;
    }
  }
  return { value, unknown, unknownUnits };
}

/** Whether an amendment grew the direct commitment: more known value, more unpriced lines, or more unpriced units. */
const commitmentGrew = (before: ReturnType<typeof directCommitment>, after: ReturnType<typeof directCommitment>) =>
  after.value > before.value || after.unknown > before.unknown || after.unknownUnits > before.unknownUnits;

const overLimit = (commitment: { value: number; unknown: number }, limit: number | null) =>
  limit !== null && (commitment.value > limit || commitment.unknown > 0);

/**
 * Issue rechecks supplier, items, prices, policy and approvals, then commits demand and On order together. A direct order
 * above the branch's direct order limit is sent to Awaiting approval instead; a different approver issues it.
 */
export function issueOrder(ctx: MutationCtx, staff: StaffActor, args: OrderAction) {
  return orderTransition(ctx, staff, args, 'issue', async (order, actor, access) => {
    if (order.status === 'awaiting_approval') fail('ORDER_STATE', 'This order is waiting for approval.');
    if (order.status !== 'draft') fail('ORDER_STATE', 'This order was already issued.');
    if (!order.requestId) requireDirect(access);
    const limit = access.policy.directOrderLimit;
    if (!order.requestId && limit !== null) {
      const drafted = await readOrderLines(ctx, order._id);
      requirePrices(order, drafted);
      const commitment = directCommitment(order, drafted);
      const value = commitment.value;
      if (overLimit(commitment, limit)) {
        const { revision } = await saveSummary(ctx, order, {
          status: 'awaiting_approval', approvalRequestedByKey: actor.actorKey, approvalRequestedByLabel: actor.actorLabel, approvalRequestedAt: Date.now(),
        });
        await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'approval_requested',
          changes: [
            { field: 'orderValue', before: null, after: value }, { field: 'directOrderLimit', before: null, after: limit },
            ...(commitment.unknown ? [{ field: 'unpricedLines', before: null, after: commitment.unknown }] : []),
          ] });
        return { id: order._id, reference: order.reference, revision, awaitingApproval: true };
      }
    }
    return performIssue(ctx, order, actor);
  });
}

/**
 * A different approver issues a direct order that exceeded the limit. Neither the person who asked for approval nor the
 * draft's creator can approve it.
 */
export function approveOrderIssue(ctx: MutationCtx, staff: StaffActor, args: OrderAction) {
  return orderTransition(ctx, staff, args, 'approve_issue', async (order, actor) => {
    if (order.status !== 'awaiting_approval') fail('ORDER_STATE', 'This order is not waiting for approval.');
    if (actor.actorKey === order.approvalRequestedByKey || actor.actorKey === order.createdByKey) {
      fail('SELF_APPROVAL', 'Ask another approver to approve an order you created or sent for approval.');
    }
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'issue_approved' });
    return performIssue(ctx, order, actor, { approvedByLabel: actor.actorLabel });
  }, 'approver');
}

/** Send an over-limit order back to draft with a reason. */
export function declineOrderIssue(ctx: MutationCtx, staff: StaffActor, args: OrderAction & { reason: string }) {
  return orderTransition(ctx, staff, args, 'decline_issue', async (order, actor) => {
    if (order.status !== 'awaiting_approval') fail('ORDER_STATE', 'This order is not waiting for approval.');
    if (actor.actorKey === order.approvalRequestedByKey) fail('SELF_APPROVAL', 'Ask another approver to decide on an order you sent for approval.');
    const why = reason(args.reason);
    const { revision } = await saveSummary(ctx, order, { status: 'draft' });
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'issue_declined', reason: why });
    return { id: order._id, reference: order.reference, revision };
  }, 'approver');
}

async function performIssue(ctx: MutationCtx, order: Doc<'purchaseOrders'>, actor: Actor, extra: Partial<Doc<'purchaseOrders'>> = {}): Promise<PurchasingResult> {
  {
    const supplier = await requireSupplier(ctx, order.supplierId);
    const drafted = await readOrderLines(ctx, order._id);
    if (!drafted.length) fail('NO_LINES', 'Add at least one line before issuing.');
    requirePrices(order, drafted);
    const reads = await requireActiveItems(ctx, drafted.map(line => line.variantId));
    assertSafeTotals(drafted);
    await validateLink(ctx, order.branchId, order, drafted.map(line => line.variantId), order._id);
    // The supplier copy uses the supplier and item details current at issue, not names captured on the draft.
    const lines = drafted.map((line, i) => ({ ...line, item: reads[i].item }));
    const issued = { ...order, supplier: supplierSnapshot(supplier) };
    if (order.requestId) {
      const request = await ctx.db.get(order.requestId);
      if (!request || request.status !== 'approved') fail('REQUEST_STATE', 'The source request is no longer open for ordering.');
      const shortfalls = [];
      for (const line of lines) {
        const source = line.requestLineId && await ctx.db.get(line.requestLineId);
        const available = source ? availableApproval(source) : 0;
        if (line.ordered > available) shortfalls.push({ orderLineId: line._id, available });
      }
      if (shortfalls.length) fail('ALLOCATION_CHANGED', 'Another order used part of this approval. Review the available quantities.', { lines: shortfalls });
    }
    reserveWrites(ctx, lines.length);
    for (const line of lines) {
      await shiftCommitment(ctx, line.requestLineId, line.ordered);
      await ctx.db.patch(line._id, { open: true, item: line.item });
      await adjustIncoming(ctx, order.branchId, line.variantId, line.ordered);
    }
    await refreshFullyOrdered(ctx, order.requestId);
    const { revision } = await saveSummary(ctx, order, { ...extra, status: 'ordered', issuedRevision: 1, issuedAt: Date.now(), supplier: issued.supplier });
    await writeRevision(ctx, issued, lines, 1, actor);
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'issued',
      changes: [{ field: 'issuedRevision', before: 0, after: 1 }] });
    return { id: order._id, reference: order.reference, revision };
  }
}

export function deleteOrderDraft(ctx: MutationCtx, staff: StaffActor, args: OrderAction) {
  return orderTransition(ctx, staff, args, 'delete', async (order, actor) => {
    if (order.status !== 'draft') fail('ORDER_STATE', 'Only a draft can be deleted.');
    const { revision } = await saveSummary(ctx, order, { status: 'deleted' });
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'deleted' });
    return { id: order._id, reference: order.reference, revision };
  });
}

export type AmendArgs = OrderAction & {
  reason: string; expectedDate?: string; supplierReference?: string;
  lines: { orderLineId: Id<'purchaseOrderLines'>; due?: number; unitCost?: number }[];
  /** New lines the supplier agreed to ship: direct-order policy, or an approved line of the order's source request. */
  addLines?: DraftLine[];
};

/**
 * Amend an open order: expected date, supplier reference, future unit cost and outstanding quantity of existing lines,
 * plus new lines. A reduction cancels at most what is due. An increase or new line needs approval on the same request
 * line or the direct-order policy. An amendment that changes nothing is rejected (NO_CHANGES) and issues no revision.
 */
export function amendOrder(ctx: MutationCtx, staff: StaffActor, args: AmendArgs) {
  return orderTransition(ctx, staff, args, 'amend', async (order, actor, access) => {
    if (!ISSUED_OPEN.includes(order.status)) fail('ORDER_STATE', 'Only an open issued order can be amended.');
    const why = reason(args.reason);
    const added = args.addLines ?? [];
    if (args.lines.length > 50) fail('TOO_MANY_LINES', 'An order can hold at most 50 lines.');
    uniqueBy(args.lines, line => line.orderLineId, 'Each line can be amended once.');
    let current = await readOrderLines(ctx, order._id);
    if (access.policy.directOrderLimit !== null && current.some(line => !line.requestLineId && isLegacyLine(line))) {
      // The cap compares exact values on both sides: value pre-feature direct lines from their receipt evidence first
      // (exact values are persisted; a long history fails with the retryable VALUATION_PENDING).
      current = await Promise.all(current.map(async line => {
        if (line.requestLineId || !isLegacyLine(line)) return line;
        const seeded = await seedLegacyLine(ctx, line);
        reserveWrites(ctx, 1);
        await ctx.db.patch(line._id, { acceptedValue: seeded.acceptedValue, rejected: seeded.rejected });
        return seeded;
      }));
    }
    const lines = new Map(current.map(line => [line._id, line]));
    if (lines.size + added.length > 50) fail('TOO_MANY_LINES', 'An order can hold at most 50 lines.');
    uniqueBy([...lines.values(), ...added], line => line.variantId, 'Each item can appear once per order. Amend the existing line instead.');
    const expectedDate = args.expectedDate === undefined ? order.expectedDate : futureIsoDate(args.expectedDate, 'Expected date', order.expectedDate);
    const supplierReference = args.supplierReference === undefined ? order.supplierReference : text(args.supplierReference, 'Supplier reference', 'reference');
    let futureDue = [...lines.values()].reduce((sum, line) => sum + lineDue(line), 0);
    let increases = false;
    let changed = added.length > 0 || expectedDate !== order.expectedDate || supplierReference !== order.supplierReference;
    for (const change of args.lines) {
      const line = lines.get(change.orderLineId);
      if (!line) fail('ORDER_LINE_NOT_FOUND', 'A line is not on this order.');
      unitCost(change.unitCost);
      if (change.unitCost !== undefined && change.unitCost !== line.unitCost) changed = true;
      if (change.due !== undefined) {
        quantity(change.due, 'Still due', 0);
        futureDue += change.due - lineDue(line);
        if (change.due !== lineDue(line)) changed = true;
        if (change.due > lineDue(line)) increases = true;
      }
    }
    if (!changed) fail('NO_CHANGES', 'Nothing changed. Edit a quantity, cost, date or reference, or add a line, before issuing an amendment.');
    const reads = await Promise.all(added.map(line => {
      quantity(line.quantity, 'Order quantity'); unitCost(line.unitCost);
      return readItem(ctx, line.variantId);
    }));
    futureDue += added.reduce((sum, line) => sum + line.quantity, 0);
    if (futureDue === 0) fail('USE_CLOSE_REMAINDER', 'Use Close remainder to cancel every outstanding unit.');
    if (increases || added.length) {
      await requireSupplier(ctx, order.supplierId);
      await requireActiveItems(ctx, [
        ...args.lines.filter(c => c.due !== undefined && c.due > lineDue(lines.get(c.orderLineId)!)).map(c => lines.get(c.orderLineId)!.variantId),
        ...added.map(line => line.variantId),
      ]);
    }
    requirePrices(order, added.map((line, i) => ({ _id: `new:${i}` as Id<'purchaseOrderLines'>, unitCost: line.unitCost, priceTbc: line.priceTbc })));
    if (order.replacesReturnId && (increases || added.length)) {
      // Receiving worker (P32): a replacement may not grow past the return's unreversed, uncovered units.
      await assertReplacementLines(ctx, order.replacesReturnId, [...[...lines.values()].map(line => {
        const change = args.lines.find(c => c.orderLineId === line._id);
        return { variantId: line.variantId, quantity: line.ordered - line.cancelled + (change?.due === undefined ? 0 : change.due - lineDue(line)) };
      }), ...added], order._id);
    }
    // New lines follow the issue rule: request-backed lines must match an approved line of the order's own request.
    for (const line of added) {
      if (line.requestLineId) {
        const source = await ctx.db.get(line.requestLineId);
        if (!order.requestId || !source || source.requestId !== order.requestId || source.variantId !== line.variantId) {
          fail('REQUEST_LINE_MISMATCH', 'A new line must match an approved line on this order\'s request.');
        }
      } else {
        requireDirect(access);
      }
    }
    assertSafeTotals([...[...lines.values()].map(line => {
      const change = args.lines.find(c => c.orderLineId === line._id);
      const delta = change?.due === undefined ? 0 : change.due - lineDue(line);
      return {
        ordered: line.ordered + Math.max(0, delta), cancelled: line.cancelled - Math.min(0, delta),
        unitCost: change?.unitCost ?? line.unitCost,
      };
    }), ...added.map(line => ({ ordered: line.quantity, cancelled: 0, unitCost: line.unitCost }))]);
    reserveWrites(ctx, args.lines.length + added.length);
    const diff: { field: string; before: string | number | null; after: string | number | null }[] = [];
    for (const change of args.lines) {
      const line = lines.get(change.orderLineId)!;
      const patch: Partial<Doc<'purchaseOrderLines'>> = {};
      if (change.unitCost !== undefined && change.unitCost !== line.unitCost) {
        // Repricing changes only the open commitment: fix the accepted value from receipt evidence first.
        const seeded = await seedLegacyLine(ctx, line);
        if (line.acceptedValue === undefined) patch.acceptedValue = seeded.acceptedValue;
        if (line.rejected === undefined) patch.rejected = seeded.rejected;
        patch.unitCost = change.unitCost;
        if (line.priceTbc) patch.priceTbc = undefined;
        diff.push({ field: `lines[${itemLabel(line.item)}].unitCost`, before: line.unitCost ?? null, after: change.unitCost });
      }
      if (change.due !== undefined && change.due !== lineDue(line)) {
        const delta = change.due - lineDue(line);
        if (delta > 0) {
          if (line.requestLineId) await shiftCommitment(ctx, line.requestLineId, delta);
          else requireDirect(access);
          patch.ordered = line.ordered + delta;
        } else {
          await shiftCommitment(ctx, line.requestLineId, delta);
          patch.cancelled = line.cancelled - delta;
        }
        patch.open = change.due > 0;
        await adjustIncoming(ctx, order.branchId, line.variantId, delta);
        diff.push({ field: `lines[${itemLabel(line.item)}].due`, before: lineDue(line), after: change.due });
      }
      if (Object.keys(patch).length) await ctx.db.patch(line._id, patch);
    }
    let sort = Math.max(-1, ...[...lines.values()].map(line => line.sort)) + 1;
    for (const [i, line] of added.entries()) {
      await shiftCommitment(ctx, line.requestLineId, line.quantity);
      await ctx.db.insert('purchaseOrderLines', {
        orderId: order._id, branchId: order.branchId, variantId: line.variantId, item: reads[i].item, requestLineId: line.requestLineId,
        ordered: line.quantity, cancelled: 0, accepted: 0, corrected: 0, returned: 0, unitCost: line.unitCost,
        ...(line.priceTbc ? { priceTbc: true } : {}), open: true, sort: sort++,
      });
      await adjustIncoming(ctx, order.branchId, line.variantId, line.quantity);
      diff.push({ field: `lines[${itemLabel(reads[i].item)}]`, before: null, after: line.quantity });
    }
    await refreshFullyOrdered(ctx, order.requestId);
    const issuedRevision = order.issuedRevision + 1;
    const header = { issuedRevision, expectedDate, supplierReference };
    if (expectedDate !== order.expectedDate) diff.push({ field: 'expectedDate', before: order.expectedDate ?? null, after: expectedDate ?? null });
    if (supplierReference !== order.supplierReference) diff.push({ field: 'supplierReference', before: order.supplierReference ?? null, after: supplierReference ?? null });
    const { lines: updated, revision } = await saveSummary(ctx, order, header);
    // The direct order limit holds at every commitment: an amendment that takes the direct commitment above the limit
    // (or adds an unpriced direct line under one) needs an approver who neither created nor sent the order for approval.
    const limit = access.policy.directOrderLimit;
    const before = directCommitment(order, [...lines.values()]);
    const after = directCommitment(order, updated);
    if (overLimit(after, limit) && commitmentGrew(before, after)) {
      const fourEyes = access.approver && actor.actorKey !== order.createdByKey && actor.actorKey !== order.approvalRequestedByKey;
      if (!fourEyes) {
        fail('DIRECT_ORDER_LIMIT', 'This amendment takes the order above the direct order limit. Ask a different approver to amend it.', {
          value: after.value, limit, unpriced: after.unknown,
        });
      }
      diff.push({ field: 'directOrderLimit', before: null, after: limit });
    }
    await writeRevision(ctx, { ...order, ...header }, updated, issuedRevision, actor, why);
    const kept = diff.length > 19 ? diff.slice(0, 19) : diff;
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'amended', reason: why,
      changes: [
        { field: 'issuedRevision', before: order.issuedRevision, after: issuedRevision }, ...kept,
        ...(kept.length < diff.length ? [{ field: 'changes.omitted', before: null, after: diff.length - kept.length }] : []),
      ] });
    return { id: order._id, reference: order.reference, revision };
  });
}

/**
 * Cancel everything still due. Holds stay in their queue. Released approval makes the source request orderable again,
 * unless a stock lead also closes the request's remaining demand (`closeRequestDemand`).
 */
export function closeOrderRemainder(ctx: MutationCtx, staff: StaffActor, args: OrderAction & { reason: string; closeRequestDemand?: boolean }) {
  return orderTransition(ctx, staff, args, 'close', async (order, actor, access) => {
    if (!ISSUED_OPEN.includes(order.status)) fail('ORDER_STATE', 'Only an open issued order can be closed.');
    const why = reason(args.reason);
    if (args.closeRequestDemand && !access.lead) fail('STOCK_FORBIDDEN', 'Only a stock lead can close the request\'s remaining demand.');
    const request = args.closeRequestDemand && order.requestId ? await ctx.db.get(order.requestId) : null;
    if (args.closeRequestDemand && request?.status !== 'approved') fail('REQUEST_STATE', 'The source request is no longer open.');
    const lines = await readOrderLines(ctx, order._id);
    reserveWrites(ctx, lines.length);
    for (const line of lines) {
      const due = lineDue(line);
      if (due <= 0) continue;
      await shiftCommitment(ctx, line.requestLineId, -due);
      await adjustIncoming(ctx, order.branchId, line.variantId, -due);
      await ctx.db.patch(line._id, { cancelled: line.cancelled + due, open: false });
    }
    if (request) {
      const requestLines = await readRequestLines(ctx, request._id);
      reserveWrites(ctx, requestLines.length + 1);
      for (const line of requestLines) await ctx.db.patch(line._id, { requestStatus: 'closed' });
      await ctx.db.patch(request._id, { status: 'closed', fullyOrdered: undefined, lastReason: why, revision: request.revision + 1, updatedAt: Date.now() });
      await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action: 'closed', reason: why, relatedId: order._id });
    } else {
      await refreshFullyOrdered(ctx, order.requestId);
    }
    const { revision, summary } = await saveSummary(ctx, order, { status: 'closed_short', closedReason: why });
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'closed', reason: why,
      changes: [{ field: 'status', before: order.status, after: summary.status }] });
    return { id: order._id, reference: order.reference, revision };
  });
}

/** Rows processed per backfill call. Order lines read ≤ 101 receipt lines each; order headers read ≤ 50 lines. */
const BACKFILL_PAGE = { purchaseRequests: 50, purchaseOrders: 10, supplierReceipts: 50, purchaseOrderLines: 20 } as const;
/** Receipt lines per chunk of the exact rebuild of one long-history order line. */
const REBUILD_CHUNK = 200;

/**
 * One page of the purchasing legacy backfill (idempotent; rows that already carry the fields are left unchanged).
 * - purchaseOrderLines: exact accepted value and rejections from receipt evidence; a line with more than
 *   LEGACY_RECEIPT_SCAN receipts is listed in `pending` for `rebuildLineValuationChunk` instead (never estimated).
 * - purchaseOrders: the 5-character reference code, and the value summary once every line is valued.
 * - purchaseRequests: the reference code. supplierReceipts: the exceptions flag.
 * Run lines first, rebuild every pending line, then orders, requests and receipts.
 */
export async function backfillLegacyPage(ctx: MutationCtx, table: keyof typeof BACKFILL_PAGE, cursor: string | null) {
  const result = await ctx.db.query(table).paginate({ numItems: BACKFILL_PAGE[table], cursor });
  let updated = 0;
  const pending: Id<'purchaseOrderLines'>[] = [];
  for (const row of result.page) {
    if (table === 'purchaseOrderLines') {
      const line = row as Doc<'purchaseOrderLines'>;
      if (!isLegacyLine(line)) continue;
      const receipts = await ctx.db.query('supplierReceiptLines').withIndex('by_orderLineId', q => q.eq('orderLineId', line._id))
        .take(LEGACY_RECEIPT_SCAN + 1);
      if (receipts.length > LEGACY_RECEIPT_SCAN) { pending.push(line._id); continue; }
      const exact = receiptValuation(receipts);
      await ctx.db.patch(line._id, { acceptedValue: line.acceptedValue ?? exact.acceptedValue, rejected: line.rejected ?? exact.rejected });
      updated++;
    } else if (table === 'supplierReceipts') {
      const receipt = row as Doc<'supplierReceipts'>;
      if (receipt.hasExceptions !== undefined) continue;
      await ctx.db.patch(receipt._id, { hasExceptions: receipt.rejectedUnits > 0 || receipt.heldUnits > 0 });
      updated++;
    } else if (table === 'purchaseOrders') {
      const order = row as Doc<'purchaseOrders'>;
      const lines = await readOrderLines(ctx, order._id);
      const patch: Partial<Doc<'purchaseOrders'>> = order.referenceCode === undefined ? { referenceCode: referenceCode(order.reference) } : {};
      if (!lines.some(isLegacyLine)) {
        const { receivedValue, outstandingValue, unpricedLines, rejectedUnits, totalCost } = orderSummary(order, lines);
        const values = { receivedValue, outstandingValue, unpricedLines, rejectedUnits, totalCost };
        const stale = (Object.keys(values) as (keyof typeof values)[]).some(field => order[field] !== values[field]);
        if (stale) Object.assign(patch, values);
      }
      if (Object.keys(patch).length) { await ctx.db.patch(order._id, patch); updated++; }
    } else {
      const request = row as Doc<'purchaseRequests'>;
      if (request.referenceCode !== undefined) continue;
      await ctx.db.patch(request._id, { referenceCode: referenceCode(request.reference) });
      updated++;
    }
  }
  return { updated, pending, isDone: result.isDone, continueCursor: result.continueCursor };
}

/**
 * Exact, resumable valuation of one pre-feature order line with a long receipt history: sums REBUILD_CHUNK receipt
 * lines per call and returns the running totals with the next cursor; pass them back until `isDone`, which writes the
 * line. Costing writes on the line fail with VALUATION_PENDING until then, so its receipt lines cannot change mid-rebuild.
 */
export async function rebuildLineValuationChunk(ctx: MutationCtx, args: {
  orderLineId: Id<'purchaseOrderLines'>; cursor: string | null; acceptedValue: number; rejected: number;
}) {
  const line = await ctx.db.get(args.orderLineId);
  if (!line) fail('ORDER_LINE_NOT_FOUND', 'This order line no longer exists.');
  if (!isLegacyLine(line)) return { isDone: true, continueCursor: '', acceptedValue: line.acceptedValue!, rejected: line.rejected! };
  const page = await ctx.db.query('supplierReceiptLines').withIndex('by_orderLineId', q => q.eq('orderLineId', line._id))
    .paginate({ numItems: REBUILD_CHUNK, cursor: args.cursor });
  const chunk = receiptValuation(page.page);
  const acceptedValue = args.acceptedValue + chunk.acceptedValue;
  const rejected = args.rejected + chunk.rejected;
  if (page.isDone) {
    await ctx.db.patch(line._id, { acceptedValue: line.acceptedValue ?? acceptedValue, rejected: line.rejected ?? rejected });
  }
  return { isDone: page.isDone, continueCursor: page.continueCursor, acceptedValue, rejected };
}
