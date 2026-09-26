import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdmin } from './lib/adminAuth';

const otaPlatform = v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia'));
const MAX_NIGHTLY_RATE = 10_000_000;

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.take(100);
	}
});

export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
	}
});

export const getById = query({
	args: { id: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

export const getRooms = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('rooms')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(50);
	}
});

export const getPricing = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('pricing')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.first();
	}
});

/** Public: live direct pricing plus owner-entered OTA rates for an active villa. */
export const getOtaComparison = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
		if (!property || property.status !== 'active') return null;
		const rates = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', property._id))
			.take(10);
		return {
			currency: property.currency,
			pricePerNight: property.pricePerNight,
			directDiscountPercent: property.directDiscountPercent,
			rates: rates.map(({ platform, nightlyRate, url, updatedAt }) => ({ platform, nightlyRate, url, updatedAt }))
		};
	}
});

export const listOtaRates = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId))
			.take(10);
	}
});

export const upsertOtaRate = mutation({
	args: { propertyId: v.id('properties'), platform: otaPlatform, nightlyRate: v.number(), url: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.propertyId))) throw new Error('Property not found');
		if (!Number.isFinite(args.nightlyRate) || args.nightlyRate <= 0 || args.nightlyRate > MAX_NIGHTLY_RATE) {
			throw new Error('Nightly rate must be a positive amount');
		}
		const fields = {
			nightlyRate: Math.round(args.nightlyRate),
			url: args.url?.trim() ? publicHttpsUrl(args.url.trim()) : undefined,
			updatedAt: Date.now()
		};
		const existing = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId).eq('platform', args.platform))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, fields);
			return existing._id;
		}
		return await ctx.db.insert('otaRates', { propertyId: args.propertyId, platform: args.platform, ...fields });
	}
});

export const removeOtaRate = mutation({
	args: { rateId: v.id('otaRates') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (await ctx.db.get(args.rateId)) await ctx.db.delete(args.rateId);
	}
});

function publicHttpsUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Listing URL must be a valid HTTPS link');
	}
	if (url.protocol !== 'https:' || url.username || url.password || value.length > 500) {
		throw new Error('Listing URL must be a valid HTTPS link');
	}
	return url.toString();
}

export const getSocialProof = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('socialProof')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.first();
	}
});

export const getReviews = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('reviews')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
	}
});

export const getRecentBookings = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('recentBookingDisplay')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(50);
	}
});

export const getAllRecentBookings = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('recentBookingDisplay').take(100);
	}
});

export const getTourSnippets = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('tourSnippets')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
	}
});
