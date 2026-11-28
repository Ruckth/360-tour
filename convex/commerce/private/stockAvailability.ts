import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readBudget } from '../../lib/readBudget';

export type StockScope = { branchId: Id<'branches'>; variantId: Id<'productVariants'> };
export type Allocation = { lotId: Id<'stockLots'>; quantity: number };
export const maxActiveLots = 100;
export const maxActiveReservations = 100;

export function expansionError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function stockUnits(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    expansionError('INVALID_STOCK_QUANTITY', 'Enter a positive whole quantity.');
  }
  return quantity;
}

export function stockText(value: string, limit: number, field: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) expansionError('INVALID_STOCK_TEXT', `Enter ${field} within ${limit} characters.`);
  return trimmed;
}

export async function expansionRead<T>(ctx: QueryCtx, read: () => Promise<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const result = await read();
  for (const row of Array.isArray(result) ? result : [result]) {
    if (row !== null && row !== undefined) budget.document(row);
  }
  budget.assert();
  return result;
}

export function readsTracking(ctx: QueryCtx, variantId: StockScope['variantId']) {
  return expansionRead(ctx, () => ctx.db.query('stockTracking').withIndex('by_variantId', q => q.eq('variantId', variantId)).unique());
}

export async function activeReservations(ctx: QueryCtx, scope: StockScope, now: number) {
  const rows = await expansionRead(ctx, () => ctx.db.query('stockReservations')
    .withIndex('by_branchId_and_variantId_and_state_and_expiresAt',
      q => q.eq('branchId', scope.branchId).eq('variantId', scope.variantId).eq('state', 'active').gt('expiresAt', now))
    .take(maxActiveReservations + 1));
  if (rows.length > maxActiveReservations) expansionError('STOCK_RESERVATION_LIMIT', 'Too many active stock holds for this item.');
  return rows;
}

export async function physicalLots(ctx: QueryCtx, scope: StockScope) {
  const rows = await expansionRead(ctx, () => ctx.db.query('stockLotBalances')
    .withIndex('by_branchId_and_variantId_and_inStock_and_expiresAt',
      q => q.eq('branchId', scope.branchId).eq('variantId', scope.variantId).eq('inStock', true))
    .take(maxActiveLots + 1));
  if (rows.length > maxActiveLots) expansionError('STOCK_LOT_LIMIT', 'Too many open lots for this item.');
  return rows;
}

export function allocationCounts(rows: Allocation[]) {
  const sums = new Map<Allocation['lotId'], number>();
  for (const { lotId, quantity } of rows) sums.set(lotId, (sums.get(lotId) ?? 0) + quantity);
  return sums;
}

export const maxBinPositions = 128;

export async function readBinPositions(ctx: QueryCtx, { branchId, variantId }: StockScope) {
  const positions = await expansionRead(ctx, () => ctx.db.query('stockBinPositions')
    .withIndex('by_branchId_and_variantId_and_binId_and_lotId', q => q.eq('branchId', branchId).eq('variantId', variantId))
    .take(maxBinPositions + 1));
  if (positions.length > maxBinPositions) expansionError('STOCK_BIN_LIMIT', 'This item has too many bin positions.');
  return positions;
}

export async function stockAvailability(ctx: QueryCtx, scope: StockScope, onHand: number, now = Date.now(), knownTracking?: boolean, knownBins?: Doc<'stockBinPositions'>[]) {
  const [config, reservations, bins] = await Promise.all([
    knownTracking ?? readsTracking(ctx, scope.variantId),
    activeReservations(ctx, scope, now),
    knownBins ?? readBinPositions(ctx, scope),
  ]);
  const held = reservations.reduce((sum, row) => sum + row.quantity, 0);
  const assigned = bins.reduce((sum, row) => sum + row.quantity, 0);
  const unassigned = bins.length ? onHand - assigned : null;
  if (!config) return { tracking: false, held, assigned, sellable: Math.max(0, (unassigned ?? onHand) - held), lots: [], reservations, unassigned };

  const positions = await physicalLots(ctx, scope);
  if (positions.reduce((sum, row) => sum + row.onHand, 0) !== onHand) {
    expansionError('STOCK_LOT_RECONCILIATION', 'The lot balances and branch stock differ. Review the stock ledger.');
  }
  const heldByLot = allocationCounts(reservations.flatMap(row => row.allocations));
  const assignedByLot = allocationCounts(bins.flatMap(row => row.lotId ? [{ lotId: row.lotId, quantity: row.quantity }] : []));
  const lots = positions.map(row => {
    const reserved = heldByLot.get(row.lotId) ?? 0;
    const assigned = assignedByLot.get(row.lotId) ?? 0;
    return { ...row, reserved, assigned, available: row.onHand - reserved - assigned };
  });
  if (lots.some(row => row.available < 0) ||
      lots.reduce((sum, row) => sum + row.onHand - row.available, 0) !== held + assigned) {
    expansionError('STOCK_LOT_RECONCILIATION', 'The lot balances and stock holds differ. Review the stock ledger.');
  }
  const sellable = lots.reduce((sum, row) => sum + (row.expiresAt > now ? row.available : 0), 0);
  return { tracking: true, held, assigned, sellable, lots, reservations, unassigned };
}

export async function readStockAvailability(ctx: QueryCtx, args: StockScope & { onHand: number; orderId?: Id<'orders'>; checkOrderHoldHistory?: boolean }) {
  const { sellable, held, tracking, reservations, lots, unassigned } = await stockAvailability(ctx, args, args.onHand);
  const reservation = args.orderId && reservations.find(row => row.orderId === args.orderId);
  const ownHeld = reservation ? reservation.quantity : 0;
  const { orderId } = args;
  const hadOrderHold = Boolean(orderId && args.checkOrderHoldHistory && !reservation && await expansionRead(ctx, () =>
    ctx.db.query('stockReservations').withIndex('by_orderId_and_branchId_and_variantId', q =>
      q.eq('orderId', orderId).eq('branchId', args.branchId).eq('variantId', args.variantId)).first()));
  return { unassigned, sellable: sellable + ownHeld, held: held - ownHeld, tracking, hadOrderHold,
    lots,
    reservationAllocations: reservation?.allocations, reservationExpiresAt: reservation?.expiresAt,
    reservationId: reservation ? reservation._id : undefined, reservationQuantity: reservation ? ownHeld : undefined };
}

export function allocateStockLots(
  lots: (Pick<Doc<'stockLotBalances'>, 'lotId' | 'expiresAt'> & { available: number })[],
  quantity: number,
  expiresAfter: number,
) {
  const selected: Allocation[] = [];
  let remaining = quantity;
  for (const lot of lots) {
    if (lot.expiresAt <= expiresAfter || lot.available <= 0) continue;
    const units = Math.min(remaining, lot.available);
    selected.push({ lotId: lot.lotId, quantity: units });
    remaining -= units;
    if (remaining === 0) return selected;
  }
  return expansionError('INSUFFICIENT_STOCK', 'There is insufficient sellable stock for this item.');
}
