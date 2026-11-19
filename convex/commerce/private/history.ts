import type { PaginationOptions, PaginationResult, Query } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { DataModel, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readBudget } from '../../lib/readBudget';
import type { AdjustmentTarget } from './adjustments';

type BenefitTarget = Extract<AdjustmentTarget, { targetType: 'voucher' | 'grant' }>;
type HistoryTable = 'commerceAdjustments' | 'sessionUses' | 'stockMovements' | 'voucherEntries';
export type CommerceHistoryRow = Doc<HistoryTable>;
export type GuestHistoryRow = {
  recordedAt: number;
  kind: Doc<'voucherEntries' | 'sessionUses'>['kind'];
  before: Doc<'voucherEntries'>['before'];
  after: Doc<'voucherEntries'>['after'];
};

const MAX_PAGE_BYTES = 160 * 1024;

function checkPageSize({ numItems }: PaginationOptions) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 20) {
    throw new ConvexError({ code: 'INVALID_PAGE_SIZE', message: 'History page size must be 1–20.' });
  }
}

async function readPage<Table extends HistoryTable>(
  ctx: QueryCtx,
  query: Query<DataModel[Table]>,
  { numItems, cursor }: PaginationOptions,
): Promise<PaginationResult<Doc<Table>>> {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const startBytes = budget.bytes;
  const result = await query.order('desc').paginate({
    numItems, cursor, maximumRowsRead: numItems + 1, maximumBytesRead: MAX_PAGE_BYTES,
  });
  for (const row of result.page) budget.document(row);
  budget.assert();
  if (budget.bytes - startBytes > MAX_PAGE_BYTES) {
    throw new ConvexError({ code: 'HISTORY_PAGE_TOO_LARGE', message: 'This history page exceeds 160 KiB.' });
  }
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
      const result = await readPage<'stockMovements'>(ctx, ctx.db.query('stockMovements')
        .withIndex('by_variantId_and_createdAt', q => q.eq('variantId', stock.variantId)), pagination);
      return { ...result, page: result.page.filter(row => row.branchId === stock.branchId) };
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
    : row.voucherId !== target.targetId || row.kind !== 'edit')) {
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
  if (pagination.cursor !== null && !pagination.cursor.startsWith(cursorPrefix)) {
    throw new ConvexError({ code: 'STALE_HISTORY_CURSOR', message: 'History has changed. Reopen the first page.' });
  }
  const options = { ...pagination, cursor: pagination.cursor?.slice(cursorPrefix.length) ?? null };
  const result = target.targetType === 'grant'
    ? await readPage<'sessionUses'>(ctx, grantHistory(ctx, target, transfer?.createdAt), options)
    : await readPage<'voucherEntries'>(ctx, voucherHistory(ctx, target, transfer?.createdAt), options);
  // A preceding entry can share the transfer's recorded timestamp. Apply the index tie-breaker too.
  const visible = transfer ? result.page.filter(row => row.createdAt > transfer.createdAt ||
    (row.createdAt === transfer.createdAt && (row._creationTime > transfer._creationTime || row._id === transfer._id))) : result.page;
  return {
    page: visible.filter(row => !('beneficiaryId' in row && row.beneficiaryId && row.beneficiaryId !== grantOwner)).map(row => ({
      recordedAt: row.createdAt,
      kind: row._id === transfer?._id ? 'transfer' : row.kind,
      before: row.before,
      after: row.after,
    })),
    isDone: result.isDone || visible.length < result.page.length,
    continueCursor: cursorPrefix + result.continueCursor,
  };
}
