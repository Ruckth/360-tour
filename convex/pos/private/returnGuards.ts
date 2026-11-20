import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { COMMERCE_LIMITS } from '../../shared/commerce';
import { openOrderReturn, readCommerceReceiptStatus, readOrderProjection } from './orderLifecycle';
import { orderLines } from './orderLines';

type ReadCtx = QueryCtx | MutationCtx;

export async function assertNoOpenReturn(ctx: ReadCtx, order: Doc<'orders'>) {
  const active = await openOrderReturn(ctx, order._id);
  if (active) throw new ConvexError({
    code: 'RETURN_IN_PROGRESS', message: 'Return in progress', returnId: active._id,
  });
}

export function returnPayments(ctx: ReadCtx, order: Doc<'orders'>) {
  return readOrderProjection(ctx, () => ctx.db.query('orderPayments')
    .withIndex('by_orderId', q => q.eq('orderId', order._id)).take(COMMERCE_LIMITS.sale.paymentRows + 1));
}

/** The one commerce-receipt predicate the receipt, refunds, corrections and approvals share. */
export const hasCommerceReceipt = readCommerceReceiptStatus;

/** Today's money writers on a receipt: refused while a return is open, and on commerce receipts (v27 Returns). */
export async function assertExistingMoneyFlow(ctx: ReadCtx, order: Doc<'orders'>) {
  await assertNoOpenReturn(ctx, order);
  if (await readCommerceReceiptStatus(ctx, order, await readOrderProjection(ctx, () => orderLines(ctx, order._id)))) {
    throw new ConvexError({
      code: 'USE_RETURN_ITEMS', message: 'Use Return items on this receipt.', orderId: order._id,
    });
  }
}
