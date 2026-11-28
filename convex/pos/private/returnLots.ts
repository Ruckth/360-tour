import { ConvexError, type Infer } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readStockReturnLots } from '../../commerce/model';
import type { returnLotAllocation } from '../validators';

export const MAX_RETURN_LOTS = 100;
export type LotAllocation = Infer<typeof returnLotAllocation>;
export type ReturnLot = Awaited<ReturnType<typeof readStockReturnLots>>['lots'][number];

function lotError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function readReturnMovementLots(ctx: QueryCtx, movement: Doc<'stockMovements'>) {
  return readStockReturnLots(ctx, {
    branchId: movement.branchId, variantId: movement.variantId, originalMovementId: movement._id, originalMovement: movement,
  });
}

export type ReturnLotState = { lot: ReturnLot; remaining: number };

export function selectReturnLots(units: number, requested: LotAllocation[] | undefined, remaining: Map<LotAllocation['lotId'], ReturnLotState>): ReturnLot[] {
  const available = [...remaining.values()].filter(item => item.remaining > 0);
  const total = available.reduce((sum, item) => sum + item.remaining, 0);
  if (units > total) lotError('RETURN_INVALID_LOTS', 'The original lots have fewer eligible units remaining.');
  if (!requested && available.length > 1 && units < total) {
    lotError('RETURN_SELECT_LOTS', 'Confirm the lot codes and quantities on the returned items.');
  }
  const allocations = requested ?? available.map(({ lot, remaining }) => ({ lotId: lot.lotId, quantity: Math.min(remaining, units) }));
  const seen = new Set<LotAllocation['lotId']>();
  const selected: ReturnLot[] = [];
  let selectedUnits = 0;
  if (allocations.length > available.length) lotError('RETURN_INVALID_LOTS', 'Choose lots from the original sale.');
  for (const { lotId, quantity } of allocations) {
    const source = remaining.get(lotId);
    if (!source || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > source.remaining || seen.has(lotId)) {
      lotError('RETURN_INVALID_LOTS', 'A selected lot or quantity exceeds the original stock movement.');
    }
    seen.add(lotId);
    selectedUnits += quantity;
    source.remaining -= quantity;
    selected.push({ ...source.lot, quantity });
  }
  if (selectedUnits !== units) lotError('RETURN_INVALID_LOTS', 'The lot quantities must match the returned quantity.');
  return selected;
}

export function remainingReturnLots(lots: ReturnLot[]) {
  return new Map(lots.map(lot => [lot.lotId, { lot, remaining: lot.quantity }]));
}

/** Intersect this physical part's unused slices with the original movement's remaining lots. */
export function packedReturnLots(
  lots: ReturnLot[], packed: LotAllocation[], returned: LotAllocation[] = [],
) {
  const used = new Map(returned.map(lot => [lot.lotId, lot.quantity]));
  const limits = new Map(packed.map(lot => [lot.lotId, lot.quantity - (used.get(lot.lotId) ?? 0)]));
  return lots.flatMap(lot => {
    const quantity = Math.min(lot.quantity, limits.get(lot.lotId) ?? 0);
    return quantity > 0 ? [{ ...lot, quantity }] : [];
  });
}
