import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const INITIALIZATION_LIMIT = 1000;

/** Exact initialization for a small populated villa, before its first incremental write. */
export async function initializeReviewStats(ctx: MutationCtx, propertyId: Id<'properties'>) {
  const existing = await ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', propertyId)).unique();
  if (existing?.ratingTotal !== undefined) return existing;
  const reviews = await ctx.db.query('reviews').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(INITIALIZATION_LIMIT + 1);
  if (reviews.length > INITIALIZATION_LIMIT) throw new Error('Review totals need a bounded initialization before editing this villa.');
  if (!reviews.length) {
    if (existing) await ctx.db.delete(existing._id);
    return null;
  }
  const ratingTotal = reviews.reduce((sum, review) => sum + review.rating, 0);
  const fields = { propertyId, ratingTotal, totalReviews: reviews.length, overallRating: Math.round(ratingTotal / reviews.length * 100) / 100 };
  const id = existing?._id ?? await ctx.db.insert('reviewStats', fields);
  if (existing) await ctx.db.replace(id, fields);
  return { ...fields, _id: id };
}

/** Call before the source write; never reconstruct the sum from the rounded average. */
export async function adjustReviewStats(ctx: MutationCtx, propertyId: Id<'properties'>, countDelta: number, ratingDelta: number) {
  const current = await initializeReviewStats(ctx, propertyId);
  const totalReviews = (current?.totalReviews ?? 0) + countDelta;
  const ratingTotal = (current?.ratingTotal ?? 0) + ratingDelta;
  if (totalReviews < 0 || ratingTotal < 0) throw new Error('Invalid review totals');
  if (totalReviews === 0) {
    if (current) await ctx.db.delete(current._id);
    return;
  }
  const fields = { propertyId, ratingTotal, totalReviews, overallRating: Math.round(ratingTotal / totalReviews * 100) / 100 };
  if (current) {
    if (countDelta || ratingDelta) await ctx.db.replace(current._id, fields);
  } else await ctx.db.insert('reviewStats', fields);
}
