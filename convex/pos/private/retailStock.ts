import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { requireBranchAccess } from '../../branches/model';
import { readCommerceSettings, readStockAvailability } from '../../commerce/model';
import { openHandoversForOrder } from './handoverCustody';

export function retailError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function productsEnabled(flag: 'off' | 'managers' | 'everyone', manager: boolean) {
  return flag === 'everyone' || flag === 'managers' && manager;
}

export async function requireRetailBranch(ctx: QueryCtx, actor: StaffActor, branchId: Id<'branches'>) {
  const [branch, settings] = await Promise.all([requireBranchAccess(ctx, actor, branchId), readCommerceSettings(ctx)]);
  if (branch.state !== 'active') retailError('branch_unavailable', 'Choose an active selling branch.');
  if (settings.paymentsMode !== 'attempts' || !productsEnabled(settings.saleSwitches.products, actor.capabilities.approve)) {
    retailError('sale_disabled', 'Product sales require the new payments at this checkout.');
  }
}

/** Demand at the branch excludes goods already handed over, which have their own stock movement. */
export async function retailProductLines(ctx: QueryCtx, order: Doc<'orders'>, lines: Doc<'orderLines'>[], variantId: Id<'productVariants'>) {
  const heldLines = new Set((await openHandoversForOrder(ctx, order)).map(handover =>
    handover.successorOrderId === order._id ? handover.successorLineId ?? handover.lineId : handover.lineId));
  return lines.filter(row => row.kind === 'product' && row.variantId === variantId && !heldLines.has(row._id));
}

export async function assertRetailQuantity(ctx: QueryCtx, args: {
  branchId: Id<'branches'>; orderId: Id<'orders'>; variantId: Id<'productVariants'>; demand: number;
}) {
  const { branchId, orderId, variantId, demand } = args;
  const stock = await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q =>
    q.eq('variantId', variantId).eq('branchId', branchId)).unique();
  const { tracking, held, sellable, reservationId } = await readStockAvailability(ctx, { branchId, variantId, orderId, onHand: stock?.onHand ?? 0 });
  if ((tracking || held > 0 || reservationId) && demand > sellable) {
    retailError('stock_unavailable', 'There is not enough sellable stock at this branch. Reduce the quantity or choose another product.');
  }
}
