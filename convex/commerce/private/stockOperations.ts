import type { PaginationOptions } from 'convex/server';
import { convexToJson, type Infer, type JSONValue, type Value } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { sha256 } from '../../shared/displayTokens';
import { stockOperationInputKind } from '../stockValidators';
import { normalizeStockFilter, readStockLevel, stockError, stockQuantity, stockRead, stockText } from './stockLedger';

export const STOCK_LINE_LIMIT = 50;
export type StockOperationInputKind = Infer<typeof stockOperationInputKind>;
export type StockLineInput = { variantId: Id<'productVariants'>; quantity: number };

export function stockPage(options: PaginationOptions) {
  stockQuantity(options.numItems, 'Page size', 1, 25);
  return { numItems: options.numItems, cursor: options.cursor, endCursor: options.endCursor,
    maximumRowsRead: options.numItems + 1, maximumBytesRead: 128 * 1024 };
}

function canonicalize(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

type KeyDocument = Doc<'stockOperationKeys'>;
export async function stockOperationKey(ctx: MutationCtx, actor: StaffActor, branchId: Id<'branches'>, action: string, key: string, payload: Value) {
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(key)) stockError('INVALID_STOCK_KEY', 'Use a valid operation key.');
  const fingerprint = await sha256(JSON.stringify(canonicalize(convexToJson(payload))));
  const scope = { branchId, actor: actor.tokenIdentifier, action, key };
  const previous = await stockRead(ctx, () => ctx.db.query('stockOperationKeys').withIndex('by_branch_actor_action_key', q =>
    q.eq('branchId', branchId).eq('actor', actor.tokenIdentifier).eq('action', action).eq('key', key)).unique());
  if (previous && previous.fingerprint !== fingerprint) stockError('STOCK_KEY_CONFLICT', 'This operation key was already used for different details.');
  return {
    previous,
    save: async (resultType: KeyDocument['resultType'], resultId: KeyDocument['resultId']) =>
      await ctx.db.insert('stockOperationKeys', { ...scope, fingerprint, resultId, resultType }),
  };
}

export async function previewStockOperation(
  ctx: QueryCtx, branchId: Id<'branches'>, kind: StockOperationInputKind, lines: StockLineInput[],
  reason: string | undefined, reasonCode: string | undefined,
) {
  const boundedReason = stockText(reason, 'Reason', 1000);
  const boundedCode = normalizeStockFilter(reasonCode, 60, 'Reason code');
  if (lines.length < 1 || lines.length > STOCK_LINE_LIMIT || new Set(lines.map(line => line.variantId)).size !== lines.length) {
    stockError('INVALID_STOCK_LINES', 'Choose 1–50 different stock items.');
  }
  if (kind === 'adjust') {
    const removeReasons = ['damaged', 'expired', 'lost', 'other'];
    const addReasons = ['found', 'other'];
    if (!boundedCode || lines.some(({ quantity }) => !(quantity < 0 ? removeReasons : addReasons).includes(boundedCode))) {
      stockError('INVALID_STOCK_ADJUSTMENT_REASON', 'Choose Found or Other when adding stock, or Damaged, Expired, Lost, or Other when removing it.');
    }
  }
  const preview = await Promise.all(lines.map(async ({ variantId, quantity }) => {
    stockQuantity(quantity, 'Quantity', kind === 'adjust' ? -Number.MAX_SAFE_INTEGER : kind === 'opening' ? 1 : 0);
    const [variant, balance] = await Promise.all([
      stockRead(ctx, () => ctx.db.get(variantId)), readStockLevel(ctx, branchId, variantId),
    ]);
    if (!variant) stockError('STOCK_VARIANT_NOT_FOUND', 'This stock item no longer exists.');
    if (kind === 'opening') {
      const productStatus = variant.productStatus ?? (await stockRead(ctx, () => ctx.db.get(variant.productId)))?.status;
      if (variant.status !== 'active' || productStatus !== 'active' || balance) {
        stockError('INVALID_OPENING_STOCK', 'Opening stock is only available for active items without a branch balance.');
      }
    }
    const before = balance?.onHand ?? 0;
    const delta = stockQuantity(kind === 'count' ? quantity - before : quantity, 'Movement quantity', -Number.MAX_SAFE_INTEGER);
    const after = stockQuantity(before + delta, 'Stock balance', -Number.MAX_SAFE_INTEGER);
    if (kind === 'adjust' && (!delta || (delta < 0 && after < 0))) {
      stockError('INVALID_STOCK_ADJUSTMENT', 'Enter a nonzero adjustment that keeps a stock decrease within the available balance.');
    }
    return { variantId, quantity, before, after, delta, revision: balance?.revision ?? 0, needsRecount: balance?.needsRecount ?? false };
  }));
  return { lines: preview, reason: boundedReason, reasonCode: boundedCode,
    requiresReason: (kind === 'adjust' && boundedCode === 'other') || (kind === 'count' && preview.some(line => line.delta !== 0)) };
}

export async function requireBranchMovement(ctx: QueryCtx, branchId: Id<'branches'>, movementId: Id<'stockMovements'>) {
  const movement = await stockRead(ctx, () => ctx.db.get(movementId));
  if (!movement || movement.branchId !== branchId) stockError('STOCK_MOVEMENT_NOT_FOUND', 'This movement was not found in the selected branch.');
  return movement;
}

export async function previewStockCorrection(ctx: QueryCtx, branchId: Id<'branches'>, movementId: Id<'stockMovements'>, quantity: number) {
  stockQuantity(quantity, 'Correction quantity', 1);
  const original = await requireBranchMovement(ctx, branchId, movementId);
  if (!['opening', 'adjust', 'write_off', 'return'].includes(original.kind) || !original.delta) {
    stockError('STOCK_CORRECTION_SOURCE', 'Open the stock movement’s original source to correct it.');
  }
  const [counter, balance] = await Promise.all([
    stockRead(ctx, () => ctx.db.query('stockCorrections').withIndex('by_original', q => q.eq('originalMovementId', movementId)).unique()),
    readStockLevel(ctx, branchId, original.variantId),
  ]);
  const available = Math.abs(original.delta) - (counter?.reversed ?? 0);
  if (quantity > available) stockError('STOCK_CORRECTION_LIMIT', 'The correction exceeds the quantity still eligible to reverse.');
  const before = balance?.onHand ?? 0;
  const delta = -Math.sign(original.delta) * quantity;
  const after = stockQuantity(before + delta, 'Stock balance', -Number.MAX_SAFE_INTEGER);
  return {
    original, counter, available, requiresReconciliation: delta < 0 && after < 0,
    line: { variantId: original.variantId, quantity, before, after, delta, revision: balance?.revision ?? 0,
      needsRecount: balance?.needsRecount ?? false },
  };
}

export function sameStockRevision(expected: number, actual: number) {
  if (expected !== actual) stockError('STALE_STOCK_BALANCE', 'Stock changed after your review. Reload the balance and review again.');
}
