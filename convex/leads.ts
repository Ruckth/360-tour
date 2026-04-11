import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const save = mutation({
	args: {
		propertyId: v.optional(v.id('properties')),
		email: v.string(),
		source: v.union(
			v.literal('tour_completion'),
			v.literal('chat'),
			v.literal('booking_abandonment')
		)
	},
	handler: async (ctx, args) => {
		// Check for duplicate email + property combination
		const existing = await ctx.db
			.query('leads')
			.withIndex('by_email', (q) => q.eq('email', args.email))
			.first();

		if (existing) {
			return existing._id;
		}

		return await ctx.db.insert('leads', {
			propertyId: args.propertyId,
			email: args.email,
			source: args.source,
			createdAt: Date.now()
		});
	}
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('leads').collect();
	}
});
