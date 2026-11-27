import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { sha256 } from '../../shared/displayTokens';
import { prepareStockExpansionMovement } from './stockExpansionLedger';

export type StockMovementInput = {
  branchId: Id<'branches'>;
  variantId: Id<'productVariants'>;
  delta: number;
  kind: Doc<'stockMovements'>['kind'];
  sourceKey: string;
  actor: string;
  actorLabel?: string;
  reason?: string;
  reasonCode?: string;
  sourceRef?: string;
  sourceId?: string;
  originalMovementId?: Id<'stockMovements'>;
  allowNegative?: boolean;
  markRecount?: boolean;
  clearRecount?: boolean;
  createdAt?: number;
  lotAllocations?: { lotId: Id<'stockLots'>; quantity: number }[];
  lotReceipt?: { code: string; expiresAt: number };
  reservationId?: Id<'stockReservations'>;
};

export function stockError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function stockQuantity(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    stockError('INVALID_STOCK_QUANTITY', label + ' must be a whole number in range.');
  }
  return value;
}

export function stockText(value: string | undefined, label: string, max: number, required = false) {
  const trimmed = value?.trim();
  if ((trimmed?.length ?? 0) > max || (required && !trimmed)) {
    stockError('INVALID_STOCK_TEXT', label + (required ? ' is required and must contain at most ' : ' must contain at most ') + max + ' characters.');
  }
  return trimmed || undefined;
}

export async function stockRead<T>(ctx: QueryCtx, read: () => Promise<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const result = await read();
  if (Array.isArray(result)) {
    for (const row of result) budget.document(row);
  } else if (result !== null && result !== undefined) {
    budget.document(result);
  }
  budget.assert();
  return result;
}

export function readStockLevel(ctx: QueryCtx, branchId: Id<'branches'>, variantId: Id<'productVariants'>) {
  return stockRead(ctx, () => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q =>
    q.eq('variantId', variantId).eq('branchId', branchId)).unique());
}

export function normalizeStockFilter(value: string | undefined, max: number, label: string) {
  return stockText(value?.normalize('NFKC').toLowerCase(), label, max);
}

function humanStockActor(value: string | undefined) {
  const text = value?.trim();
  return text && text.length <= 400 && !text.includes('|') && !/^(https?:\/\/|user_[a-z0-9]+$|eyJ.*\.)/i.test(text) ? text : undefined;
}

export function stockActorLabel(actor: string, label?: string) {
  return humanStockActor(label) ?? humanStockActor(actor);
}

function sameLegacyMovement(row: Doc<'stockMovements'>, input: StockMovementInput) {
  const legacyKey = ((row.kind === 'sale' || row.kind === 'room_bill') && /^(sale|room_bill):/.test(row.sourceKey)) ||
    ((row.kind === 'return' || row.kind === 'write_off') && row.sourceKey.startsWith('return:')) ||
    ((row.kind === 'taken_back' || row.kind === 'write_off') && /^(adjustment|approval|approved|take_back|taken_back):/.test(row.sourceKey)) ||
    (['purchase_receipt', 'direct_receipt', 'correction', 'supplier_return'].includes(row.kind) && row.sourceKey.startsWith('purchasing:'));
  const sameEvidence = <T>(stored: T | undefined, supplied: T | undefined) =>
    stored === supplied || (legacyKey && stored === undefined);
  const sourceInKey = /^(sale|return|room_bill):([^:]+):/.exec(row.sourceKey)?.[2];
  return row.branchId === input.branchId && row.variantId === input.variantId && row.delta === input.delta &&
    row.kind === input.kind && row.actor === input.actor && row.reason === input.reason &&
    sameEvidence(row.actorLabel, input.actorLabel) &&
    sameEvidence(normalizeStockFilter(row.reasonCode, 60, 'Reason code'), normalizeStockFilter(input.reasonCode, 60, 'Reason code')) &&
    sameEvidence(row.sourceRef, input.sourceRef) && sameEvidence(row.sourceId, input.sourceId) &&
    (!sourceInKey || input.sourceId === undefined || input.sourceId === sourceInKey) &&
    sameEvidence(row.originalMovementId, input.originalMovementId) &&
    input.lotAllocations === undefined && input.lotReceipt === undefined && input.reservationId === undefined;
}

async function movementFingerprint(input: StockMovementInput) {
  return sha256(JSON.stringify([
    input.branchId, input.variantId, input.delta, input.kind, input.actor, input.actorLabel,
    input.reason, input.reasonCode, input.sourceRef, input.sourceId, input.originalMovementId,
    !!input.allowNegative, !!input.markRecount, !!input.clearRecount,
    input.lotReceipt && [input.lotReceipt.code, input.lotReceipt.expiresAt],
    input.lotAllocations?.map(({ lotId, quantity }) => [lotId, quantity]), input.reservationId,
  ]));
}

