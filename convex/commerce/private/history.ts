import type { PaginationOptions, PaginationResult, Query } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { DataModel, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readBudget } from '../../lib/readBudget';
import type { AdjustmentTarget } from './adjustments';
import { guestHistoryFact, type HistoryEntryView, type HistoryFact } from './historyView';

type BenefitTarget = Extract<AdjustmentTarget, { targetType: 'voucher' | 'grant' }>;
type HistoryTable = 'commerceAdjustments' | 'sessionUses' | 'stockMovements' | 'voucherEntries';
export type CommerceHistoryRow = Doc<HistoryTable>;
export type GuestHistoryRow = {
  entryId: string;
  recordedAt: number;
  fact: HistoryFact;
  kind: Doc<'voucherEntries' | 'sessionUses'>['kind'];
  before: Doc<'voucherEntries'>['before'];
  after: Doc<'voucherEntries'>['after'];
};

/** A History page's response stays ≤ 160 KiB (v27). */
export const MAX_PAGE_BYTES = 160 * 1024;
/**
 * Reading stops once a page has read this much, and Convex ends the page at that row: continueCursor
 * follows it, and a reactive client splits it with splitCursor. The crossing row (the adjustment
 * helper keeps ledger rows ≤ 8 KiB), each row's response framing and masked codes in guest facts
 * (a masked code is 8 bytes longer) still fit in MAX_PAGE_BYTES.
 */
const PAGE_READ_BYTES = 96 * 1024;
const encoder = new TextEncoder();

function checkPageSize({ numItems }: PaginationOptions) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 20) {
    throw new ConvexError({ code: 'INVALID_PAGE_SIZE', message: 'History page size must be 1–20.' });
  }
}

/** Call with the page exactly as the endpoint returns it. */
export function assertPageBytes<T>(result: PaginationResult<T>): PaginationResult<T> {
  if (encoder.encode(JSON.stringify(result)).length > MAX_PAGE_BYTES) {
    throw new ConvexError({ code: 'HISTORY_PAGE_TOO_LARGE', message: 'This history page exceeds 160 KiB.' });
  }
  return result;
}

async function readPage<Table extends HistoryTable>(
  ctx: QueryCtx,
  query: Query<DataModel[Table]>,
  { numItems, cursor, endCursor }: PaginationOptions,
): Promise<PaginationResult<Doc<Table>>> {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const result = await query.order('desc').paginate({
    numItems, cursor, endCursor, maximumRowsRead: numItems + 1, maximumBytesRead: PAGE_READ_BYTES,
  });
  for (const row of result.page) budget.document(row);
  budget.assert();
  return result;
}

function grantHistory(ctx: QueryCtx, target: Extract<BenefitTarget, { targetType: 'grant' }>, from?: number) {
  return ctx.db.query('sessionUses').withIndex('by_grantId_and_createdAt', q => {
    const range = q.eq('grantId', target.targetId);
    return from === undefined ? range : range.gte('createdAt', from);
  });
}

function voucherHistory(ctx: QueryCtx, target: Extract<BenefitTarget, { targetType: 'voucher' }>, from?: number) {
  return ctx.db.query('voucherEntries').withIndex('by_voucherId_and_createdAt', q => {
    const range = q.eq('voucherId', target.targetId);
    return from === undefined ? range : range.gte('createdAt', from);
  });
}

