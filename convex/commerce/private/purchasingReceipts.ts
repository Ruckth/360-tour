/**
 * Supplier receipts post accepted units only. Rejections stay due; excess or substitute goods are held outside On hand.
 * Corrections and supplier returns are linked records; together they never exceed a line's accepted quantity.
 */
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import {
  PURCHASING_MAX_LINES, PURCHASING_MOVEMENT_KINDS, type CorrectionBlock, type CorrectionResult, type FollowUpLink, type PurchasingResult, type ReceiptLotEvidence,
  type UndercountLink,
} from '../purchasingTables';
import {
  actorOf, adjustIncoming, correctionClosesRemainder, deliveryKey, expectRevision, fail, ISSUED_OPEN, lineDue, lotEvidence, newReference,
  orderSummary, purchasingAccess, quantity, readItem, readOrderLines, reason, receiptEntryCount, receiptLotCount, recordEvent, requireActiveItems,
  requireSupplier, runOnce, shiftCommitment, supplierSnapshot, text, uniqueBy, unitCost, type Actor,
} from './purchasingCore';
import { readStockAccess } from './stockAccess';
import { allocationCounts, stockAvailability, type Allocation } from './stockAvailability';
import { readLotMovement } from './stockExpansionLedger';
import { readStockLevel, stockRead, writeNewReceiptMovement, writeStockMovement } from './stockLedger';

type HeldInput = { variantId: Id<'productVariants'>; quantity: number; reason: string };
type DuplicateConfirmation = { receiptId: Id<'supplierReceipts'>; reason: string };

type ReceiptCommon = {
  deliveryReference?: string; note?: string; confirmDuplicate?: DuplicateConfirmation;
  followUp?: FollowUpLink; undercount?: UndercountLink; held?: HeldInput[]; operationKey: string;
};

export type ReceiveOrderArgs = ReceiptCommon & {
  orderId: Id<'purchaseOrders'>;
  /** Issued revision the receiver reviewed; an amendment since then is a stale-data response. */
  expectedIssuedRevision: number;
  reason?: string;
  lines: ({
    orderLineId: Id<'purchaseOrderLines'>; accepted: number; rejected?: number; rejectReason?: string; holdId?: Id<'purchaseHolds'>;
  } & ReceiptLotEvidence)[];
};

export type ReceiveDirectArgs = ReceiptCommon & {
  branchId: Id<'branches'>; supplierId?: Id<'suppliers'>; reason: string;
  /** Required to bypass open orders for the same items. */
  bypassOpenOrders?: boolean;
  lines: ({ variantId: Id<'productVariants'>; accepted: number; unitCost?: number } & ReceiptLotEvidence)[];
};

type Duplicate = { duplicateOfReceiptId: Id<'supplierReceipts'>; duplicateOfReference: string; duplicateReason: string };

/**
 * A normalized delivery reference already used by this branch and supplier needs explicit confirmation, which is kept
 * on the receipt (original id, reference and reason). An undercount supplement of a receipt with the same reference is
 * the same delivery, not a duplicate.
 */
async function checkDuplicate(
  ctx: MutationCtx, branchId: Id<'branches'>, supplierId: Id<'suppliers'> | undefined, key: string | undefined,
  confirm: DuplicateConfirmation | undefined, sameDelivery?: Doc<'supplierReceipts'> | null,
): Promise<Duplicate | undefined> {
  if (!key || sameDelivery?.deliveryKey === key) return undefined;
  const prior = await ctx.db.query('supplierReceipts').withIndex('by_branchId_and_supplierId_and_deliveryKey', q =>
    q.eq('branchId', branchId).eq('supplierId', supplierId).eq('deliveryKey', key)).first();
  if (!prior) return undefined;
  if (confirm?.receiptId !== prior._id) {
    fail('DUPLICATE_DELIVERY', 'This delivery reference was already recorded. Review the prior receipt.', { receiptId: prior._id, reference: prior.reference });
  }
  return { duplicateOfReceiptId: prior._id, duplicateOfReference: prior.reference, duplicateReason: reason(confirm.reason, 'Duplicate delivery reason') };
}

type UndercountSource = {
  orderId?: Id<'purchaseOrders'>; supplierId?: Id<'suppliers'>; lines: { variantId: Id<'productVariants'>; accepted: number }[];
};

/**
 * Receive remaining units an earlier receipt undercounted. The original must be at this branch (the receiver permission
 * checked by the caller covers it) and be the same delivery: on this order, or for a receipt without an order a direct
 * receipt from the same supplier (both without a supplier counts as the same). Every accepted item must be on the
 * original. Distinct from `followUp`, which posts goods a correction removed (wrong item or wrong branch).
 */
async function checkUndercount(ctx: MutationCtx, branchId: Id<'branches'>, link: UndercountLink | undefined, source: UndercountSource, followUp: unknown) {
  if (!link) return undefined;
  if (followUp) fail('LINK_CONFLICT', 'Link a receipt either to a correction follow-up or to an undercount, not both.');
  const original = await stockRead(ctx, () => ctx.db.get(link.receiptId));
  if (!original || original.branchId !== branchId) fail('LINK_NOT_FOUND', 'That receipt is not available at this branch.');
  const sameDelivery = source.orderId
    ? original.orderId === source.orderId
    : original.kind === 'direct' && original.supplierId === source.supplierId;
  if (!sameDelivery) fail('LINK_MISMATCH', 'Missing units must be received on the same order, or from the same supplier for a receipt without an order.');
  const accepted = source.lines.filter(line => line.accepted > 0);
  if (!accepted.length) fail('UNDERCOUNT_EMPTY', 'Accept the missing units to link them to the earlier receipt.');
  const items = new Set((await stockRead(ctx, () => ctx.db.query('supplierReceiptLines').withIndex('by_receiptId', q => q.eq('receiptId', original._id))
    .take(PURCHASING_MAX_LINES))).map(line => line.variantId));
  const others = accepted.filter(line => !items.has(line.variantId)).map(line => line.variantId);
  if (others.length) fail('UNDERCOUNT_ITEM', 'Only items on the earlier receipt can be received as missing units.', { variantIds: others });
  return original;
}