/** Apply one ledger line and its balance atomically. Callers authorize source and branch before writing. */
export async function writeStockMovement(ctx: MutationCtx, input: StockMovementInput, knownStock?: Doc<'stockLevels'> | null) {
  const { delta, sourceKey } = input;
  stockQuantity(delta, 'Movement quantity', -Number.MAX_SAFE_INTEGER);
  stockText(sourceKey, 'Movement source', 400, true);
  const fingerprint = await movementFingerprint(input);
  const previous = await stockRead(ctx, () => ctx.db.query('stockMovements')
    .withIndex('by_sourceKey', q => q.eq('sourceKey', sourceKey)).unique());
  if (previous) {
    if (previous.fingerprint ? previous.fingerprint !== fingerprint : !sameLegacyMovement(previous, input)) {
      stockError('STOCK_KEY_CONFLICT', 'This movement key was already used for a different action.');
    }
    return { movementId: previous._id, before: previous.before, after: previous.after };
  }

  return applyStockMovement(ctx, input, fingerprint, knownStock);
}

/** The receipt command deduplicates retries before inserting new receipt lines. */
export async function writeNewReceiptMovement(ctx: MutationCtx, lineId: Id<'supplierReceiptLines'>, movement: Omit<StockMovementInput, 'sourceKey'>) {
  const input = { ...movement, sourceKey: `purchasing:receipt:${lineId}` };
  stockQuantity(input.delta, 'Received quantity', 1);
  return applyStockMovement(ctx, input, await movementFingerprint(input));
}

async function applyStockMovement(ctx: MutationCtx, input: StockMovementInput, fingerprint: string, knownStock?: Doc<'stockLevels'> | null) {
  const { branchId, variantId, delta, kind, sourceKey, actor } = input;
  if (knownStock && (knownStock.branchId !== branchId || knownStock.variantId !== variantId)) {
    stockError('STOCK_SOURCE_MISMATCH', 'The prepared stock belongs to a different branch or item.');
  }
  // A caller may reuse a balance it read in this same mutation, provided it has not written that row since.
  const [variant, stock] = await Promise.all([
    stockRead(ctx, () => ctx.db.get(variantId)),
    knownStock === undefined ? readStockLevel(ctx, branchId, variantId) : knownStock,
  ]);
  if (!variant) stockError('STOCK_VARIANT_NOT_FOUND', 'This stock item no longer exists.');
  const { productId } = variant;
  const before = stock?.onHand ?? 0;
  const after = stockQuantity(before + delta, 'Stock balance', -Number.MAX_SAFE_INTEGER);
  // Positive receipts can improve an existing discrepancy without making it worse.
  if (delta < 0 && after < 0 && !input.allowNegative) {
    stockError('STOCK_SHORTAGE', 'This action would make stock negative.');
  }
  if (input.clearRecount && (kind !== 'count' || after < 0)) {
    stockError('INVALID_RECOUNT', 'Only a verified count can clear Needs recount.');
  }
  const finalizeExpansion = await prepareStockExpansionMovement(ctx, input, before, after);
  const needsRecount = input.clearRecount ? false : input.markRecount || after < 0 || stock?.needsRecount;
  if (delta || input.clearRecount || input.markRecount || !stock) {
    const patch = { onHand: after, revision: (stock?.revision ?? 0) + 1, needsRecount };
    reserveWrites(ctx, 1);
    if (stock) await ctx.db.patch(stock._id, patch);
    else await ctx.db.insert('stockLevels', { branchId, variantId, productId, ...patch });
  }

  const actorLabel = stockActorLabel(actor, input.actorLabel);
  reserveWrites(ctx, 1);
  const movementId = await ctx.db.insert('stockMovements', {
    branchId, variantId, delta, kind, sourceKey, actor, before, after, fingerprint,
    createdAt: input.createdAt ?? Date.now(),
    actorLabel, actorSearch: normalizeStockFilter(actorLabel, 400, 'Staff member'),
    reason: input.reason, reasonCode: normalizeStockFilter(input.reasonCode, 60, 'Reason code'),
    sourceRef: input.sourceRef, sourceId: input.sourceId, originalMovementId: input.originalMovementId,
    itemLabel: variant.productName ? `${variant.productName} · ${variant.label}` : undefined, sku: variant.sku,
  });
  await finalizeExpansion?.(movementId);
  return { movementId, before, after };
}
