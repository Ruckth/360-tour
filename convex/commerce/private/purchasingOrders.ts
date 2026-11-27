/** Purchase orders: Draft → Ordered → Partially received → Received; Close remainder → Closed short | Cancelled. */
import { omit } from 'convex-helpers';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import type { PurchasingResult } from '../purchasingTables';
import {
  actorOf, adjustIncoming, assertSafeTotals, availableApproval, draftChanges, expectRevision, fail, ISSUED_OPEN, isoDate, lineCount, lineDue,
  newReference, orderSummary, otherHoldReplacement, purchasingAccess, quantity, readItem, readOrderLines, readRequestLines, reason,
  recordEvent, requireActiveItems, requireSupplier, runOnce, shiftCommitment, supplierSnapshot, text, uniqueBy, unitCost,
  type Actor, type StockAccess,
} from './purchasingCore';

type DraftLine = {
  variantId: Id<'productVariants'>; quantity: number; unitCost?: number; requestLineId?: Id<'purchaseRequestLines'>;
};

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
    for (const line of args.lines) { quantity(line.quantity, 'Order quantity'); unitCost(line.unitCost); }
    assertSafeTotals(args.lines.map(line => ({ ordered: line.quantity, cancelled: 0, unitCost: line.unitCost })));
    await validateSource(ctx, args.branchId, args.requestId, args.lines);
    await validateLink(ctx, args.branchId, args, args.lines.map(line => line.variantId), args.orderId);
    const supplier = await requireSupplier(ctx, args.supplierId);
    const reads = await Promise.all(args.lines.map(line => readItem(ctx, line.variantId)));
    const header = {
      supplierId: supplier._id, supplier: supplierSnapshot(supplier), requestId: args.requestId,
      expectedDate: isoDate(args.expectedDate, 'Expected date'),
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
        branchId: args.branchId, reference, status: 'draft', phase: 'draft', ...header,
        issuedRevision: 0, revision, lineCount: 0, openLineCount: 0, orderedUnits: 0, acceptedUnits: 0, dueUnits: 0, totalCost: 0,
        createdByKey: actor.actorKey, createdByLabel: actor.actorLabel, createdAt: now, updatedAt: now,
      });
    }
    reserveWrites(ctx, args.lines.length + 1);
    const lines: Doc<'purchaseOrderLines'>[] = [];
    for (const [sort, line] of args.lines.entries()) {
      const id = await ctx.db.insert('purchaseOrderLines', {
        orderId, branchId: args.branchId, variantId: line.variantId, item: reads[sort].item, requestLineId: line.requestLineId,
        ordered: line.quantity, cancelled: 0, accepted: 0, corrected: 0, returned: 0, unitCost: line.unitCost, open: false, sort,
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
) {
  const order = await loadOrder(ctx, args.orderId);
  const access = await purchasingAccess(ctx, staff, order.branchId, 'buyer');
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
    })),
    reason: why, ...actor, issuedAt: Date.now(),
  });
}

async function saveSummary(ctx: MutationCtx, order: Doc<'purchaseOrders'>, patch: Partial<Doc<'purchaseOrders'>> = {}) {
  const lines = await readOrderLines(ctx, order._id);
  const summary = orderSummary({ ...order, ...patch }, lines);
  const revision = order.revision + 1;
  reserveWrites(ctx, 1);
  await ctx.db.patch(order._id, { ...patch, ...summary, revision, updatedAt: Date.now() });
  return { lines, revision, summary };
}

/** Issue rechecks supplier, items, policy and approvals, then commits demand and On order together. */
export function issueOrder(ctx: MutationCtx, staff: StaffActor, args: OrderAction) {
  return orderTransition(ctx, staff, args, 'issue', async (order, actor, access) => {
    if (order.status !== 'draft') fail('ORDER_STATE', 'This order was already issued.');
    if (!order.requestId) requireDirect(access);
    const supplier = await requireSupplier(ctx, order.supplierId);
    const drafted = await readOrderLines(ctx, order._id);
    if (!drafted.length) fail('NO_LINES', 'Add at least one line before issuing.');
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
    const { revision } = await saveSummary(ctx, order, { status: 'ordered', issuedRevision: 1, issuedAt: Date.now(), supplier: issued.supplier });
    await writeRevision(ctx, issued, lines, 1, actor);
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'issued' });
    return { id: order._id, reference: order.reference, revision };
  });
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
};

/**
 * Amend an open order's existing lines: expected date, future unit cost and outstanding quantity.
 * A reduction cancels at most what is due. An increase needs approval on the same request line or the direct-order policy.
 */