type FollowUpSource = {
  supplierId?: Id<'suppliers'>; orderId?: Id<'purchaseOrders'>; lines: { variantId: Id<'productVariants'>; accepted: number }[];
};
type FollowUp = { adjustment: Doc<'supplierReceiptAdjustments'>; link: FollowUpLink };

/**
 * A follow-up receipt posts, where they actually are, the goods a correction removed. The receiver explicitly names the
 * received item (`variantId`, which may differ from the corrected item) and exactly the corrected quantity, and must
 * accept at least that many units of it. The delivery must come from the corrected order or the corrected receipt's
 * supplier. The receipt's branch is the destination (receiver permission, checked by the caller). A correction at
 * another branch also needs the stock lead grant there now; without it the link reads as missing, so nothing about the
 * source branch leaks. A correction closes once; reject-only, unrelated or short receipts cannot close it.
 */
async function authorizeFollowUp(
  ctx: MutationCtx, staff: StaffActor, branchId: Id<'branches'>, link: FollowUpLink | undefined,
) {
  if (!link) return undefined;
  const missing = () => fail('LINK_NOT_FOUND', 'That correction is not waiting for a follow-up receipt.');
  const adjustment = await stockRead(ctx, () => ctx.db.get(link.adjustmentId));
  if (!adjustment || adjustment.kind !== 'correction') return missing();
  if (adjustment.branchId !== branchId) {
    const access = await readStockAccess(ctx, staff, adjustment.branchId).catch(() => null);
    if (!access?.lead) return missing();
  }
  return adjustment;
}

async function checkFollowUp(
  ctx: MutationCtx, branchId: Id<'branches'>, link: FollowUpLink | undefined,
  adjustment: Doc<'supplierReceiptAdjustments'> | undefined, source: FollowUpSource,
): Promise<FollowUp | undefined> {
  if (!link || !adjustment) return undefined;
  if (adjustment.followUpReceiptId) fail('FOLLOW_UP_CLOSED', 'This correction already has a follow-up receipt.');
  quantity(link.quantity, 'Follow-up quantity');
  if (link.quantity !== adjustment.quantity) {
    fail('FOLLOW_UP_QUANTITY', 'A follow-up receives exactly the corrected units.', { quantity: adjustment.quantity });
  }
  const line = source.lines.find(row => row.variantId === link.variantId);
  if (!line || line.accepted < link.quantity) fail('FOLLOW_UP_EMPTY', 'Accept the corrected units on the chosen item to link this follow-up.');
  const corrected = await stockRead(ctx, () => ctx.db.get(adjustment.receiptId));
  const sameOrder = adjustment.orderId !== undefined && adjustment.orderId === source.orderId;
  const sameSupplier = corrected?.supplierId !== undefined && corrected.supplierId === source.supplierId;
  const sameSupplierlessSource = corrected && !corrected.supplierId && !source.supplierId && !corrected.orderId &&
    !source.orderId && branchId === adjustment.branchId;
  if (!sameOrder && !sameSupplier && !sameSupplierlessSource) {
    fail('LINK_MISMATCH', 'The follow-up must belong to the corrected order or come from the corrected supplier.');
  }
  return { adjustment, link: { adjustmentId: adjustment._id, variantId: link.variantId, quantity: link.quantity } };
}

type HeldPlan = HeldInput & { item: Doc<'purchaseHolds'>['item']; reason: string };

async function planHeld(ctx: MutationCtx, held: HeldInput[] | undefined): Promise<HeldPlan[]> {
  if (!held?.length) return [];
  if (held.length > PURCHASING_MAX_LINES) fail('TOO_MANY_LINES', 'A receipt can hold at most 50 held lines.');
  uniqueBy(held, line => line.variantId, 'Each held item can appear once per receipt.');
  return Promise.all(held.map(async line => ({
    ...line, quantity: quantity(line.quantity, 'Held quantity'), reason: reason(line.reason, 'Held goods reason'),
    item: (await readItem(ctx, line.variantId)).item,
  })));
}

type ReceiptHeader = Omit<Doc<'supplierReceipts'>, '_id' | '_creationTime' | 'reference' | 'lineCount' | 'acceptedUnits' | 'rejectedUnits' | 'heldUnits' | 'actorKey' | 'actorLabel' | 'createdAt' | 'revision'>;
type ReceiptLinePlan = Omit<Doc<'supplierReceiptLines'>, '_id' | '_creationTime' | 'receiptId' | 'movementId' | 'corrected' | 'returned'> & {
  lot: ReceiptLotEvidence;
};

