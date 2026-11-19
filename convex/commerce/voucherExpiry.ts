import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalMutation } from '../auth/model';
import { readBudget, reserveWrites } from '../lib/readBudget';
import { benefitState } from '../shared/commerce/settings';
import { bumpOrderCommerceRevision } from './private/orderRevision';

const EXPIRY_BATCH_SIZE = 100;

export const expireVouchers = internalMutation({
  args: { cursor: v.optional(v.string()), cutoff: v.optional(v.number()) },
  handler: async (ctx, { cursor, cutoff }) => {
    const now = Date.now();
    const through = cutoff ?? now;
    const budget = readBudget(ctx);
    budget.range();
    const { page, isDone, continueCursor } = await ctx.db.query('vouchers')
      .withIndex('by_status_and_effectiveExpiresAt', q => q.eq('status', 'active').gt('effectiveExpiresAt', null).lte('effectiveExpiresAt', through))
      .paginate({ numItems: EXPIRY_BATCH_SIZE, cursor: cursor ?? null, maximumRowsRead: EXPIRY_BATCH_SIZE + 1 });
    const orderIds = [];
    for (const voucher of page) {
      budget.document(voucher);
      budget.assert();
      if (voucher.pendingReturnId) continue;
      const state = benefitState({
        kind: voucher.source.kind === 'package' ? 'package_voucher' : 'standalone_voucher',
        expiresAt: voucher.effectiveExpiresAt, paused: !!voucher.pause,
      }, through, { retainExpiredPackageValue: voucher.terms.preserveExpiredPackageValue });
      if (state === 'active' || state === 'paused') continue;

      reserveWrites(ctx, 2);
      await ctx.db.patch(voucher._id, {
        status: 'expired', paidBalance: 0, goodwillBalance: 0, revision: voucher.revision + 1,
        packageUnusedPaid: state === 'expired_retained' ? voucher.packageUnusedPaid : undefined,
      });
      await ctx.db.insert('voucherEntries', {
        voucherId: voucher._id, kind: 'expire', sourceKey: `expiry:${voucher._id}:${voucher.revision}`,
        before: { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance },
        after: { paid: 0, goodwill: 0 }, guestFact: { key: 'expired' }, actor: 'system', createdAt: now,
      });
      orderIds.push(voucher.source.orderId);
    }
    await bumpOrderCommerceRevision(ctx, orderIds);
    if (!isDone) await ctx.scheduler.runAfter(0, internal.commerce.voucherExpiry.expireVouchers, { cursor: continueCursor, cutoff: through });
    return null;
  },
});
