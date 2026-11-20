import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import type { AdjustmentChange } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { COMMERCE_LIMITS, incrementalShare } from '../../shared/commerce';
import { refreshOrder } from './orderModel';
import { readOrderProjection } from './orderLifecycle';

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

export async function prepareRecollectionTakeBack(
  ctx: MutationCtx, actor: StaffActor, handover: Doc<'handovers'>,
  input: { contentKey: string; quantity: number; disposition: 'sellable' | 'damaged' },
): Promise<AdjustmentChange> {
  const fail = (message: string): never => { throw new ConvexError({ code: 'HANDOVER_CHANGED', message }); };
  if (!handover.successorOrderId || !handover.successorLineId || handover.kind !== 'recollect' ||
      handover.status !== 'open' || handover.pendingReturnId) {
    return fail('This charge is no longer available to take back.');
  }
  const [order, line] = await Promise.all([
    readOrderProjection(ctx, () => ctx.db.get(handover.successorOrderId!)),
    readOrderProjection(ctx, () => ctx.db.get(handover.successorLineId!)),
  ]);
  const snapshot = line?.saleSnapshot;
  const { quantity, contentKey, disposition } = input;
  const { contents } = handover;
  const part = contents?.find(content => content.contentKey === contentKey);
  if (!order || order.status !== 'draft' || order.activeAttemptId || line?.orderId !== order._id || !snapshot || !contents ||
      !part || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > part.unpaid || quantity > part.withGuest) {
    return fail('Review the items still with the guest before taking one back.');
  }
  const movement = await readOrderProjection(ctx, () => ctx.db.get(part.originalMovementId));
  if (!movement || movement.variantId !== part.variantId) return fail('The original stock movement is missing.');
  const stock = await readOrderProjection(ctx, () => ctx.db.query('stockLevels')
    .withIndex('by_variantId_and_branchId', q => q.eq('variantId', part.variantId).eq('branchId', movement.branchId)).unique());
  if (!stock) return fail('The original stock record is missing.');

  const sellable = disposition === 'sellable' ? quantity : 0;
  const damaged = quantity - sellable;
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
      reserveWrites(ctx, 4 + Number(sellable > 0) + Number(Boolean(order.promotion)));
      if (sellable) await ctx.db.patch(stock._id, { onHand: stock.onHand + sellable, revision: stock.revision + 1 });
      const movementId = await ctx.db.insert('stockMovements', {
        variantId: part.variantId, branchId: movement.branchId, kind: sellable ? 'taken_back' : 'write_off',
        before: stock.onHand, after: stock.onHand + sellable, delta: sellable, sourceKey,
        actor: actor.email, createdAt: recordedAt, reason: reasonText ?? reasonCode,
      });
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
