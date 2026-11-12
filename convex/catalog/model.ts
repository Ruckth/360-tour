import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Rebuilds a villa's `reviewStats` row from its real reviews: average rating and count.
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
		.query('reviewStats')
		.withIndex('by_property', (q) => q.eq('propertyId', propertyId))
		.first();
	if (count === 0) {
		if (existing) await ctx.db.delete(existing._id);
		return;
	}
	// Seeded breakdown/superhost values were invented, so a recompute drops them.
	const row = { propertyId, overallRating: Math.round((total / count) * 100) / 100, totalReviews: count };
	if (existing) await ctx.db.replace(existing._id, row);
	else await ctx.db.insert('reviewStats', row);
}

export type PublicProperty = NonNullable<ReturnType<typeof toPublicProperty>>;

/** Public queries never expose the private iCal export token or tenant link. */
export function toPublicProperty(property: Doc<'properties'> | null) {
	if (!property || property.status !== 'active') return null;
	return {
		_id: property._id,
		_creationTime: property._creationTime,
		slug: property.slug,
		name: property.name,
		tagline: property.tagline,
		description: property.description,
		pricePerNight: property.pricePerNight,
		currency: property.currency,
		maxGuests: property.maxGuests,
		bedrooms: property.bedrooms,
		bathrooms: property.bathrooms,
		area: property.area,
		images: property.images,
		amenities: property.amenities,
		tourRoomIds: property.tourRoomIds,
		directDiscountPercent: property.directDiscountPercent,
		translations: property.translations,
		contentEditedAt: property.contentEditedAt,
		status: property.status,
	};
}

