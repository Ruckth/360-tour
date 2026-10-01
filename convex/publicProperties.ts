import { query, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';

// Guest-facing villa content for the public site. Only active villas are returned, and
// internal fields (tenant, iCal export token, status) are never exposed.

const MAX_VILLAS = 100;
const MAX_REVIEWS_SHOWN = 20;

async function villaSocialProof(ctx: QueryCtx, propertyId: Doc<'properties'>['_id']) {
	return await ctx.db
		.query('socialProof')
		.withIndex('by_property', (q) => q.eq('propertyId', propertyId))
		.first();
}

function publicVilla(property: Doc<'properties'>, proof: Doc<'socialProof'> | null) {
	return {
		_id: property._id,
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
		translations: property.translations ?? [],
		contentEditedAt: property.contentEditedAt ?? null,
		reviewCount: proof?.totalReviews ?? 0,
		averageRating: proof?.overallRating ?? null
	};
}

function publicReview(review: Doc<'reviews'>, propertySlug: string) {
	return {
		id: review._id,
		propertySlug,
		authorName: review.authorName,
		authorCity: review.authorCity,
		authorCountry: review.authorCountry,
		authorAvatarUrl: review.authorAvatarUrl,
		rating: review.rating,
		title: review.title,
		body: review.body,
		date: review.date,
		verified: review.verified,
		photos: review.photos ?? []
	};
}

/**
 * Active villas with a review summary. `hasProperties` is false only for an empty
 * database, which is when the site falls back to its bundled demo content.
 */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const hasProperties = (await ctx.db.query('properties').first()) !== null;
		const active = await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.take(MAX_VILLAS);
		const villas = await Promise.all(
			active.map(async (property) => publicVilla(property, await villaSocialProof(ctx, property._id)))
		);
		return { hasProperties, villas };
	}
});

/** One active villa with its newest reviews, or null for unknown, draft and archived villas. */
export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.unique();
		if (!property || property.status !== 'active') return null;
		const [proof, reviews] = await Promise.all([
			villaSocialProof(ctx, property._id),
			ctx.db.query('reviews').withIndex('by_property_date', q => q.eq('propertyId', property._id)).order('desc').take(MAX_REVIEWS_SHOWN)
		]);
		return {
			villa: publicVilla(property, proof),
			reviews: reviews.map((review) => publicReview(review, property.slug))
		};
	}
});

/** Highest-rated reviews across active villas, for the home page. */
export const featuredReviews = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 6), 1), 20);
		const slugs = new Map<string, string | null>();
		const results: ReturnType<typeof publicReview>[] = [];
		for (const review of await ctx.db.query('reviews').withIndex('by_rating').order('desc').take(200)) {
			if (!slugs.has(review.propertyId)) {
				const property = await ctx.db.get(review.propertyId);
				slugs.set(review.propertyId, property?.status === 'active' ? property.slug : null);
			}
			const slug = slugs.get(review.propertyId);
			if (slug) results.push(publicReview(review, slug));
			if (results.length >= limit) break;
		}
		return results;
	}
});