/** One write path for every receipt: header, lines, movements, holds, follow-up link and history. */
async function postReceipt(
  ctx: MutationCtx, actor: Actor, header: ReceiptHeader, lines: ReceiptLinePlan[], held: HeldPlan[],
  followUp: FollowUp | undefined, movementKind: 'purchase_receipt' | 'direct_receipt', undercount?: Doc<'supplierReceipts'>,
) {
  const now = Date.now();
  const reference = await newReference(ctx, 'supplierReceipts', 'GR', now);
  const acceptedUnits = lines.reduce((sum, line) => sum + line.accepted, 0);
  const rejectedUnits = lines.reduce((sum, line) => sum + line.rejected, 0);
  const heldUnits = held.reduce((sum, line) => sum + line.quantity, 0);
  if (acceptedUnits + rejectedUnits + heldUnits === 0) fail('EMPTY_RECEIPT', 'Enter accepted, rejected or held units.');
  const kind = header.kind === 'order' && acceptedUnits === 0 && heldUnits === 0 ? 'rejected' : header.kind;
  if (kind === 'rejected' && !header.reason && !lines.some(line => line.rejectReason)) fail('REASON_REQUIRED', 'Enter why the delivery was rejected.');
  reserveWrites(ctx, 2 + lines.length * 2 + held.length);
  const receiptId = await ctx.db.insert('supplierReceipts', {
    ...header, kind, reference, lineCount: lines.length, acceptedUnits, rejectedUnits, heldUnits,
    followUp: followUp?.link, ...(undercount ? { undercountOf: undercount._id, undercountOfReference: undercount.reference } : {}),
    ...actor, createdAt: now, revision: 1,
  });
  // Each line is a distinct item with a fresh source key (the new line id; retries replay through runOnce), so line
  // inserts, their movements and per-item balances run concurrently; holds too. Promise.all keeps line order.
  const posted = await Promise.all(lines.map(async ({ lot, ...line }) => {
    const lineId = await ctx.db.insert('supplierReceiptLines', { ...line, receiptId, corrected: 0, returned: 0 });
    if (line.accepted <= 0) return null;
    const { movementId } = await writeNewReceiptMovement(ctx, lineId, {
      branchId: header.branchId, variantId: line.variantId, delta: line.accepted, kind: movementKind,
      actor: actor.actorKey, actorLabel: actor.actorLabel, reason: header.reason, sourceRef: reference, sourceId: receiptId, ...lot,
    });
    await ctx.db.patch(lineId, { movementId });
    return movementId;
  }));
  const movementIds = posted.filter((id): id is Id<'stockMovements'> => id !== null);
  await Promise.all(held.map(line => ctx.db.insert('purchaseHolds', {
    branchId: header.branchId, status: 'open', receiptId, receiptReference: reference,
    orderId: header.orderId, orderReference: header.orderReference, variantId: line.variantId, item: line.item,
    quantity: line.quantity, acceptedQuantity: 0, reason: line.reason, createdAt: now, revision: 1,
  })));
  if (undercount) {
    await recordEvent(ctx, actor, {
      entity: 'receipt', entityId: undercount._id, branchId: undercount.branchId, action: 'missing_units_received',
      relatedId: receiptId, changes: [{ field: 'missingUnits', before: null, after: acceptedUnits }],
    });
  }
  if (followUp) {
    const { adjustment, link } = followUp;
    reserveWrites(ctx, 1);
    await ctx.db.patch(adjustment._id, {
      followUpReceiptId: receiptId, ...(adjustment.branchId !== header.branchId ? { followUpBranchId: header.branchId } : {}),
    });
    // Audit at the source: the corrected receipt's history links the follow-up without copying destination details.
    await recordEvent(ctx, actor, {
      entity: 'receipt', entityId: adjustment.receiptId, branchId: adjustment.branchId, action: 'follow_up_received',
      relatedId: receiptId, changes: [{ field: 'followUp.quantity', before: null, after: link.quantity }],
    });
  }
  await recordEvent(ctx, actor, {
    entity: 'receipt', entityId: receiptId, branchId: header.branchId, action: kind === 'rejected' ? 'rejected' : 'posted',
    reason: header.reason, relatedId: header.orderId ?? followUp?.adjustment._id,
  });
  return { id: receiptId, reference, movementIds } satisfies PurchasingResult;
}

