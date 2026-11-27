import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { canReadCheckoutOrder, type StaffActor } from '../../auth/model';
import { writeStockMovement, type AdjustmentChange } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { COMMERCE_LIMITS, incrementalShare } from '../../shared/commerce';
import { refreshOrder } from './orderModel';
import { readOrderProjection } from './orderLifecycle';
import { MAX_RETURN_LOTS, readReturnMovementLots, remainingReturnLots, selectReturnLots, type LotAllocation } from './returnLots';

type Order = Doc<'orders'>;
type Line = Doc<'orderLines'>;
type ReadCtx = MutationCtx | QueryCtx;

export async function handoverForLine(ctx: ReadCtx, order: Order, line: Line) {
  const successor = order.parentOrderId ? await readOrderProjection(ctx, () => ctx.db.query('handovers')
    .withIndex('by_successorOrderId_and_successorLineId', q => q.eq('successorOrderId', order._id).eq('successorLineId', line._id))
    .unique()) : null;
  return successor ?? await readOrderProjection(ctx, () => ctx.db.query('handovers')
    .withIndex('by_orderId_and_lineId', q => q.eq('orderId', order._id).eq('lineId', line._id)).unique());
}

export async function openHandoversForOrder(ctx: ReadCtx, order: Order) {
  const limit = COMMERCE_LIMITS.sale.rows;
  const [posted, recollection] = await Promise.all([
    readOrderProjection(ctx, () => ctx.db.query('handovers')
      .withIndex('by_orderId_and_status', q => q.eq('orderId', order._id).eq('status', 'open')).take(limit + 1)),
    order.parentOrderId ? readOrderProjection(ctx, () => ctx.db.query('handovers')
      .withIndex('by_successorOrderId_and_status', q => q.eq('successorOrderId', order._id).eq('status', 'open')).take(limit + 1)) : [],
  ]);
  const current = [...posted.filter(row => !row.successorOrderId || row.successorOrderId === order._id), ...recollection];
  const distinct = [...new Map(current.map(row => [row._id, row])).values()];
  if (distinct.length > limit) throw new ConvexError('Split the handover collection into two orders.');
  return distinct;
}

export async function assertHandoverEditable(ctx: ReadCtx, order: Order, line?: Line) {
  if (line && line.kind !== 'product' && line.kind !== 'package') return;
  const held = line ? (await handoverForLine(ctx, order, line))?.withGuest : (await openHandoversForOrder(ctx, order)).some(row => row.withGuest > 0);
  if (held) throw new ConvexError({
    code: 'HANDOVER_IN_CUSTODY', message: 'Collect payment or take back the handed-over items before changing this row.',
  });
}

export function recollectionAmount(content: NonNullable<Doc<'handovers'>['contents']>[number]) {
  const released = incrementalShare(content.allocatedPrice, {
    unitsSold: content.quantity, unitsBefore: 0, unitsThrough: content.quantity - content.unpaid,
  }).total;
  return content.allocatedPrice - released;
}

function takeBackError(message: string): never {
  throw new ConvexError({ code: 'HANDOVER_CHANGED', message });
}

export async function readRecollectionTarget(ctx: ReadCtx, actor: StaffActor, handover: Doc<'handovers'>, contentKey?: string) {
  const part = handover.contents?.find(content => content.contentKey === contentKey);
  const [order, movement] = await Promise.all([
    handover.successorOrderId ? readOrderProjection(ctx, () => ctx.db.get(handover.successorOrderId!)) : null,
    part ? readOrderProjection(ctx, () => ctx.db.get(part.originalMovementId)) : null,
  ]);
  if (!order || !canReadCheckoutOrder(actor, order) || (movement && !actor.companyScope && !actor.branchIds.includes(movement.branchId))) {
    throw new ConvexError({ code: 'ADJUSTMENT_TARGET_MISSING', message: 'Recollection charge not found.' });
  }
  return { order, part, movement };
}

export async function readTakeBackLots(ctx: QueryCtx, actor: StaffActor, handoverId: Id<'handovers'>, contentKey: string) {
  const handover = await readOrderProjection(ctx, () => ctx.db.get(handoverId));
  if (handover?.kind !== 'recollect') takeBackError('Recollection charge not found.');
  const { order, part, movement } = await readRecollectionTarget(ctx, actor, handover, contentKey);
  if (order.status !== 'draft' || order.activeAttemptId || handover.status !== 'open' || handover.pendingReturnId ||
      !part?.withGuest || !part.unpaid || !movement || movement.delta >= 0 || movement.variantId !== part.variantId) {
    takeBackError('This charge is no longer available to take back.');
  }
  return await readReturnMovementLots(ctx, movement);
}

