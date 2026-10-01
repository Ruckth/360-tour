import { mutation, query } from './_generated/server';
import { v, type Infer } from 'convex/values';
import { requireAdmin } from './lib/adminAuth';
import { recomputeSocialProof } from './lib/socialProof';
import { amount, imageUrl, required } from './properties';

// Real guest reviews, entered by the admin. Every change rebuilds the villa's socialProof row.

const reviewInput = v.object({
	authorName: v.string(),
	authorCity: v.string(),
	authorCountry: v.string(),
	rating: v.number(),
	title: v.string(),
	body: v.string(),
	date: v.string(),
	verified: v.boolean(),
	photos: v.optional(v.array(v.string()))
});

function reviewDate(value: string): string {
	const date = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
		throw new Error('Review date must be YYYY-MM-DD');
	}
	return date;
}

function clean(args: Infer<typeof reviewInput>) {
	const photos = (args.photos ?? []).map((photo) => photo.trim()).filter(Boolean);
	if (photos.length > 10) throw new Error('A review can have at most 10 photos');
	return {
		authorName: required(args.authorName, 'Guest name'),
		authorCity: args.authorCity.trim(),
		authorCountry: args.authorCountry.trim(),
		rating: amount(args.rating, 'Rating', { integer: true, min: 1, max: 5 }),
		title: args.title.trim(),
		body: required(args.body, 'Review text'),
		date: reviewDate(args.date),
		verified: args.verified,
		photos: photos.map(imageUrl)
	};
}

export const list = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const reviews = await ctx.db
			.query('reviews')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(500);
		const summary = await ctx.db
			.query('socialProof')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.first();
		return {
			reviews: reviews.sort((a, b) => b.date.localeCompare(a.date)),
			summary: summary ? { overallRating: summary.overallRating, totalReviews: summary.totalReviews } : null
		};
	}
});

export const create = mutation({
	args: { propertyId: v.id('properties'), ...reviewInput.fields },
	handler: async (ctx, { propertyId, ...fields }) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(propertyId))) throw new Error('Property not found');
		const reviewId = await ctx.db.insert('reviews', { propertyId, authorAvatarUrl: '', ...clean(fields) });
		await recomputeSocialProof(ctx, propertyId);
		return reviewId;
	}
});

export const update = mutation({
	args: { reviewId: v.id('reviews'), ...reviewInput.fields },
	handler: async (ctx, { reviewId, ...fields }) => {
		await requireAdmin(ctx);
		const review = await ctx.db.get(reviewId);
		if (!review) throw new Error('Review not found');
		await ctx.db.patch(reviewId, clean(fields));
		await recomputeSocialProof(ctx, review.propertyId);
	}
});

export const remove = mutation({
	args: { reviewId: v.id('reviews') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const review = await ctx.db.get(args.reviewId);
		if (!review) return;
		await ctx.db.delete(review._id);
		await recomputeSocialProof(ctx, review.propertyId);
	}
});