/** Call after authorizing the target. Balance history is read from the owning ledger. */
export async function listCommerceHistory(
  ctx: QueryCtx, target: AdjustmentTarget, pagination: PaginationOptions,
): Promise<PaginationResult<CommerceHistoryRow>> {
  checkPageSize(pagination);
  switch (target.targetType) {
    case 'grant': return await readPage<'sessionUses'>(ctx, grantHistory(ctx, target), pagination);
    case 'voucher': return await readPage<'voucherEntries'>(ctx, voucherHistory(ctx, target), pagination);
    case 'stock': {
      const budget = readBudget(ctx);
      budget.range();
      budget.assert();
      const stock = await ctx.db.get(target.targetId);
      if (!stock) return { page: [], isDone: true, continueCursor: '' };
      budget.document(stock);
      return await readPage<'stockMovements'>(ctx, ctx.db.query('stockMovements')
        .withIndex('by_variantId_and_branchId_and_createdAt', q => q.eq('variantId', stock.variantId).eq('branchId', stock.branchId)), pagination);
    }
    default: return await readPage<'commerceAdjustments'>(ctx, ctx.db.query('commerceAdjustments')
      .withIndex('by_targetType_and_targetId_and_recordedAt', q =>
        q.eq('targetType', target.targetType).eq('targetId', target.targetId)), pagination);
  }
}

const transferPrefix = (target: BenefitTarget) => `guest-transfer:${target.targetId}:`;

/** Use as the source key of every transfer-in ledger entry in the ownership mutation. */
export function transferHistorySourceKey(target: BenefitTarget, revisionAfter: number): string {
  if (!Number.isSafeInteger(revisionAfter) || revisionAfter < 1) throw new Error('Invalid transfer revision');
  return transferPrefix(target) + String(revisionAfter).padStart(16, '0');
}

async function latestTransfer(ctx: QueryCtx, target: BenefitTarget) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const prefix = transferPrefix(target);
  const upper = `${prefix}\uffff`;
  const row = target.targetType === 'grant'
    ? await ctx.db.query('sessionUses').withIndex('by_sourceKey', q => q.gte('sourceKey', prefix).lt('sourceKey', upper)).order('desc').first()
    : await ctx.db.query('voucherEntries').withIndex('by_sourceKey', q => q.gte('sourceKey', prefix).lt('sourceKey', upper)).order('desc').first();
  if (row) budget.document(row);
  budget.assert();
  if (row && ('grantId' in row
    ? row.grantId !== target.targetId || row.kind !== 'transfer'
    : row.voucherId !== target.targetId || (row.kind !== 'edit' && row.kind !== 'transfer'))) {
    throw new Error('Invalid transfer history boundary');
  }
  return row;
}

/** Call after authorizing the target. The cursor is only usable for this ownership period. */
export async function listGuestCommerceHistory(
  ctx: QueryCtx, target: BenefitTarget, pagination: PaginationOptions,
): Promise<PaginationResult<GuestHistoryRow>> {
  checkPageSize(pagination);
  const transfer = await latestTransfer(ctx, target);
  let grantOwner: Doc<'sessionGrants'>['ownerId'] | undefined;
  if (target.targetType === 'grant') {
    const budget = readBudget(ctx);
    budget.range();
    budget.assert();
    const grant = await ctx.db.get(target.targetId);
    if (!grant) return { page: [], isDone: true, continueCursor: '' };
    budget.document(grant);
    budget.assert();
    grantOwner = grant.ownerId;
  }
  const cursorPrefix = `${target.targetId}:${transfer?._id ?? 'issued'}:`;
  const unwrapCursor = (cursor: string) => {
    if (!cursor.startsWith(cursorPrefix)) {
      throw new ConvexError({ code: 'STALE_HISTORY_CURSOR', message: 'History has changed. Reopen the first page.' });
    }
    return cursor.slice(cursorPrefix.length);
  };
  const options = {
    ...pagination,
    cursor: pagination.cursor === null ? null : unwrapCursor(pagination.cursor),
    endCursor: pagination.endCursor == null ? pagination.endCursor : unwrapCursor(pagination.endCursor),
  };
  const result = target.targetType === 'grant'
    ? await readPage<'sessionUses'>(ctx, grantHistory(ctx, target, transfer?.createdAt), options)
    : await readPage<'voucherEntries'>(ctx, voucherHistory(ctx, target, transfer?.createdAt), options);
  // A preceding entry can share the transfer's recorded timestamp. Apply the index tie-breaker too.
  const visible = transfer ? result.page.filter(row => row.createdAt > transfer.createdAt ||
    (row.createdAt === transfer.createdAt && (row._creationTime > transfer._creationTime || row._id === transfer._id))) : result.page;
  return {
    ...result,
    page: visible.filter(row => !('beneficiaryId' in row && row.beneficiaryId && row.beneficiaryId !== grantOwner)).map(row => ({
      entryId: row._id,
      recordedAt: row.createdAt,
      fact: guestHistoryFact(row, row._id === transfer?._id),
      kind: row._id === transfer?._id ? 'transfer' : row.kind,
      before: row.before,
      after: row.after,
    })),
    isDone: result.isDone || visible.length < result.page.length,
    continueCursor: cursorPrefix + result.continueCursor,
    ...(result.splitCursor ? { splitCursor: cursorPrefix + result.splitCursor } : {}),
  };
}

