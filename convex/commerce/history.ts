import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { v } from 'convex/values';
import type { Id, TableNames } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { canReadCheckoutOrder, staffQuery, type StaffActor } from '../auth/model';
import { readBudget } from '../lib/readBudget';
import type { AdjustmentTarget } from './private/adjustments';
import { assertPageBytes, listGuestCommerceHistory, listStaffCommerceHistory } from './private/history';
import { staffHistoryEntry, type HistoryEntryView } from './private/historyView';
import { adjustmentTarget } from './validators';

const benefitTarget = v.union(
  v.object({ targetType: v.literal('voucher'), targetId: v.id('vouchers') }),
  v.object({ targetType: v.literal('grant'), targetId: v.id('sessionGrants') }),
);

/** Catalogue and room-rate history belongs to the people who edit future sales (D19). */
const CATALOGUE = new Set<AdjustmentTarget['targetType']>(['product', 'variant', 'package', 'voucherTemplate', 'service', 'property']);

async function get<T extends TableNames>(ctx: QueryCtx, id: Id<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const doc = await ctx.db.get(id);
  if (doc) budget.document(doc);
  budget.assert();
  return doc;
}

/**
 * Who may open an item's History. A receipt or room charge follows the receipt rule (a cashier sees
 * today's receipts only); a voucher, package or stock card opens only within the staff member's branch scope.
 */
async function canReadHistory(ctx: QueryCtx, actor: StaffActor, target: AdjustmentTarget) {
  switch (target.targetType) {
    case 'settings': return actor.capabilities.operations;
    case 'order': return canReadCheckoutOrder(actor, await get(ctx, target.targetId));
    case 'handover': {
      const handover = await get(ctx, target.targetId);
      return !!handover && canReadCheckoutOrder(actor, await get(ctx, handover.orderId));
    }
    case 'voucher':
    case 'grant': return true;
    case 'stock': {
      const stock = await get(ctx, target.targetId);
      if (!stock || (!actor.companyScope && !actor.branchIds.includes(stock.branchId))) return false;
      const branch = await get(ctx, stock.branchId);
      return branch !== null && branch.state !== 'archived';
    }
    default: return CATALOGUE.has(target.targetType) && actor.capabilities.operations;
  }
}

const nothing: PaginationResult<HistoryEntryView> = { page: [], isDone: true, continueCursor: '' };

/** One item's History for staff, newest first, ≤ 20 rows and ≤ 160 KiB a page, from its one stream (D19). */
export const staffPage = staffQuery({
  capability: 'checkout',
  args: { target: adjustmentTarget, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { target, paginationOpts }) => {
    if (!await canReadHistory(ctx, ctx.staff, target)) return nothing;
    return await listStaffCommerceHistory(ctx, target, paginationOpts, staffHistoryEntry);
  },
});

/**
 * Show guest for a voucher or package (journey 12), shaped here: dated facts and balances only, from
 * the current owner's transfer-in entry onwards, without staff names, notes or full codes.
 */
export const guestPage = staffQuery({
  capability: 'checkout',
  args: { target: benefitTarget, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { target, paginationOpts }) => {
    if (!await canReadHistory(ctx, ctx.staff, target)) return nothing;
    const result = await listGuestCommerceHistory(ctx, target, paginationOpts);
    return assertPageBytes({
      ...result,
      page: result.page.map(({ entryId, recordedAt, fact, before, after }): HistoryEntryView => ({
        entryId, at: recordedAt, fact,
        balance: { unit: target.targetType === 'voucher' ? 'money' : 'sessions', before, after },
      })),
    });
  },
});
