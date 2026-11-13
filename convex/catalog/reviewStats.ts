import { ConvexError } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const INITIALIZATION_LIMIT = 1000;

function fieldsForTotals(propertyId: Id<'properties'>, totalReviews: number, ratingTotal: number) {
  return totalReviews === 0 ? null : {
    propertyId, ratingTotal, totalReviews,
    overallRating: Math.round(ratingTotal / totalReviews * 100) / 100,
  };
}

/** Source verification is shared by first-write initialization and the explicit repair. */
export async function readReviewTotals(ctx: QueryCtx, propertyId: Id<'properties'>) {
  const reviews = await ctx.db.query('reviews').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(INITIALIZATION_LIMIT + 1);
  if (reviews.length > INITIALIZATION_LIMIT) throw new ConvexError({
    code: 'REVIEW_INITIALIZATION_REQUIRED',
    message: 'Review totals need a bounded initialization before editing this villa.',
  });
  const ratingTotal = reviews.reduce((sum, review) => sum + review.rating, 0);
  return { checked: reviews.length, fields: fieldsForTotals(propertyId, reviews.length, ratingTotal) };
}

/** The caller decides whether a write is needed; no additional database read is added. */
export async function storeReviewTotals(ctx: MutationCtx, id: Id<'reviewStats'> | undefined, fields: ReturnType<typeof fieldsForTotals>) {
  if (!fields) {
    if (id) await ctx.db.delete(id);
    return null;
  }
  if (id) await ctx.db.replace(id, fields);
  else id = await ctx.db.insert('reviewStats', fields);
  return { ...fields, _id: id };
}

/** Exact initialization for a small populated villa, before its first incremental write. */
export async function initializeReviewStats(ctx: MutationCtx, propertyId: Id<'properties'>) {
  const existing = await ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', propertyId)).unique();
  if (existing?.ratingTotal !== undefined) return existing;
  const { fields } = await readReviewTotals(ctx, propertyId);
  return await storeReviewTotals(ctx, existing?._id, fields);
}

/** Call before the source write; never reconstruct the sum from the rounded average. */
export async function adjustReviewStats(ctx: MutationCtx, propertyId: Id<'properties'>, countDelta: number, ratingDelta: number) {
  const current = await initializeReviewStats(ctx, propertyId);
  const totalReviews = (current?.totalReviews ?? 0) + countDelta;
  const ratingTotal = (current?.ratingTotal ?? 0) + ratingDelta;
  if (totalReviews < 0 || ratingTotal < 0) throw new ConvexError({ code: 'INVALID_REVIEW_TOTALS', message: 'Review totals are inconsistent. Refresh the totals before trying again.' });
  if (current && totalReviews !== 0 && !countDelta && !ratingDelta) return;
  await storeReviewTotals(ctx, current?._id, fieldsForTotals(propertyId, totalReviews, ratingTotal));
}
