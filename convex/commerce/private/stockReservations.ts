import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { reserveWrites } from '../../lib/readBudget';
import { COMMERCE_LIMITS } from '../../shared/commerce';
import {
  allocateStockLots, expansionError, maxActiveReservations, stockAvailability, stockText, stockUnits, type StockScope, expansionRead,
} from './stockAvailability';
import { readStockLevel, writeStockMovement } from './stockLedger';

const checkoutHoldMs = 10 * 60_000;
const checkoutHoldLines = COMMERCE_LIMITS.sale.distinctVariants;
const maxReservationMs = 60 * 60 * 1000;

export async function reserveStock(ctx: MutationCtx, args: StockScope & {
  orderId?: Id<'orders'>; checkout?: true; sourceKey: string; actor: string; quantity: number; expiresAt: number;
}): Promise<Id<'stockReservations'>> {
  const sourceKey = stockText(args.sourceKey, 200, 'a hold reference');
  const actor = stockText(args.actor, 300, 'the operator');
  const quantity = stockUnits(args.quantity);
  const previous = await ctx.db.query('stockReservations')
    .withIndex('by_sourceKey', q => q.eq('sourceKey', sourceKey)).unique();
  if (previous) {
    if (previous.branchId !== args.branchId || previous.variantId !== args.variantId || previous.orderId !== args.orderId ||
        previous.checkout !== args.checkout || previous.quantity !== quantity || previous.expiresAt !== args.expiresAt || previous.actor !== actor) {
      expansionError('STOCK_KEY_CONFLICT', 'This hold reference was already used for a different action.');
    }
    return previous._id;
  }
  const now = Date.now();
  if (!Number.isSafeInteger(args.expiresAt) || args.expiresAt <= now || args.expiresAt > now + maxReservationMs) {
    expansionError('INVALID_STOCK_RESERVATION_EXPIRY', 'A stock hold must expire within one hour.');
  }
  const [level, branch, variant, order] = await Promise.all([
    readStockLevel(ctx, args.branchId, args.variantId), ctx.db.get(args.branchId), ctx.db.get(args.variantId),
    args.orderId ? ctx.db.get(args.orderId) : null,
  ]);
  if (branch?.state !== 'active' || variant?.status !== 'active' || (args.orderId && (order?.status !== 'draft' || order.stockBranchId && order.stockBranchId !== args.branchId))) {
    expansionError('INVALID_STOCK_RESERVATION_SCOPE', 'Choose an active branch and product with a valid order reference.');
  }
  const availability = await stockAvailability(ctx, args, level?.onHand ?? 0, now);
  if (availability.reservations.length >= maxActiveReservations) {
    expansionError('STOCK_RESERVATION_LIMIT', 'Too many active stock holds for this item.');
  }
  if (args.orderId && availability.reservations.some(row => row.orderId === args.orderId)) {
    expansionError('STOCK_RESERVATION_EXISTS', 'The order already has an active hold for this item.');
  }
  if (availability.sellable < quantity) expansionError('INSUFFICIENT_STOCK', 'There is insufficient sellable stock for this hold.');
  const allocations = availability.tracking ? allocateStockLots(availability.lots, quantity, args.expiresAt) : [];
  reserveWrites(ctx, 1);
  const reservationId = await ctx.db.insert('stockReservations', {
    branchId: args.branchId, variantId: args.variantId, orderId: args.orderId, checkout: args.checkout,
    sourceKey, actor, quantity, expiresAt: args.expiresAt, state: 'active', allocations, createdAt: now,
  });
  await ctx.scheduler.runAt(args.expiresAt, internal.commerce.stockExpansion.expireReservation, { reservationId });
  return reservationId;
}

