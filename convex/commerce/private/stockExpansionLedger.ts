import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { reserveWrites } from '../../lib/readBudget';
import {
  allocateStockLots, allocationCounts, expansionError, expansionRead, maxActiveLots, readsTracking, stockAvailability, stockText, stockUnits,
  type Allocation, type StockScope,
} from './stockAvailability';
import type { StockMovementInput } from './stockLedger';

export function readLotMovement(ctx: QueryCtx, movementId: Id<'stockMovements'>) {
  return expansionRead(ctx, () => ctx.db.query('stockLotMovements').withIndex('by_movementId', q => q.eq('movementId', movementId)).unique());
}

function nonSellableMovement(kind: StockMovementInput['kind']) {
  return ['supplier_return', 'correction', 'write_off', 'lot_adjustment', 'count'].includes(kind);
}

export const legacyUnattributedLotCode = 'Pre-tracking stock (verify lot)';

async function receiptLot(ctx: MutationCtx, args: StockMovementInput, legacy = false): Promise<Id<'stockLots'>> {
  const evidence = args.lotReceipt;
  if (!evidence) expansionError('STOCK_LOT_REQUIRED', 'Choose a lot code and expiry for received units.');
  const code = stockText(evidence.code, 80, 'a lot code');
  if (!legacy && code === legacyUnattributedLotCode) expansionError('INVALID_STOCK_LOT', 'Enter the lot code printed on the stock.');
  const expiresAt = evidence.expiresAt;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    expansionError('INVALID_LOT_EXPIRY', 'Enter a valid lot expiry timestamp.');
  }
  const existing = await expansionRead(ctx, () => ctx.db.query('stockLots')
    .withIndex('by_variantId_and_code', q => q.eq('variantId', args.variantId).eq('code', code)).unique());
  if (existing && existing.expiresAt !== expiresAt) {
    expansionError('LOT_EXPIRY_CONFLICT', 'This lot code already has a different expiry.');
  }
  if (existing) return existing._id;
  reserveWrites(ctx, 1);
  const lotId = await ctx.db.insert('stockLots', { variantId: args.variantId, code, expiresAt });
  if (expiresAt > Date.now()) {
    await ctx.scheduler.runAt(expiresAt, internal.commerce.stockExpansion.notifyLotExpiry, { lotId });
  }
  return lotId;
}

function isSaleSource(kind: StockMovementInput['kind']) {
  return kind === 'sale' || kind === 'room_bill';
}

function isPhysicalReturn(kind: StockMovementInput['kind']) {
  return kind === 'return' || kind === 'taken_back';
}

function remainingAllocations(original: NonNullable<Awaited<ReturnType<typeof readLotMovement>>>) {
  const reversed = allocationCounts(original.reversed ?? []);
  return original.allocations
    .map(line => ({ lotId: line.lotId, quantity: line.quantity - (reversed.get(line.lotId) ?? 0) }))
    .filter(line => line.quantity > 0);
}

export async function readStockReturnLots(ctx: QueryCtx, args: StockScope & {
  originalMovementId: Id<'stockMovements'>;
  originalMovement?: Doc<'stockMovements'>;
}) {
  const original = args.originalMovement?._id === args.originalMovementId
    ? args.originalMovement
    : await expansionRead(ctx, () => ctx.db.get(args.originalMovementId));
  if (!original || original.branchId !== args.branchId || original.variantId !== args.variantId || !isSaleSource(original.kind)) {
    return { tracked: false, lots: [] };
  }
  const evidence = await readLotMovement(ctx, original._id);
  if (!evidence) {
    const config = await readsTracking(ctx, args.variantId);
    return { tracked: !!config && !predatesConversion(config, original), lots: [] };
  }
  const lots = await Promise.all(remainingAllocations(evidence).map(async allocation => {
    const lot = await expansionRead(ctx, () => ctx.db.get(allocation.lotId));
    if (!lot) expansionError('STOCK_LOT_RECONCILIATION', 'A lot in this sale is missing. Review the stock ledger.');
    return { ...allocation, code: lot.code, expiresAt: lot.expiresAt };
  }));
  return { tracked: true, lots };
}

function predatesConversion(config: Doc<'stockTracking'> | null, movement: Doc<'stockMovements'>) {
  return config?.convertedAt !== undefined && movement._creationTime <= config._creationTime;
}

