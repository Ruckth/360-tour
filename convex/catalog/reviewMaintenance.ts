import { v } from 'convex/values';
import { internalMutation } from '../auth/model';

/** Bounded source verification and exact initialization for one villa. No automatic live run. */
export const initialize = internalMutation({
  args: { propertyId: v.id('properties'), dryRun: v.boolean() },
  returns: v.object({ checked: v.number(), changed: v.boolean(), ratingTotal: v.number(), totalReviews: v.number() }),
  handler: async (ctx, { propertyId, dryRun }) => {
    const reviews = await ctx.db.query('reviews').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(1001);
    if (reviews.length > 1000) throw new Error('Review initialization requires a paginated rollout above 1000 reviews per villa.');
    const current = await ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', propertyId)).unique();
    const ratingTotal = reviews.reduce((total, review) => total + review.rating, 0), totalReviews = reviews.length;
    const overallRating = totalReviews ? Math.round(ratingTotal / totalReviews * 100) / 100 : 0;
    const changed = totalReviews === 0 ? current !== null : !current || current.ratingTotal !== ratingTotal || current.totalReviews !== totalReviews || current.overallRating !== overallRating;
    if (changed && !dryRun) {
      if (!totalReviews) { if (current) await ctx.db.delete(current._id); }
      else {
        const fields = { propertyId, ratingTotal, totalReviews, overallRating };
        if (current) await ctx.db.replace(current._id, fields);
        else await ctx.db.insert('reviewStats', fields);
      }
    }
    return { checked: reviews.length, changed, ratingTotal, totalReviews };
  },
});