export async function prepareRecollectionTakeBack(
  ctx: MutationCtx, actor: StaffActor, handover: Doc<'handovers'>,
  input: { contentKey: string; quantity: number; disposition: 'sellable' | 'damaged'; lotAllocations?: LotAllocation[] },
): Promise<AdjustmentChange> {
  if (!handover.successorOrderId || !handover.successorLineId || handover.kind !== 'recollect' ||
      handover.status !== 'open' || handover.pendingReturnId) {
    return takeBackError('This charge is no longer available to take back.');
  }
  const { quantity, contentKey, disposition } = input;
  const [{ order, part, movement }, line] = await Promise.all([
    readRecollectionTarget(ctx, actor, handover, contentKey),
    readOrderProjection(ctx, () => ctx.db.get(handover.successorLineId!)),
  ]);
  const snapshot = line?.saleSnapshot;
  const { contents } = handover;
  if (!order || order.status !== 'draft' || order.activeAttemptId || line?.orderId !== order._id || !snapshot || !contents ||
      !part || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > part.unpaid || quantity > part.withGuest) {
    return takeBackError('Review the items still with the guest before taking one back.');
  }
  if (!movement || movement.delta >= 0 || movement.variantId !== part.variantId) return takeBackError('The original stock movement is missing.');
  const stock = await readOrderProjection(ctx, () => ctx.db.query('stockLevels')
    .withIndex('by_variantId_and_branchId', q => q.eq('variantId', part.variantId).eq('branchId', movement.branchId)).unique());
  if (!stock) return takeBackError('The original stock record is missing.');

  const sellable = disposition === 'sellable' ? quantity : 0;
  const damaged = quantity - sellable;
  const requested = input.lotAllocations;
  if (requested && (!sellable || !requested.length || requested.length > MAX_RETURN_LOTS)) {
    takeBackError('Confirm lots only for sellable goods received back.');
  }
  const lotOptions = sellable ? await readReturnMovementLots(ctx, movement) : undefined;
  if (requested && !lotOptions?.tracked) takeBackError('This item has no tracked lots.');
  const lotAllocations = lotOptions?.tracked
    ? selectReturnLots(quantity, requested, remainingReturnLots(lotOptions.lots)).map(({ lotId, quantity }) => ({ lotId, quantity }))
    : undefined;
  const nextParts = contents.map(content => content !== part ? content : {
    ...content, withGuest: content.withGuest - quantity, unpaid: content.unpaid - quantity,
    backSellable: content.backSellable + sellable, backDamaged: content.backDamaged + damaged,
  });
  const next = {
    withGuest: handover.withGuest - quantity, unpaid: handover.unpaid - quantity,
    backSellable: handover.backSellable + sellable, backDamaged: handover.backDamaged + damaged,
  };
  const available = new Map(nextParts.filter(content => content.unpaid).map(content => [content.contentKey, content]));
  const updatedContents = snapshot.contents.flatMap(content => {
    const remaining = available.get(content.contentKey);
    return remaining ? [{ ...content, units: remaining.unpaid, paidShare: recollectionAmount(remaining) }] : [];
  });
  const total = updatedContents.reduce((sum, content) => sum + content.paidShare, 0);
  const qty = line.kind === 'product' ? next.unpaid : 1;
  return {
    before: { withGuest: handover.withGuest, backSellable: handover.backSellable, backDamaged: handover.backDamaged, unpaid: handover.unpaid },
    after: next, quantityDelta: -quantity,
    apply: async ({ revisionAfter, recordedAt, sourceKey, reasonText, reasonCode }) => {
      reserveWrites(ctx, 3 + Number(Boolean(order.promotion)));
      const { movementId } = await writeStockMovement(ctx, {
        variantId: part.variantId, branchId: movement.branchId, kind: sellable ? 'taken_back' : 'write_off',
        delta: sellable, originalMovementId: movement._id, lotAllocations, sourceKey, actor: actor.email,
        createdAt: recordedAt, reason: reasonText ?? reasonCode, reasonCode,
      }, stock);
      await ctx.db.patch(handover._id, {
        ...next, contents: nextParts, revision: revisionAfter, status: next.withGuest ? 'open' : 'closed',
        movementIds: [...handover.movementIds, movementId],
      });
      if (next.unpaid) {
        const unitPrice = Math.ceil(total / qty);
        const discount = unitPrice * qty - total;
        await ctx.db.patch(line._id, {
          qty, unitPrice, catalogUnitPrice: unitPrice, discount: discount ? { type: 'amount', value: discount } : undefined,
          saleSnapshot: { ...snapshot, paidShare: total, contents: updatedContents },
        });
      } else {
        await ctx.db.delete(line._id);
      }
      await refreshOrder(ctx, order._id);
      return [{ kind: 'stockMovement', id: movementId }];
    },
  };
}
