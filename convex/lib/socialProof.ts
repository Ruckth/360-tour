import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Rebuilds a villa's `socialProof` row from its real reviews: average rating and count.
 * Call after any review change. No reviews → no row, so guests never see an empty "0.0 ★".
 */
export async function recomputeSocialProof(ctx: MutationCtx, propertyId: Id<'properties'>) {
	let total = 0;
	let count = 0;
	for await (const review of ctx.db.query('reviews').withIndex('by_property', (q) => q.eq('propertyId', propertyId))) {
		total += review.rating;
		count += 1;
	}
	const existing = await ctx.db
		.query('socialProof')
		.withIndex('by_property', (q) => q.eq('propertyId', propertyId))
		.first();
	if (count === 0) {
		if (existing) await ctx.db.delete(existing._id);
		return;
	}
	// Seeded breakdown/superhost values were invented, so a recompute drops them.
	const row = { propertyId, overallRating: Math.round((total / count) * 100) / 100, totalReviews: count };
	if (existing) await ctx.db.replace(existing._id, row);
	else await ctx.db.insert('socialProof', row);
}
