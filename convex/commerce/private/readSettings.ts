import type { QueryCtx } from '../../_generated/server';
import { readBudget } from '../../lib/readBudget';
import { resolveCommerceSettings, type CommerceSettings } from '../validators';

export async function settingsDocument(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const row = await ctx.db.query('commerceSettings').withIndex('by_key', q => q.eq('key', 'default')).unique();
  if (row) budget.document(row);
  budget.assert();
  return row;
}

export async function readCommerceSettings(ctx: QueryCtx): Promise<CommerceSettings> {
  const row = await settingsDocument(ctx);
  if (!row) return resolveCommerceSettings(null);
  const { revision, saleSwitches, paymentsMode, cutover, cutoverStartedAt } = row;
  return { ...termsOf(row), revision, saleSwitches, paymentsMode, cutover, cutoverStartedAt };
}

export function termsOf(settings: CommerceSettings) {
  return {
    preserveExpiredPackageValue: settings.preserveExpiredPackageValue,
    unusedFullRefundDays: settings.unusedFullRefundDays,
    refundDueDays: settings.refundDueDays,
    packageValidityDays: settings.packageValidityDays,
    voucherValidityDays: settings.voucherValidityDays,
    allowSessionTransfer: settings.allowSessionTransfer,
    packageSplit: settings.packageSplit,
    packageVatTiming: settings.packageVatTiming,
    pointsVatTreatment: settings.pointsVatTreatment,
    pointsExpiryMonths: settings.pointsExpiryMonths,
  };
}