export async function receiveOrder(ctx: MutationCtx, staff: StaffActor, args: ReceiveOrderArgs) {
  const order = await ctx.db.get(args.orderId);
  if (!order || order.status === 'deleted' || order.status === 'draft') fail('ORDER_NOT_FOUND', 'This order is not open for receiving.');
  await purchasingAccess(ctx, staff, order.branchId, 'receiver');
  const sourceAdjustment = await authorizeFollowUp(ctx, staff, order.branchId, args.followUp);
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, order.branchId, 'receipt.order', operationKey, payload, async () => {
    if (!ISSUED_OPEN.includes(order.status)) fail('ORDER_STATE', 'This order has no units due.', { status: order.status });
    if (order.issuedRevision !== args.expectedIssuedRevision) {
      fail('STALE', 'The order was amended. Review the latest quantities.', { issuedRevision: order.issuedRevision });
    }
    receiptEntryCount(args.lines, args.held);
    receiptLotCount(args.lines);
    uniqueBy(args.lines, line => line.orderLineId, 'Each order line can appear once per receipt.');
    const orderLines = new Map((await readOrderLines(ctx, order._id)).map(line => [line._id, line]));
    const headerReason = text(args.reason, 'Reason', 'reason');
    const plans: ReceiptLinePlan[] = [];
    const overs: { orderLineId: Id<'purchaseOrderLines'>; due: number }[] = [];
    const holds = new Map<Id<'purchaseHolds'>, Doc<'purchaseHolds'>>();
    for (const input of args.lines) {
      const line = orderLines.get(input.orderLineId);
      if (!line) fail('ORDER_LINE_NOT_FOUND', 'A line is not on this order.');
      quantity(input.accepted, 'Accepted quantity', 0);
      const rejected = quantity(input.rejected ?? 0, 'Rejected quantity', 0);
      const rejectReason = text(input.rejectReason, 'Rejection reason', 'reason') ?? (rejected ? headerReason : undefined);
      if (rejected && !rejectReason) fail('REASON_REQUIRED', 'Enter why goods were rejected.', { orderLineId: line._id });
      if (input.accepted > lineDue(line)) overs.push({ orderLineId: line._id, due: lineDue(line) });
      if (input.holdId) {
        if (holds.has(input.holdId)) fail('DUPLICATE_LINE', 'Each held goods record can be accepted once per receipt.');
        const hold = await ctx.db.get(input.holdId);
        if (!hold || hold.status !== 'open' || hold.branchId !== order.branchId || hold.variantId !== line.variantId) {
          fail('HOLD_NOT_OPEN', 'The held goods are no longer open for this item.');
        }
        // Held goods are accepted only on the order that received them (after an amend) or the order raised for them.
        if (hold.orderId !== order._id && order.forHoldId !== hold._id) {
          fail('HOLD_MISMATCH', 'These held goods belong to another order. Accept them on that order or on a linked replacement order.');
        }
        if (input.accepted > hold.quantity - hold.acceptedQuantity) fail('HOLD_EXCEEDED', 'Accept at most the held units.');
        holds.set(hold._id, hold);
      }
      plans.push({
        branchId: order.branchId, orderId: order._id, orderLineId: line._id, holdId: input.holdId,
        ...(input.holdId && input.accepted > 0 ? { holdQuantity: input.accepted } : {}),
        variantId: line.variantId, item: line.item, accepted: input.accepted, rejected, rejectReason, unitCost: line.unitCost,
        lot: lotEvidence(input, input.accepted),
      });
    }
    // Competing receipts: whoever commits second sees the reduced due quantity here.
    if (overs.length) fail('OVER_RECEIPT', 'More units than are still due. Review the latest quantities or hold the excess.', { lines: overs });
    // A replacement order owns its hold: units accepted for the held item come out of the hold first, even when the
    // client did not name it, so held goods are never posted twice. The rest of the line counts as new goods.
    if (order.forHoldId && !holds.has(order.forHoldId)) {
      const hold = await ctx.db.get(order.forHoldId);
      const plan = hold && hold.status === 'open' && hold.branchId === order.branchId
        ? plans.find(row => !row.holdId && row.variantId === hold.variantId && row.accepted > 0) : undefined;
      if (hold && plan) {
        plan.holdId = hold._id;
        plan.holdQuantity = Math.min(plan.accepted, hold.quantity - hold.acceptedQuantity);
        holds.set(hold._id, hold);
      }
    }
    const held = await planHeld(ctx, args.held);
    const undercount = await checkUndercount(ctx, order.branchId, args.undercount, { orderId: order._id, lines: plans }, args.followUp);
    const key = deliveryKey(args.deliveryReference);
    const duplicate = await checkDuplicate(ctx, order.branchId, order.supplierId, key, args.confirmDuplicate, undercount);
    const followUp = await checkFollowUp(ctx, order.branchId, args.followUp, sourceAdjustment, { supplierId: order.supplierId, orderId: order._id, lines: plans });
    const result = await postReceipt(ctx, actor, {
      branchId: order.branchId, kind: 'order', orderId: order._id, orderReference: order.reference, orderRevision: order.issuedRevision,
      supplierId: order.supplierId, supplier: order.supplier,
      deliveryReference: text(args.deliveryReference, 'Delivery reference', 'reference'), deliveryKey: key,
      ...duplicate, reason: duplicate ? `${duplicate.duplicateReason}${headerReason ? ` · ${headerReason}` : ''}` : headerReason,
      note: text(args.note, 'Note', 'note'),
    }, plans, held, followUp, PURCHASING_MOVEMENT_KINDS.receive, undercount);

    reserveWrites(ctx, plans.length + holds.size + 1);
    const accepted = plans.filter(plan => plan.accepted > 0);
    // Each plan is a distinct order line and item, so line and On order updates are independent.
    await Promise.all(accepted.map(async plan => {
      const line = orderLines.get(plan.orderLineId!)!;
      const total = line.accepted + plan.accepted;
      const open = lineDue({ ...line, accepted: total }) > 0;
      orderLines.set(line._id, { ...line, accepted: total, open });
      await ctx.db.patch(line._id, { accepted: total, open });
      await adjustIncoming(ctx, order.branchId, line.variantId, -plan.accepted);
    }));
    for (const plan of accepted) {
      if (plan.holdId && plan.holdQuantity) {
        const hold = holds.get(plan.holdId)!;
        const acceptedQuantity = hold.acceptedQuantity + plan.holdQuantity;
        const full = acceptedQuantity === hold.quantity;
        // The order and receipt that actually took the goods: the hold's own order (after an amend) or its linked replacement.
        await ctx.db.patch(hold._id, {
          acceptedQuantity, revision: hold.revision + 1,
          acceptedOrderId: order._id, acceptedOrderReference: order.reference, acceptedReceiptId: result.id as Id<'supplierReceipts'>,
          ...(full ? { status: 'accepted' as const, resolvedAt: Date.now(), resolvedByKey: actor.actorKey, resolvedByLabel: actor.actorLabel, resolution: `Accepted on ${order.reference} · ${result.reference}` } : {}),
        });
        await recordEvent(ctx, actor, {
          entity: 'hold', entityId: hold._id, branchId: hold.branchId, action: full ? 'accepted' : 'partially_accepted', relatedId: result.id,
          changes: [
            { field: 'acceptedQuantity', before: hold.acceptedQuantity, after: acceptedQuantity },
            { field: 'acceptedOn', before: null, after: order.reference },
            { field: 'acceptedReceipt', before: null, after: result.reference },
          ],
        });
      }
    }
    // The order's lines were read once (≤ 50) and updated in memory; no second range for the summary.
    const summary = orderSummary(order, [...orderLines.values()]);
    await ctx.db.patch(order._id, { ...summary, revision: order.revision + 1, updatedAt: Date.now() });
    return result;
  });
}

export async function receiveDirect(ctx: MutationCtx, staff: StaffActor, args: ReceiveDirectArgs) {
  const access = await purchasingAccess(ctx, staff, args.branchId, 'receiver');
  const sourceAdjustment = await authorizeFollowUp(ctx, staff, args.branchId, args.followUp);
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'receipt.direct', operationKey, payload, async () => {
    if (!access.directReceipt) fail('DIRECT_RECEIPT_DISABLED', 'Receiving without an order is off for this branch.');
    const why = reason(args.reason);
    receiptEntryCount(args.lines, args.held);
    receiptLotCount(args.lines);
    uniqueBy(args.lines, line => line.variantId, 'Each item can appear once per receipt.');
    const lots = args.lines.map(line => { quantity(line.accepted, 'Accepted quantity'); unitCost(line.unitCost); return lotEvidence(line, line.accepted); });
    const reads = await requireActiveItems(ctx, args.lines.map(line => line.variantId));
    const supplier = args.supplierId ? await requireSupplier(ctx, args.supplierId, false) : undefined;
    // Missing units of a recorded direct delivery belong to that delivery, not to an open order for the item.
    const undercount = await checkUndercount(ctx, args.branchId, args.undercount, { supplierId: supplier?._id, lines: args.lines }, args.followUp);
    if (!args.bypassOpenOrders && !undercount) {
      const matches = [];
      for (const line of args.lines) {
        const open = await ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open', q =>
          q.eq('branchId', args.branchId).eq('variantId', line.variantId).eq('open', true)).take(5);
        matches.push(...open.map(row => ({ variantId: row.variantId, orderId: row.orderId, orderLineId: row._id, due: lineDue(row) })));
      }
      if (matches.length) fail('OPEN_ORDERS_MATCH', 'Open orders exist for these items. Receive against an order, or confirm the bypass.', { matches });
    }
    const key = deliveryKey(args.deliveryReference);
    const duplicate = await checkDuplicate(ctx, args.branchId, args.supplierId, key, args.confirmDuplicate, undercount);
    const followUp = await checkFollowUp(ctx, args.branchId, args.followUp, sourceAdjustment, { supplierId: supplier?._id, lines: args.lines });
    const held = await planHeld(ctx, args.held);
    return postReceipt(ctx, actor, {
      branchId: args.branchId, kind: 'direct', supplierId: supplier?._id, supplier: supplier && supplierSnapshot(supplier),
      deliveryReference: text(args.deliveryReference, 'Delivery reference', 'reference'), deliveryKey: key,
      ...duplicate,
      reason: duplicate ? `${why} · ${duplicate.duplicateReason}` : why, note: text(args.note, 'Note', 'note'),
    }, args.lines.map((line, i) => ({
      branchId: args.branchId, variantId: line.variantId, item: reads[i].item, accepted: line.accepted, rejected: 0, unitCost: line.unitCost,
      lot: lots[i],
    })), held, followUp, PURCHASING_MOVEMENT_KINDS.direct, undercount);
  });
}

