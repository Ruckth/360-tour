import { publicVillaSlugsPage, publicPropertiesListResult, publicPropertiesGetBySlugResult, publicPropertiesFeaturedReviewsResult } from './validators';
import { type QueryCtx, publicQuery } from '../auth/model';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc } from '../_generated/dataModel';

// Guest-facing villa content for the public site. Only active villas are returned, and
// internal fields (tenant, iCal export token, status) are never exposed.

const MAX_VILLAS = 100;
const MAX_REVIEWS_SHOWN = 20;
const MAX_FEATURED_REVIEWS_EXAMINED = 200;

async function villaSocialProof(ctx: QueryCtx, propertyId: Doc<'properties'>['_id']) {
	return await ctx.db
		.query('reviewStats')
		.withIndex('by_property', (q) => q.eq('propertyId', propertyId))
		.first();
}

function publicVilla(property: Doc<'properties'>, proof: Doc<'reviewStats'> | null) {
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
 * Featured catalog of active villas with a review summary. `hasProperties` is false
 * only for an empty database.
 */
export const list = publicQuery({
  returns: publicPropertiesListResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
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

/** All active villa paths can be enumerated without reading review summaries. */
export const listSlugs = publicQuery({
	returns: publicVillaSlugsPage,
	reason: "Anonymous sitemap inventory; only active villa slugs are returned.",
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		const { numItems } = paginationOpts;
		if (!Number.isInteger(numItems) || numItems < 1 || numItems > MAX_VILLAS) {
			throw new Error(`Villa page size must be 1–${MAX_VILLAS}`);
		}
		const page = await ctx.db.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.paginate({ numItems, cursor: paginationOpts.cursor });
		return { page: page.page.map((property) => property.slug), continueCursor: page.continueCursor, isDone: page.isDone };
	}
});

/** One active villa with its newest reviews, or null for unknown, draft and archived villas. */
export const getBySlug = publicQuery({
  returns: publicPropertiesGetBySlugResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
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
export const featuredReviews = publicQuery({
  returns: publicPropertiesFeaturedReviewsResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 6), 1), 20);
		const slugs = new Map<string, string | null>();
		const results: ReturnType<typeof publicReview>[] = [];
		let examined = 0;
		const rankedReviews = ctx.db.query('reviews').withIndex('by_rating').order('desc');
		for await (const review of rankedReviews) {
			examined++;
			if (!slugs.has(review.propertyId)) {
				const property = await ctx.db.get(review.propertyId);
				slugs.set(review.propertyId, property?.status === 'active' ? property.slug : null);
			}
			const slug = slugs.get(review.propertyId);
			if (slug) results.push(publicReview(review, slug));
			if (results.length >= limit || examined >= MAX_FEATURED_REVIEWS_EXAMINED) break;
		}
		return results;
	}
});
