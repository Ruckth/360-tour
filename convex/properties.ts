import { query } from './_generated/server';
import { v } from 'convex/values';

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.collect();
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
			.collect();
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
			.collect();
	}
});

export const getRecentBookings = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('recentBookingDisplay')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.collect();
	}
});

export const getAllRecentBookings = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('recentBookingDisplay').collect();
	}
});

export const getTourSnippets = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('tourSnippets')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.collect();
	}
});
