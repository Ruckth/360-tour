import { v } from 'convex/values';
import { internalMutation } from '../auth/model';
import { readReviewTotals, storeReviewTotals } from './reviewStats';

/** Bounded source verification and exact initialization for one villa. No automatic live run. */
export const initialize = internalMutation({
  args: { propertyId: v.id('properties'), dryRun: v.boolean() },
  returns: v.object({ checked: v.number(), changed: v.boolean(), ratingTotal: v.number(), totalReviews: v.number() }),
  handler: async (ctx, { propertyId, dryRun }) => {
    const { checked, fields } = await readReviewTotals(ctx, propertyId);
    const current = await ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', propertyId)).unique();
    const changed = fields === null ? current !== null : !current || current.ratingTotal !== fields.ratingTotal || current.totalReviews !== fields.totalReviews || current.overallRating !== fields.overallRating;
    if (changed && !dryRun) await storeReviewTotals(ctx, current?._id, fields);
    return { checked, changed, ratingTotal: fields?.ratingTotal ?? 0, totalReviews: fields?.totalReviews ?? 0 };
  },
});