// ---------- Corrections and supplier returns ----------

async function loadReceiptLine(ctx: MutationCtx, receiptLineId: Id<'supplierReceiptLines'>) {
  const line = await ctx.db.get(receiptLineId);
  const receipt = line && await ctx.db.get(line.receiptId);
  if (!line || !receipt) fail('RECEIPT_NOT_FOUND', 'This receipt line no longer exists.');
  return { line, receipt };
}

export const eligibleUnits = (line: Pick<Doc<'supplierReceiptLines'>, 'accepted' | 'corrected' | 'returned'>) =>
  line.accepted - line.corrected - line.returned;

export type CorrectArgs = {
  receiptLineId: Id<'supplierReceiptLines'>; quantity: number; reason: string;
  /**
   * A stock lead's physical count and the stock revision they reviewed (from the report or preview). Required to post a
   * correction that leaves On hand negative; any stock change since that revision requires a fresh review.
   */
  negativeOverride?: { countedOnHand: number; stockRevision: number };
  /** The open reconciliation report a negative correction was blocked into. Required to post with the override. */
  reportId?: Id<'stockProblemReports'>;
  /** Actual lots of a tracked item being removed; otherwise core traces the original receipt movement. */
  lotAllocations?: ReceiptLotEvidence['lotAllocations'];
  operationKey: string;
};

type ReceiptLine = Doc<'supplierReceiptLines'>;

/** A named open core reconciliation report for this receipt line's movement at its branch. */
async function namedReport(ctx: QueryCtx, line: ReceiptLine, reportId: Id<'stockProblemReports'>) {
  const report = await stockRead(ctx, () => ctx.db.get(reportId));
  if (!report || report.branchId !== line.branchId || report.status !== 'open' || !line.movementId || report.movementId !== line.movementId) {
    fail('STOCK_REPORT_MISMATCH', 'Choose an open reconciliation report for this receipt line.');
  }
  return report;
}

/** The open reconciliation report already raised on this receipt line's movement, if any. */
export async function openLineReport(ctx: QueryCtx, line: ReceiptLine) {
  const movementId = line.movementId;
  if (!movementId) return null;
  return stockRead(ctx, () => ctx.db.query('stockProblemReports')
    .withIndex('by_movementId_and_branchId_and_status', q =>
      q.eq('movementId', movementId).eq('branchId', line.branchId).eq('status', 'open')).first());
}

/**
 * Whether the lots this correction would remove still hold the units. Lots never go negative: when the receipt's lots
 * were sold or moved since, the lot evidence must be corrected by a stock lead before the correction can post.
 */
async function lotsShort(ctx: QueryCtx, line: ReceiptLine, onHand: number, units: number, selected: Allocation[] | undefined) {
  const availability = await stockAvailability(ctx, line, onHand);
  if (!availability.tracking) return false;
  if (onHand - units < 0 || !line.movementId) return true;
  const evidence = await readLotMovement(ctx, line.movementId);
  if (!evidence) return true;
  const reversed = allocationCounts(evidence.reversed ?? []);
  const remaining = evidence.allocations
    .map(row => ({ lotId: row.lotId, quantity: row.quantity - (reversed.get(row.lotId) ?? 0) })).filter(row => row.quantity > 0);
  let left = units;
  const picks = selected ?? remaining.flatMap(row => {
    const take = Math.min(row.quantity, left);
    left -= take;
    return take > 0 ? [{ lotId: row.lotId, quantity: take }] : [];
  });
  if (!selected && left > 0) return true;
  const available = new Map(availability.lots.map(row => [row.lotId, row.available]));
  return picks.some(pick => pick.quantity > (available.get(pick.lotId) ?? 0));
}

/** Today's balance, its revision and why (if at all) a correction of `units` cannot post as entered. */
export async function assessCorrection(ctx: QueryCtx, line: ReceiptLine, units: number, selected?: Allocation[]) {
  const level = await readStockLevel(ctx, line.branchId, line.variantId);
  const onHand = level?.onHand ?? 0;
  const negative = onHand - units < 0;
  const blockedBy: CorrectionBlock | undefined =
    await lotsShort(ctx, line, onHand, units, selected) ? 'lot_reconciliation' : negative ? 'negative_stock' : undefined;
  return { level, onHand, stockRevision: level?.revision ?? 0, negative, blockedBy };
}

/** Correct new goods first and preserve the receipt's original hold contribution as posting evidence. */
async function correctHoldAcceptance(
  ctx: MutationCtx, actor: Actor, line: ReceiptLine, units: number, adjustmentId: Id<'supplierReceiptAdjustments'>, why: string,
) {
  const { holdId, holdQuantity } = line;
  if (!holdId || !holdQuantity) return;
  const remaining = line.accepted - line.corrected;
  const heldUnits = Math.min(holdQuantity, remaining) - Math.min(holdQuantity, remaining - units);
  if (heldUnits === 0) return;
  const hold = await stockRead(ctx, () => ctx.db.get(holdId));
  if (!hold || hold.acceptedQuantity < heldUnits) fail('HOLD_CHANGED', 'The held goods record no longer matches the accepted receipt units.');
  const acceptedQuantity = hold.acceptedQuantity - heldUnits;
  const reopened = hold.status === 'accepted';
  reserveWrites(ctx, 1);
  await ctx.db.patch(hold._id, {
    acceptedQuantity, revision: hold.revision + 1,
    ...(reopened ? {
      status: 'open' as const, resolution: undefined, resolvedAt: undefined, resolvedByKey: undefined, resolvedByLabel: undefined,
    } : {}),
  });
  await recordEvent(ctx, actor, {
    entity: 'hold', entityId: hold._id, branchId: hold.branchId, action: 'acceptance_corrected', reason: why, relatedId: adjustmentId,
    changes: [
      { field: 'acceptedQuantity', before: hold.acceptedQuantity, after: acceptedQuantity },
      ...(reopened ? [{ field: 'status', before: 'accepted', after: 'open' }] : []),
    ],
  });
}

