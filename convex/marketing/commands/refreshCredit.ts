import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { syncAffiliateCredit } from '../affiliateCredits';

export const refreshCredit = marketingMutation({
  permission: "reviewCredits",
  args: { creditId: v.id("affiliateCredits") },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const row = await ctx.db.get(args.creditId);
    if (!row) throw new ConvexError("Credit not found");
    await syncAffiliateCredit(
      ctx,
      row.bookingId ? { bookingId: row.bookingId } : { orderId: row.orderId! },
      actor.email,
    );
    return null;
  },
});