export function amendOrder(ctx: MutationCtx, staff: StaffActor, args: AmendArgs) {
  return orderTransition(ctx, staff, args, 'amend', async (order, actor, access) => {
    if (!ISSUED_OPEN.includes(order.status)) fail('ORDER_STATE', 'Only an open issued order can be amended.');
    const why = reason(args.reason);
    if (args.lines.length > 50) fail('TOO_MANY_LINES', 'An order can hold at most 50 lines.');
    uniqueBy(args.lines, line => line.orderLineId, 'Each line can be amended once.');
    const lines = new Map((await readOrderLines(ctx, order._id)).map(line => [line._id, line]));
    let futureDue = [...lines.values()].reduce((sum, line) => sum + lineDue(line), 0);
    let increases = false;
    for (const change of args.lines) {
      const line = lines.get(change.orderLineId);
      if (!line) fail('ORDER_LINE_NOT_FOUND', 'A line is not on this order.');
      unitCost(change.unitCost);
      if (change.due !== undefined) {
        quantity(change.due, 'Still due', 0);
        futureDue += change.due - lineDue(line);
        if (change.due > lineDue(line)) increases = true;
      }
    }
    if (futureDue === 0) fail('USE_CLOSE_REMAINDER', 'Use Close remainder to cancel every outstanding unit.');
    if (increases) {
      await requireSupplier(ctx, order.supplierId);
      await requireActiveItems(ctx, args.lines.filter(c => c.due !== undefined && c.due > lineDue(lines.get(c.orderLineId)!))
        .map(c => lines.get(c.orderLineId)!.variantId));
    }
    assertSafeTotals([...lines.values()].map(line => {
      const change = args.lines.find(c => c.orderLineId === line._id);
      const delta = change?.due === undefined ? 0 : change.due - lineDue(line);
      return {
        ordered: line.ordered + Math.max(0, delta), cancelled: line.cancelled - Math.min(0, delta),
        unitCost: change?.unitCost ?? line.unitCost,
      };
    }));
    reserveWrites(ctx, args.lines.length);
    for (const change of args.lines) {
      const line = lines.get(change.orderLineId)!;
      const patch: Partial<Doc<'purchaseOrderLines'>> = {};
      if (change.unitCost !== undefined) patch.unitCost = change.unitCost;
      if (change.due !== undefined) {
        const delta = change.due - lineDue(line);
        if (delta > 0) {
          if (line.requestLineId) await shiftCommitment(ctx, line.requestLineId, delta);
          else requireDirect(access);
          patch.ordered = line.ordered + delta;
        } else if (delta < 0) {
          await shiftCommitment(ctx, line.requestLineId, delta);
          patch.cancelled = line.cancelled - delta;
        }
        patch.open = change.due > 0;
        await adjustIncoming(ctx, order.branchId, line.variantId, delta);
      }
      await ctx.db.patch(line._id, patch);
    }
    const issuedRevision = order.issuedRevision + 1;
    const header = {
      issuedRevision,
      expectedDate: args.expectedDate === undefined ? order.expectedDate : isoDate(args.expectedDate, 'Expected date'),
      supplierReference: args.supplierReference === undefined ? order.supplierReference : text(args.supplierReference, 'Supplier reference', 'reference'),
    };
    const { lines: updated, revision } = await saveSummary(ctx, order, header);
    await writeRevision(ctx, { ...order, ...header }, updated, issuedRevision, actor, why);
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'amended', reason: why,
      changes: [{ field: 'issuedRevision', before: order.issuedRevision, after: issuedRevision }] });
    return { id: order._id, reference: order.reference, revision };
  });
}

/** Cancel everything still due. Holds stay in their queue. */
export function closeOrderRemainder(ctx: MutationCtx, staff: StaffActor, args: OrderAction & { reason: string }) {
  return orderTransition(ctx, staff, args, 'close', async (order, actor) => {
    if (!ISSUED_OPEN.includes(order.status)) fail('ORDER_STATE', 'Only an open issued order can be closed.');
    const why = reason(args.reason);
    const lines = await readOrderLines(ctx, order._id);
    reserveWrites(ctx, lines.length);
    for (const line of lines) {
      const due = lineDue(line);
      if (due <= 0) continue;
      await shiftCommitment(ctx, line.requestLineId, -due);
      await adjustIncoming(ctx, order.branchId, line.variantId, -due);
      await ctx.db.patch(line._id, { cancelled: line.cancelled + due, open: false });
    }
    const { revision, summary } = await saveSummary(ctx, order, { status: 'closed_short', closedReason: why });
    await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'closed', reason: why,
      changes: [{ field: 'status', before: order.status, after: summary.status }] });
    return { id: order._id, reference: order.reference, revision };
  });
}