/**
 * Remove an overcount or wrong-item posting. On an open or received order the units become due again;
 * an explicitly closed order or a superseded replacement cancels the corrected units in the same write.
 *
 * Outcomes are explicit (`CorrectionResult.outcome`):
 * - `reported`: nothing posted. A correction that would leave On hand negative, or whose receipt lots no longer hold
 *   the units, opens (or refreshes) one core reconciliation report on the receipt movement with the requested quantity
 *   and the stock revision reviewed.
 * - `posted`: the movement was written and any open report on the line is resolved. A negative result needs the named
 *   report, the same quantity and `negativeOverride` with a count and that same stock revision; a lot shortfall can
 *   never be overridden, only reconciled first.
 */
export async function correctReceiptLine(ctx: MutationCtx, staff: StaffActor, args: CorrectArgs): Promise<CorrectionResult> {
  const { line, receipt } = await loadReceiptLine(ctx, args.receiptLineId);
  await purchasingAccess(ctx, staff, line.branchId, 'lead');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce<CorrectionResult>(ctx, actor, line.branchId, 'receipt.correct', operationKey, payload, async commandId => {
    quantity(args.quantity, 'Correction quantity');
    const why = reason(args.reason);
    if (args.quantity > eligibleUnits(line)) fail('EXCEEDS_ELIGIBLE', 'Correct at most the units still accepted on this line.', { eligible: eligibleUnits(line) });
    const override = args.negativeOverride && {
      countedOnHand: quantity(args.negativeOverride.countedOnHand, 'Counted on hand', 0), stockRevision: args.negativeOverride.stockRevision,
    };
    const lots = lotEvidence({ lotAllocations: args.lotAllocations }, args.quantity, false);
    const [check, named, existing] = await Promise.all([
      assessCorrection(ctx, line, args.quantity, lots.lotAllocations),
      args.reportId ? namedReport(ctx, line, args.reportId) : null,
      args.reportId ? null : openLineReport(ctx, line),
    ]);
    const report = named ?? existing;

    if (check.blockedBy === 'lot_reconciliation' || (check.blockedBy === 'negative_stock' && !override)) {
      reserveWrites(ctx, 1);
      const patch = { requestedQuantity: args.quantity, reviewedRevision: check.stockRevision, reason: why };
      const reportId = report?._id ?? await ctx.db.insert('stockProblemReports', {
        branchId: line.branchId, movementId: line.movementId!, actor: actor.actorKey, actorLabel: actor.actorLabel,
        createdAt: Date.now(), status: 'open', revision: 1, ...patch,
      });
      if (report) await ctx.db.patch(report._id, { ...patch, revision: report.revision + 1 });
      await recordEvent(ctx, actor, {
        entity: 'receipt', entityId: receipt._id, branchId: receipt.branchId, action: 'correction_reported', reason: why, relatedId: reportId,
        changes: [{ field: 'blockedBy', before: null, after: check.blockedBy }],
      });
      return {
        outcome: 'reported', id: reportId, reference: receipt.reference, reportId, blockedBy: check.blockedBy,
        requestedQuantity: args.quantity, onHand: check.onHand, stockRevision: check.stockRevision,
      };
    }
    if (named && named.requestedQuantity !== args.quantity) {
      fail('STOCK_REPORT_MISMATCH', 'Post the quantity the reconciliation report reviewed, or refresh the report first.', { requestedQuantity: named.requestedQuantity });
    }
    if (override) {
      if (check.negative && !named) {
        fail('STOCK_RECONCILIATION_REQUIRED', 'Open the reconciliation report and record the physical count before posting a negative correction.');
      }
      if (override.stockRevision !== check.stockRevision || (named && named.reviewedRevision !== check.stockRevision)) {
        fail('STOCK_CHANGED', 'Stock changed since this correction was reviewed. Review the report again before posting.', { stockRevision: check.stockRevision });
      }
    }
    const { movementId, after } = await writeStockMovement(ctx, {
      branchId: line.branchId, variantId: line.variantId, delta: -args.quantity, kind: PURCHASING_MOVEMENT_KINDS.correct,
      sourceKey: `purchasing:correct:${commandId}`, actor: actor.actorKey, actorLabel: actor.actorLabel,
      reason: why, sourceRef: receipt.reference, sourceId: receipt._id, originalMovementId: line.movementId,
      allowNegative: check.negative && override !== undefined, markRecount: override !== undefined, ...lots,
    }, check.level);
    reserveWrites(ctx, 3 + Number(Boolean(report)));
    await ctx.db.patch(line._id, { corrected: line.corrected + args.quantity });
    const adjustmentId = await ctx.db.insert('supplierReceiptAdjustments', {
      kind: 'correction', branchId: line.branchId, receiptId: receipt._id, receiptLineId: line._id,
      orderId: line.orderId, orderLineId: line.orderLineId, variantId: line.variantId, item: line.item,
      quantity: args.quantity, reason: why, countedOnHand: override?.countedOnHand, negativeOverride: override && after < 0 ? true : undefined,
      reversedQuantity: 0, movementId, ...actor, createdAt: Date.now(),
    });
    if (report) {
      await ctx.db.patch(report._id, {
        status: 'resolved', revision: report.revision + 1, resolution: `Corrected on ${receipt.reference}: ${why}`,
        resolvedAt: Date.now(), resolvedBy: actor.actorKey,
      });
    }
    await correctHoldAcceptance(ctx, actor, line, args.quantity, adjustmentId, why);
    if (line.orderLineId && line.orderId) {
      const order = (await ctx.db.get(line.orderId))!;
      const orderLine = (await ctx.db.get(line.orderLineId))!;
      const closed = await correctionClosesRemainder(ctx, order);
      const accepted = orderLine.accepted - args.quantity;
      if (closed) {
        await ctx.db.patch(orderLine._id, { accepted, corrected: orderLine.corrected + args.quantity, cancelled: orderLine.cancelled + args.quantity });
        await shiftCommitment(ctx, orderLine.requestLineId, -args.quantity);
      } else {
        await ctx.db.patch(orderLine._id, { accepted, corrected: orderLine.corrected + args.quantity, open: true });
        await adjustIncoming(ctx, order.branchId, orderLine.variantId, args.quantity);
      }
      const summary = orderSummary(order, await readOrderLines(ctx, order._id));
      await ctx.db.patch(order._id, { ...summary, revision: order.revision + 1, updatedAt: Date.now() });
      await recordEvent(ctx, actor, { entity: 'order', entityId: order._id, branchId: order.branchId, action: 'receipt_corrected', reason: why,
        relatedId: adjustmentId, changes: [
          { field: 'status', before: order.status, after: summary.status },
          ...(closed ? [{ field: 'remainderCancelled', before: orderLine.cancelled, after: orderLine.cancelled + args.quantity }] : []),
        ] });
    }
    await recordEvent(ctx, actor, { entity: 'receipt', entityId: receipt._id, branchId: receipt.branchId, action: 'corrected', reason: why, relatedId: adjustmentId });
    return {
      outcome: 'posted', id: adjustmentId, reference: receipt.reference, adjustmentId, movementIds: [movementId],
      ...(report ? { resolvedReportId: report._id } : {}),
    };
  });
}

