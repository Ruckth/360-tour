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
type NameTable = 'services' | 'productVariants' | 'products';
type Fields = NonNullable<HistoryEntryView['before']>;
type Part = Record<string, unknown>;
const isPart = (value: unknown): value is Part => value !== null && typeof value === 'object' && !Array.isArray(value);
const partsOf = (fields: HistoryEntryView['before']): Part[] =>
  Object.values(fields ?? {}).flatMap(value => Array.isArray(value) ? (value as unknown[]).filter(isPart) : []);
const strings = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string')
  : typeof value === 'string' ? [value] : [];
const partIds = (part: Part): [string, NameTable][] => [
  ...strings(part.serviceIds).map(id => [id, 'services'] as [string, NameTable]),
  ...strings(part.variantId).map(id => [id, 'productVariants'] as [string, NameTable]),
  ...strings(part.productId).map(id => [id, 'products'] as [string, NameTable]),
];
const partKey = (part: Part) => typeof part.contentKey === 'string' ? part.contentKey : typeof part.key === 'string' ? part.key : null;

/**
 * The names an entry's changed parts count, same-key substitutions first: without their names
 * "Thai massage → Hot stone" would read as "Massage changed".
 */
function wantedNames(entry: HistoryEntryView): Map<string, NameTable> {
  const before = partsOf(entry.before);
  const after = partsOf(entry.after);
  const keyed = new Map(before.flatMap(part => partKey(part) === null ? [] : [[partKey(part), part] as const]));
  const swapped = after.flatMap(part => {
    const old = partKey(part) === null ? undefined : keyed.get(partKey(part));
    return old && JSON.stringify(old) !== JSON.stringify(part) ? [old, part] : [];
  });
  return new Map([...swapped, ...before, ...after].flatMap(partIds));
}

/**
 * Staff History names what a changed package part counts (its services, variant or product), so a
 * same-key swap reads "Traditional Thai Massage → Aromatherapy Massage". Names are read once per page,
 * de-duplicated and capped; a record that is gone (or past the cap) keeps the part's stored label.
 */
function partNamer(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  const names = new Map<string, string>();
  const tried = new Set<string>();
  let reads = 0;
  const read = async <T extends NameTable>(table: T, raw: string) => {
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
  const unread = (entry: HistoryEntryView) => [...wantedNames(entry)].filter(([raw]) => !tried.has(raw));
  return {
    /** Reads still left on this page. */
    get left() { return MAX_PART_NAME_READS - reads; },
    /** The most reads naming this entry can take (a variant also reads its product). */
    cost: (entry: HistoryEntryView) => unread(entry).reduce((sum, [, table]) => sum + (table === 'productVariants' ? 2 : 1), 0),
    /** Read this entry's names, in priority order, while the page has reads left. */
    async read(entry: HistoryEntryView) {
      for (const [raw, table] of unread(entry)) {
        if (reads >= MAX_PART_NAME_READS) return;
        tried.add(raw);
        const doc = await read(table, raw);
        if (!doc) continue;
        if (!('productId' in doc)) { names.set(raw, doc.name); continue; }
        const product = names.get(doc.productId) ?? (await read('products', doc.productId))?.name;
        if (product) names.set(doc.productId, product);
        names.set(raw, product ? `${product} · ${doc.label}` : doc.label);
      }
    },
    /** The entry with each part named once every record it counts was read. */
    name(entry: HistoryEntryView): HistoryEntryView {
      const named = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).map(([key, value]) =>
        [key, Array.isArray(value) ? (value as unknown[]).map(item => {
          if (!isPart(item)) return item;
          const found = partIds(item).map(([id]) => names.get(id));
          return found.length && found.every(Boolean) ? { ...item, label: found.join(' / ') } : item;
        }) : value])) as Fields;
      return entry.before || entry.after
        ? { ...entry, ...(entry.before ? { before: named(entry.before) } : {}), ...(entry.after ? { after: named(entry.after) } : {}) }
        : entry;
    },
  };
}

/**
 * A page that ended early, before every row it read fit: the next page reads the same range again
 * (`cursor`) and starts after the last row shown (`after`). Never paired with a split cursor.
 */
const CUT_PREFIX = 'cut:';
const cutCursor = (cursor: string | null, after: string) => CUT_PREFIX + JSON.stringify([cursor, after]);
function staleCursor(): never {
  throw new ConvexError({ code: 'STALE_HISTORY_CURSOR', message: 'History has changed. Reopen the first page.' });
}
function parseCut(cursor: string | null): { cursor: string | null; after: string | null } {
  if (cursor === null || !cursor.startsWith(CUT_PREFIX)) return { cursor, after: null };
  let value: unknown;
  try { value = JSON.parse(cursor.slice(CUT_PREFIX.length)); } catch { staleCursor(); }
  if (!Array.isArray(value) || value.length !== 2 || (value[0] !== null && typeof value[0] !== 'string') || typeof value[1] !== 'string') staleCursor();
  return { cursor: value[0] as string | null, after: value[1] as string };
}
/** Room in a page for its cursors and framing; the rows get the rest of MAX_PAGE_BYTES. */
const PAGE_FRAMING_BYTES = 4 * 1024;

/**
 * Call after authorizing the target. One item's History for staff, ≤ 20 rows, ≤ 41 documents and
 * ≤ 160 KiB. A page ends early, with a cursor to the next row, before a row whose names no longer
 * fit the page's reads or whose bytes no longer fit the page; its first row always shows.
 */
export async function listStaffCommerceHistory(
  ctx: QueryCtx, target: AdjustmentTarget, pagination: PaginationOptions,
  entryOf: (row: CommerceHistoryRow) => HistoryEntryView,
): Promise<PaginationResult<HistoryEntryView>> {
  const start = parseCut(pagination.cursor);
  if (pagination.endCursor?.startsWith(CUT_PREFIX)) staleCursor();
  const result = await listCommerceHistory(ctx, target, { ...pagination, cursor: start.cursor });
  let rows = result.page;
  if (start.after !== null) {
    const index = rows.findIndex(row => row._id === start.after);
    if (index < 0) staleCursor();
    rows = rows.slice(index + 1);
  }
  const namer = partNamer(ctx);
  const page: HistoryEntryView[] = [];
  let used = PAGE_FRAMING_BYTES;
  for (const row of rows) {
    const entry = entryOf(row);
    if (page.length && namer.cost(entry) > namer.left) break;
    await namer.read(entry);
    let shown = namer.name(entry);
    // A first row too large once named shows its stored labels (writers keep rows ≤ 8 KiB).
    if (!page.length && used + encoder.encode(JSON.stringify(shown)).length + 1 > MAX_PAGE_BYTES) shown = entry;
    const size = encoder.encode(JSON.stringify(shown)).length + 1;
    if (page.length && used + size > MAX_PAGE_BYTES) break;
    used += size;
    page.push(shown);
  }
  if (page.length < rows.length) {
    return { page, isDone: false, continueCursor: cutCursor(start.cursor, rows[page.length - 1]._id) };
  }
  // A cut page re-reads rows it skips, so Convex's split of that range would not match this page.
  return start.after === null ? { ...result, page } : { page, isDone: result.isDone, continueCursor: result.continueCursor };
}