export async function releaseStock(ctx: MutationCtx, reservationId: Id<'stockReservations'>, actor: string) {
  const row = await ctx.db.get(reservationId);
  if (!row) expansionError('STOCK_RESERVATION_NOT_FOUND', 'The stock hold does not exist.');
  if (row.state === 'consumed') expansionError('STOCK_RESERVATION_CONSUMED', 'The units from this hold were already sold.');
  if (row.state !== 'active') return;
  reserveWrites(ctx, 1);
  await ctx.db.patch(reservationId, { state: 'released', closedAt: Date.now(), closedBy: stockText(actor, 300, 'the operator') });
}

export async function consumeStock(ctx: MutationCtx, reservationId: Id<'stockReservations'>, sourceKey: string, actor: string) {
  const row = await ctx.db.get(reservationId);
  if (!row) expansionError('STOCK_RESERVATION_NOT_FOUND', 'The stock hold does not exist.');
  if (row.orderId) expansionError('STOCK_RESERVATION_ORDER_ATTACHED', 'Settle this hold through its attached order.');
  return writeStockMovement(ctx, {
    branchId: row.branchId, variantId: row.variantId, delta: -row.quantity, kind: 'sale',
    sourceKey: 'stock-reservation:' + stockText(sourceKey, 200, 'a sale reference'),
    actor: stockText(actor, 300, 'the operator'), reservationId, sourceId: reservationId,
  });
}

export async function expireStockReservation(ctx: MutationCtx, reservationId: Id<'stockReservations'>) {
  const row = await ctx.db.get(reservationId);
  if (row?.state === 'active' && row.expiresAt <= Date.now()) {
    reserveWrites(ctx, 1);
    await ctx.db.patch(reservationId, { state: 'expired', closedAt: Date.now() });
  }
}

type CheckoutLine = { variantId: Id<'productVariants'>; quantity: number };

export async function placeCheckoutHolds(ctx: MutationCtx, args: {
  orderId: Id<'orders'>; branchId: Id<'branches'>; attemptId: Id<'paymentAttempts'>;
  legKey: string; lines: CheckoutLine[]; actor: string;
}) {
  if (!args.lines.length) return;
  await ctx.runMutation(internal.commerce.stockExpansion.reserveCheckout, args);
}

/** On failure, convex rolls back this child mutation even when the caller returns a payment refusal. */
export async function reserveCheckoutHolds(ctx: MutationCtx, args: {
  orderId: Id<'orders'>; branchId: Id<'branches'>; attemptId: Id<'paymentAttempts'>;
  legKey: string; lines: CheckoutLine[]; actor: string;
}): Promise<void> {
  if (args.lines.length > checkoutHoldLines || new Set(args.lines.map(line => line.variantId)).size !== args.lines.length) {
    expansionError('STOCK_RESERVATION_LIMIT', 'Split this order into smaller payments.');
  }
  const expiresAt = Date.now() + checkoutHoldMs;
  for (const line of args.lines) {
    await reserveStock(ctx, {
      ...line, branchId: args.branchId, orderId: args.orderId, checkout: true, actor: args.actor, expiresAt,
      sourceKey: JSON.stringify(['checkout', args.attemptId, args.legKey, line.variantId]),
    });
  }
}

export async function releaseCheckoutHolds(ctx: MutationCtx, orderId: Id<'orders'>, actor: string) {
  const active = await expansionRead(ctx, () => ctx.db.query('stockReservations')
    .withIndex('by_orderId_and_state_and_expiresAt', q => q.eq('orderId', orderId).eq('state', 'active').gt('expiresAt', Date.now()))
    .take(2 * checkoutHoldLines + 1));
  if (active.length > 2 * checkoutHoldLines) expansionError('STOCK_RESERVATION_LIMIT', 'This order has too many active stock holds.');
  const owned = active.filter(row => row.checkout);
  if (!owned.length) return;
  reserveWrites(ctx, owned.length);
  for (const row of owned) {
    await ctx.db.patch(row._id, { state: 'released', closedAt: Date.now(), closedBy: actor });
  }
}