/** Name reads per staff page: with ≤ 20 rows and staff access a page stays ≤ 41 documents. */
export const MAX_PART_NAME_READS = 20;
type Part = Record<string, unknown>;
const isPart = (value: unknown): value is Part => value !== null && typeof value === 'object' && !Array.isArray(value);
const partsOf = (fields: HistoryEntryView['before']): Part[] =>
  Object.values(fields ?? {}).flatMap(value => Array.isArray(value) ? (value as unknown[]).filter(isPart) : []);
const strings = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string')
  : typeof value === 'string' ? [value] : [];

/**
 * Staff History names what a changed package part counts (its services, variant or product), so a
 * same-key swap reads "Traditional Thai Massage → Aromatherapy Massage". Names are read once per page,
 * de-duplicated and capped; a record that is gone (or past the cap) keeps the part's stored label.
 */
export async function nameHistoryParts(ctx: QueryCtx, entries: HistoryEntryView[]): Promise<HistoryEntryView[]> {
  const parts = entries.flatMap(entry => [...partsOf(entry.before), ...partsOf(entry.after)]);
  const wanted = new Map<string, 'services' | 'productVariants' | 'products'>();
  for (const part of parts) {
    for (const id of strings(part.serviceIds)) wanted.set(id, 'services');
    for (const id of strings(part.variantId)) wanted.set(id, 'productVariants');
    for (const id of strings(part.productId)) wanted.set(id, 'products');
  }
  if (!wanted.size) return entries;
  const budget = readBudget(ctx);
  const names = new Map<string, string>();
  const variantProducts = new Map<string, { productId: string; label: string }>();
  let reads = 0;
  const read = async <T extends 'services' | 'productVariants' | 'products'>(table: T, raw: string) => {
    const id = ctx.db.normalizeId(table, raw);
    if (!id || reads >= MAX_PART_NAME_READS) return null;
    reads++;
    budget.range();
    budget.assert();
    const doc = await ctx.db.get(id);
    if (doc) budget.document(doc);
    budget.assert();
    return doc;
  };
  for (const [raw, table] of wanted) {
    const doc = await read(table, raw);
    if (!doc) continue;
    if ('productId' in doc) variantProducts.set(raw, { productId: doc.productId, label: doc.label });
    else names.set(raw, doc.name);
  }
  for (const [raw, { productId, label }] of variantProducts) {
    const product = names.get(productId) ?? (await read('products', productId))?.name;
    if (product) names.set(productId, product);
    names.set(raw, product ? `${product} · ${label}` : label);
  }
  type Fields = NonNullable<HistoryEntryView['before']>;
  const named = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).map(([key, value]) =>
    [key, Array.isArray(value) ? (value as unknown[]).map(item => {
      if (!isPart(item)) return item;
      const ids = [...strings(item.serviceIds), ...strings(item.variantId), ...strings(item.productId)];
      const found = ids.map(id => names.get(id));
      return ids.length && found.every(Boolean) ? { ...item, label: found.join(' / ') } : item;
    }) : value])) as Fields;
  return entries.map(entry => entry.before || entry.after
    ? { ...entry, ...(entry.before ? { before: named(entry.before) } : {}), ...(entry.after ? { after: named(entry.after) } : {}) }
    : entry);
}