async function legacyMovementAllocations(ctx: MutationCtx, args: StockMovementInput, availability: Awaited<ReturnType<typeof stockAvailability>>) {
  if (!args.originalMovementId) return undefined;
  const [config, movement] = await Promise.all([
    readsTracking(ctx, args.variantId), expansionRead(ctx, () => ctx.db.get(args.originalMovementId!)),
  ]);
  if (!movement || !predatesConversion(config, movement) || movement.variantId !== args.variantId ||
      await readLotMovement(ctx, movement._id)) return undefined;
  const legacyTransfer = args.kind === 'transfer_in' && movement.kind === 'transfer_out' &&
    args.sourceId !== undefined && args.sourceId === movement.sourceId;
  const legacyReturn = isPhysicalReturn(args.kind) && isSaleSource(movement.kind) && movement.branchId === args.branchId;
  const legacySupplierReversal = args.kind === 'correction' && movement.kind === 'supplier_return' &&
    movement.delta < 0 && movement.branchId === args.branchId && args.sourceId !== undefined &&
    args.sourceId === movement.sourceId && args.delta <= -movement.delta;
  if (args.lotAllocations?.length) {
    if (args.delta <= 0 || !legacySupplierReversal) return undefined;
    if (args.lotAllocations.length > maxActiveLots) expansionError('INVALID_LOT_ALLOCATION', 'Too many verified lots.');
    const verifiedPositions = await Promise.all(args.lotAllocations.map(({ lotId }) => expansionRead(ctx, () => ctx.db.query('stockLotBalances')
      .withIndex('by_branchId_and_lotId', q => q.eq('branchId', args.branchId).eq('lotId', lotId)).unique())));
    if (verifiedPositions.some(position => position?.variantId !== args.variantId)) {
      expansionError('INVALID_STOCK_LOT', 'Choose a verified lot for this item at this branch.');
    }
    return args.lotAllocations;
  }
  if (args.delta < 0 && movement.branchId === args.branchId && movement.delta > 0 &&
      ['correction', 'supplier_return'].includes(args.kind)) {
    return allocateStockLots(availability.lots, -args.delta, 0);
  }
  if (args.delta <= 0 || (!legacyTransfer && !legacyReturn && !legacySupplierReversal)) return undefined;
  // Pre-conversion movements have no physical lot evidence. A dedicated expired position
  // keeps the original return valid and the units out of sales until staff identify the lot.
  const lotId = await receiptLot(ctx, { ...args, lotReceipt: { code: legacyUnattributedLotCode, expiresAt: 1 } }, true);
  return [{ lotId, quantity: args.delta }];
}

async function findOriginal(ctx: MutationCtx, args: StockMovementInput) {
  const movementId = args.originalMovementId;
  if (!movementId) expansionError('STOCK_LOT_SOURCE_REQUIRED', 'Choose the original movement to trace these units.');
  const [movement, lotMovement] = await Promise.all([expansionRead(ctx, () => ctx.db.get(movementId)), readLotMovement(ctx, movementId)]);
  if (!movement || !lotMovement || movement.branchId !== args.branchId || movement.variantId !== args.variantId ||
      Math.sign(movement.delta) === Math.sign(args.delta) || isPhysicalReturn(args.kind) && !isSaleSource(movement.kind)) {
    expansionError('INVALID_STOCK_LOT_SOURCE', 'The source movement does not match this branch, product, or operation.');
  }
  return lotMovement;
}

function reverseOriginal(original: NonNullable<Awaited<ReturnType<typeof readLotMovement>>>, args: StockMovementInput) {
  const quantity = Math.abs(args.delta);
  const available = remainingAllocations(original);
  const total = available.reduce((sum, line) => sum + line.quantity, 0);
  if (total < quantity) expansionError('STOCK_LOT_SOURCE_EXHAUSTED', 'The source movement has fewer eligible units remaining.');
  const selected = args.lotAllocations;
  if (!selected && isPhysicalReturn(args.kind) && available.length > 1 && total !== quantity) {
    expansionError('STOCK_RETURN_LOT_REQUIRED', 'Confirm the lot code and quantity on the returned items.');
  }
  const availableByLot = allocationCounts(available);
  const seen = new Set<Allocation['lotId']>();
  let remaining = quantity;
  const allocations: Allocation[] = [];
  for (const line of selected ?? available) {
    const eligible = availableByLot.get(line.lotId) ?? 0;
    const units = selected ? stockUnits(line.quantity) : Math.min(eligible, remaining);
    if (seen.has(line.lotId) || units > eligible || units > remaining) {
      expansionError('INVALID_LOT_ALLOCATION', 'The returned lot, quantity, or combination exceeds the original stock movement.');
    }
    seen.add(line.lotId);
    allocations.push({ lotId: line.lotId, quantity: units });
    remaining -= units;
    if (!selected && remaining === 0) break;
  }
  if (remaining !== 0) expansionError('INVALID_LOT_ALLOCATION', 'The confirmed lot quantities must match the movement.');
  const reversed = allocationCounts([...(original.reversed ?? []), ...allocations]);
  return { allocations, reversed: Array.from(reversed, ([lotId, quantity]) => ({ lotId, quantity })) };
}