export type SupplierReturnArgs = {
  receiptLineId: Id<'supplierReceiptLines'>; quantity: number; reason: string; supplierReference?: string;
  lotAllocations?: ReceiptLotEvidence['lotAllocations']; operationKey: string;
};

/** Goods leave for the supplier. Accepted and due stay unchanged; the stock-out can never go negative. */
export async function returnToSupplier(ctx: MutationCtx, staff: StaffActor, args: SupplierReturnArgs) {
  const { line, receipt } = await loadReceiptLine(ctx, args.receiptLineId);
  await purchasingAccess(ctx, staff, line.branchId, 'lead');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, line.branchId, 'receipt.return', operationKey, payload, async commandId => {
    quantity(args.quantity, 'Return quantity');
    const why = reason(args.reason);
    if (args.quantity > eligibleUnits(line)) fail('EXCEEDS_ELIGIBLE', 'Return at most the units still accepted on this line.', { eligible: eligibleUnits(line) });
    const { movementId } = await writeStockMovement(ctx, {
      branchId: line.branchId, variantId: line.variantId, delta: -args.quantity, kind: PURCHASING_MOVEMENT_KINDS.supplierReturn,
      sourceKey: `purchasing:return:${commandId}`, actor: actor.actorKey, actorLabel: actor.actorLabel,
      reason: why, sourceRef: receipt.reference, sourceId: receipt._id, originalMovementId: line.movementId,
      ...lotEvidence({ lotAllocations: args.lotAllocations }, args.quantity, false),
    });
    reserveWrites(ctx, 3);
    await ctx.db.patch(line._id, { returned: line.returned + args.quantity });
    if (line.orderLineId) {
      const orderLine = (await ctx.db.get(line.orderLineId))!;
      await ctx.db.patch(orderLine._id, { returned: orderLine.returned + args.quantity });
    }
    const adjustmentId = await ctx.db.insert('supplierReceiptAdjustments', {
      kind: 'supplier_return', branchId: line.branchId, receiptId: receipt._id, receiptLineId: line._id,
      orderId: line.orderId, orderLineId: line.orderLineId, variantId: line.variantId, item: line.item,
      quantity: args.quantity, reason: why, supplierReference: text(args.supplierReference, 'Supplier reference', 'reference'),
      reversedQuantity: 0, movementId, ...actor, createdAt: Date.now(),
    });
    await recordEvent(ctx, actor, { entity: 'receipt', entityId: receipt._id, branchId: receipt.branchId, action: 'returned_to_supplier', reason: why, relatedId: adjustmentId });
    return { id: adjustmentId, reference: receipt.reference, movementIds: [movementId] };
  });
}

/**
 * After a reversal puts returned lots back on hand, make those lots traceable from the original receipt movement again,
 * so a later correction or return of the same receipt line can remove them.
 */
async function restoreReceiptLots(ctx: MutationCtx, receiptMovementId: Id<'stockMovements'> | undefined, reversalMovementId: Id<'stockMovements'>) {
  if (!receiptMovementId) return;
  const [receiptLots, restored] = await Promise.all([readLotMovement(ctx, receiptMovementId), readLotMovement(ctx, reversalMovementId)]);
  if (!receiptLots || !restored) return;
  const back = allocationCounts(restored.allocations);
  const reversed = (receiptLots.reversed ?? [])
    .map(({ lotId, quantity }) => ({ lotId, quantity: quantity - (back.get(lotId) ?? 0) }));
  if (reversed.some(line => line.quantity < 0)) fail('STOCK_LOT_RECONCILIATION', 'The reversed lots do not match the original receipt. Review the stock ledger.');
  reserveWrites(ctx, 1);
  await ctx.db.patch(receiptLots._id, { reversed: reversed.filter(line => line.quantity > 0) });
}

export type ReverseReturnArgs = {
  adjustmentId: Id<'supplierReceiptAdjustments'>; quantity: number; reason: string;
  lotAllocations?: ReceiptLotEvidence['lotAllocations']; operationKey: string;
};

