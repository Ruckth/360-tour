import type { MutationCtx, QueryCtx } from '../_generated/server';
import { DEFAULT_CASHIER_RULES, type CashierRules } from '../shared/staffTypes';

export async function cashierRules(ctx: QueryCtx | MutationCtx): Promise<CashierRules> {
  const row = await ctx.db.query('cashierRules').withIndex('by_key', q => q.eq('key', 'default')).unique();
  if (!row) return { ...DEFAULT_CASHIER_RULES };
  const { revision, discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund } = row;
  return { revision, discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund: refund ?? 'manager' };
}