async function applyLots(
  ctx: MutationCtx, args: StockMovementInput, availability: Awaited<ReturnType<typeof stockAvailability>>, allocations: Allocation[],
) {
  const quantities = allocationCounts(allocations);
  if (allocations.length > maxActiveLots || quantities.size !== allocations.length ||
      allocations.reduce((sum, line) => sum + stockUnits(line.quantity), 0) !== Math.abs(args.delta)) {
    expansionError('INVALID_LOT_ALLOCATION', 'Lot quantities must match the movement and list each lot once.');
  }
  const positions = new Map(availability.lots.map(row => [row.lotId, row]));
  let activeLots = availability.lots.length;
  for (const { lotId, quantity } of allocations) {
    const current = positions.get(lotId);
    if (args.delta < 0 && (!current || current.available < quantity && !args.reservationId)) {
      expansionError('INSUFFICIENT_STOCK', 'There are insufficient unheld units in the selected lot.');
    }
    if (args.delta < 0 && !nonSellableMovement(args.kind) && (!current || current.expiresAt <= Date.now())) {
      expansionError('EXPIRED_STOCK', 'The selected lot has expired.');
    }
    const onHand = (current?.onHand ?? 0) + Math.sign(args.delta) * quantity;
    if (onHand < 0) expansionError('INSUFFICIENT_STOCK', 'There are insufficient units in the selected lot.');
    reserveWrites(ctx, 1);
    if (current) {
      await ctx.db.patch(current._id, { onHand, inStock: onHand > 0, revision: (current.revision ?? 0) + 1 });
      if (onHand === 0) activeLots--;
      continue;
    }
    if (++activeLots > maxActiveLots) expansionError('STOCK_LOT_LIMIT', 'The item has too many open lots at this branch.');
    const [lot, position] = await Promise.all([
      expansionRead(ctx, () => ctx.db.get(lotId)),
      expansionRead(ctx, () => ctx.db.query('stockLotBalances')
        .withIndex('by_branchId_and_lotId', q => q.eq('branchId', args.branchId).eq('lotId', lotId)).unique()),
    ]);
    if (!lot || lot.variantId !== args.variantId) expansionError('INVALID_STOCK_LOT', 'This lot belongs to a different item.');
    if (position) await ctx.db.patch(position._id, { onHand, inStock: true, revision: (position.revision ?? 0) + 1 });
    else await ctx.db.insert('stockLotBalances', {
      branchId: args.branchId, variantId: args.variantId, lotId, expiresAt: lot.expiresAt, onHand, inStock: true, revision: 1,
    });
  }
}

function holdsToInvalidate(
  availability: Awaited<ReturnType<typeof stockAvailability>>, after: number, allocations?: Allocation[],
) {
  let short = availability.held - after;
  const affected = new Map<Allocation['lotId'], number>();
  const lots = new Map(availability.lots.map(lot => [lot.lotId, lot]));
  for (const line of allocations ?? []) {
    const available = lots.get(line.lotId)?.available ?? 0;
    if (line.quantity > available) affected.set(line.lotId, line.quantity - available);
  }
  return [...availability.reservations].sort((a, b) => b._creationTime - a._creationTime).filter(row => {
    if (short <= 0 && !row.allocations.some(line => (affected.get(line.lotId) ?? 0) > 0)) return false;
    if (availability.tracking && !row.allocations.some(line => (affected.get(line.lotId) ?? 0) > 0)) return false;
    short -= row.quantity;
    for (const line of row.allocations) affected.set(line.lotId, (affected.get(line.lotId) ?? 0) - line.quantity);
    return true;
  });
}