/** Correct an erroneous supplier return with a linked inverse movement. */
export async function reverseSupplierReturn(ctx: MutationCtx, staff: StaffActor, args: ReverseReturnArgs) {
  const original = await ctx.db.get(args.adjustmentId);
  if (!original || original.kind !== 'supplier_return') fail('RETURN_NOT_FOUND', 'This supplier return no longer exists.');
  await purchasingAccess(ctx, staff, original.branchId, 'lead');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, original.branchId, 'receipt.reverse_return', operationKey, payload, async commandId => {
    quantity(args.quantity, 'Reversal quantity');
    const why = reason(args.reason);
    if (args.quantity > original.quantity - original.reversedQuantity) fail('EXCEEDS_ELIGIBLE', 'Reverse at most the units returned.');
    const { line, receipt } = await loadReceiptLine(ctx, original.receiptLineId);
    const { movementId } = await writeStockMovement(ctx, {
      branchId: original.branchId, variantId: original.variantId, delta: args.quantity, kind: PURCHASING_MOVEMENT_KINDS.returnReversal,
      sourceKey: `purchasing:reverse:${commandId}`, actor: actor.actorKey, actorLabel: actor.actorLabel,
      reason: why, sourceRef: receipt.reference, sourceId: receipt._id, originalMovementId: original.movementId,
      ...lotEvidence({ lotAllocations: args.lotAllocations }, args.quantity, false),
    });
    await restoreReceiptLots(ctx, line.movementId, movementId);
    reserveWrites(ctx, 4);
    await ctx.db.patch(original._id, { reversedQuantity: original.reversedQuantity + args.quantity });
    await ctx.db.patch(line._id, { returned: line.returned - args.quantity });
    if (line.orderLineId) {
      const orderLine = (await ctx.db.get(line.orderLineId))!;
      await ctx.db.patch(orderLine._id, { returned: orderLine.returned - args.quantity });
    }
    const adjustmentId = await ctx.db.insert('supplierReceiptAdjustments', {
      kind: 'return_reversal', branchId: original.branchId, receiptId: receipt._id, receiptLineId: line._id,
      orderId: line.orderId, orderLineId: line.orderLineId, variantId: line.variantId, item: line.item,
      quantity: args.quantity, reason: why, reversesAdjustmentId: original._id, reversedQuantity: 0, movementId, ...actor, createdAt: Date.now(),
    });
    await recordEvent(ctx, actor, { entity: 'receipt', entityId: receipt._id, branchId: receipt.branchId, action: 'return_reversed', reason: why, relatedId: adjustmentId });
    return { id: adjustmentId, reference: receipt.reference, movementIds: [movementId] };
  });
}

export type UpdateReceiptArgs = {
  receiptId: Id<'supplierReceipts'>; expectedRevision: number; deliveryReference?: string; note?: string;
  confirmDuplicate?: DuplicateConfirmation; operationKey: string;
};

/** Edit the delivery reference or note, with a history entry. Quantities change only through corrections. */
export async function updateReceiptDetails(ctx: MutationCtx, staff: StaffActor, args: UpdateReceiptArgs) {
  const receipt = await ctx.db.get(args.receiptId);
  if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt no longer exists.');
  await purchasingAccess(ctx, staff, receipt.branchId, 'receiver');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, receipt.branchId, 'receipt.update', operationKey, payload, async () => {
    expectRevision(receipt.revision, args.expectedRevision, 'receipt');
    const deliveryReference = args.deliveryReference === undefined ? receipt.deliveryReference : text(args.deliveryReference, 'Delivery reference', 'reference');
    const note = args.note === undefined ? receipt.note : text(args.note, 'Note', 'note');
    const key = deliveryKey(deliveryReference);
    // A changed key is checked again; the confirmation (original id, reference, reason) is persisted, or cleared when
    // the new reference is not a duplicate. An unchanged key keeps the stored confirmation.
    const keyChanged = key !== receipt.deliveryKey;
    const sameDelivery = keyChanged && receipt.undercountOf ? await ctx.db.get(receipt.undercountOf) : undefined;
    const duplicate = keyChanged ? await checkDuplicate(ctx, receipt.branchId, receipt.supplierId, key, args.confirmDuplicate, sameDelivery) : undefined;
    const confirmation = keyChanged
      ? { duplicateOfReceiptId: duplicate?.duplicateOfReceiptId, duplicateOfReference: duplicate?.duplicateOfReference, duplicateReason: duplicate?.duplicateReason }
      : {};
    reserveWrites(ctx, 1);
    await ctx.db.patch(receipt._id, { deliveryReference, deliveryKey: key, note, ...confirmation, revision: receipt.revision + 1 });
    await recordEvent(ctx, actor, { entity: 'receipt', entityId: receipt._id, branchId: receipt.branchId, action: 'edited', changes: [
      { field: 'deliveryReference', before: receipt.deliveryReference ?? null, after: deliveryReference ?? null },
      { field: 'note', before: receipt.note ?? null, after: note ?? null },
      ...(keyChanged && (duplicate || receipt.duplicateOfReceiptId) ? [
        { field: 'duplicateOf', before: receipt.duplicateOfReference ?? null, after: duplicate?.duplicateOfReference ?? null },
        { field: 'duplicateReason', before: receipt.duplicateReason ?? null, after: duplicate?.duplicateReason ?? null },
      ] : []),
    ] });
    return { id: receipt._id, reference: receipt.reference, revision: receipt.revision + 1 };
  });
}

export type DeclineHoldArgs = { holdId: Id<'purchaseHolds'>; expectedRevision: number; reason: string; operationKey: string };

/** The buyer records that held goods were declined and returned before acceptance. On hand is unchanged. */
export async function declineHold(ctx: MutationCtx, staff: StaffActor, args: DeclineHoldArgs) {
  const hold = await ctx.db.get(args.holdId);
  if (!hold) fail('HOLD_NOT_OPEN', 'These held goods no longer exist.');
  await purchasingAccess(ctx, staff, hold.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, hold.branchId, 'hold.decline', operationKey, payload, async () => {
    expectRevision(hold.revision, args.expectedRevision, 'held goods record');
    if (hold.status !== 'open') fail('HOLD_NOT_OPEN', 'These held goods were already resolved.');
    const why = reason(args.reason);
    reserveWrites(ctx, 1);
    await ctx.db.patch(hold._id, {
      status: 'declined', resolution: why, resolvedByKey: actor.actorKey, resolvedByLabel: actor.actorLabel,
      resolvedAt: Date.now(), revision: hold.revision + 1,
    });
    await recordEvent(ctx, actor, { entity: 'hold', entityId: hold._id, branchId: hold.branchId, action: 'declined', reason: why });
    return { id: hold._id, revision: hold.revision + 1 };
  });
}