export async function prepareStockExpansionMovement(ctx: MutationCtx, args: StockMovementInput, before: number, after: number, knownBins?: Doc<'stockBinPositions'>[]) {
  const now = Date.now();
  // Increases to untracked stock cannot take units away from any order's hold.
  let tracking: boolean | undefined;
  if (args.delta > 0 && !args.reservationId) {
    tracking = Boolean(await readsTracking(ctx, args.variantId));
    if (!tracking) {
      if (args.lotReceipt || args.lotAllocations?.length) {
        expansionError('STOCK_LOT_TRACKING_REQUIRED', 'Enable lot tracking before adding lot evidence.');
      }
      return undefined;
    }
  }
  // Stock increases land in Unassigned and leave all named positions and holds intact.
  const availability = await stockAvailability(ctx, args, before, now, tracking, args.delta > 0 ? [] : knownBins);
  const reservation = args.reservationId
    ? availability.reservations.find(row => row._id === args.reservationId)
    : undefined;
  if (args.reservationId && (!reservation || reservation.quantity !== -args.delta || args.kind !== 'sale' ||
      reservation.orderId && args.sourceId !== reservation.orderId)) {
    expansionError('INVALID_STOCK_RESERVATION', 'This hold does not match the sale, or has expired.');
  }
  const verifiedCount = args.kind === 'count' && (args.clearRecount || args.reasonCode === 'verified_lot_count');
  const availableAfter = availability.unassigned === null ? after : availability.unassigned + args.delta;
  const invalidated = verifiedCount && args.delta < 0 ? holdsToInvalidate(availability, availableAfter, args.lotAllocations) : [];
  const invalidatedQuantity = invalidated.reduce((sum, row) => sum + row.quantity, 0);
  if (availability.held > 0 && args.delta <= 0 && availableAfter < availability.held - (reservation?.quantity ?? 0) - invalidatedQuantity) {
    expansionError('STOCK_RESERVED', 'Some of these units are held for another order.');
  }

  let allocations: Allocation[] | undefined;
  let originalUpdate: { id: Id<'stockLotMovements'>; reversed: Allocation[] } | undefined;
  if (availability.tracking) {
    if (args.delta !== 0) {
      const legacyAllocations = await legacyMovementAllocations(ctx, args, availability);
      if (legacyAllocations) {
        allocations = legacyAllocations;
      } else if (args.originalMovementId || ['return', 'taken_back', 'correction', 'supplier_return'].includes(args.kind)) {
        const original = await findOriginal(ctx, args);
        const reversal = reverseOriginal(original, args);
        allocations = reversal.allocations;
        originalUpdate = { id: original._id, reversed: reversal.reversed };
      } else if (reservation) {
        allocations = reservation.allocations;
      } else if (args.lotAllocations) {
        allocations = args.lotAllocations;
      } else if (args.delta > 0) {
        allocations = [{ lotId: await receiptLot(ctx, args), quantity: args.delta }];
      } else if (args.kind === 'lot_adjustment' || args.kind === 'write_off' || args.kind === 'adjust' || args.kind === 'count') {
        return expansionError('STOCK_LOT_REQUIRED', 'Choose the affected lot when adjusting tracked stock.');
      } else {
        allocations = allocateStockLots(availability.lots, -args.delta, now);
      }
      const releasedByLot = allocationCounts(invalidated.flatMap(row => row.allocations));
      const adjusted = releasedByLot.size
        ? { ...availability, lots: availability.lots.map(lot => ({ ...lot, available: lot.available + (releasedByLot.get(lot.lotId) ?? 0) })) }
        : availability;
      await applyLots(ctx, args, adjusted, allocations);
    }
  } else if (args.lotReceipt || args.lotAllocations?.length) {
    expansionError('STOCK_LOT_TRACKING_REQUIRED', 'Enable lot tracking before adding lot evidence.');
  }
  if (!allocations && !reservation && !invalidated.length) return undefined;
  return async (movementId: Id<'stockMovements'>) => {
    reserveWrites(ctx, Number(Boolean(allocations)) + Number(Boolean(originalUpdate)) + Number(Boolean(reservation)) + invalidated.length);
    if (allocations) await ctx.db.insert('stockLotMovements', { movementId, allocations, originalMovementId: args.originalMovementId });
    if (originalUpdate) await ctx.db.patch(originalUpdate.id, { reversed: originalUpdate.reversed });
    if (reservation) await ctx.db.patch(reservation._id, { state: 'consumed', closedAt: now, closedBy: args.actor, movementId });
    for (const row of invalidated) {
      await ctx.db.patch(row._id, { state: 'released', closedAt: now, closedBy: args.actor, movementId, closedReason: 'verified_count' });
    }
  };
}

export async function invalidateLotExpiry(ctx: MutationCtx, lotId: Id<'stockLots'>) {
  const lot = await ctx.db.get(lotId);
  if (!lot || lot.expiresAt > Date.now()) return;
  const config = await readsTracking(ctx, lot.variantId);
  // Availability also checks current time. This write updates existing subscriptions at the deadline.
  if (config && (config.lastExpiryAt ?? 0) < lot.expiresAt) {
    await ctx.db.patch(config._id, { lastExpiryAt: lot.expiresAt });
  }
}
