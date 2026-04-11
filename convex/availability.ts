import { query } from './_generated/server';
import { v } from 'convex/values';

export const getForProperty = query({
	args: {
		propertyId: v.id('properties'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query('availability')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.filter((q) =>
				q.and(
					q.gte(q.field('date'), args.startDate),
					q.lte(q.field('date'), args.endDate)
				)
			)
			.collect();
	}
});

export const getBlockedDates = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		const blocked = await ctx.db
			.query('availability')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.filter((q) => q.neq(q.field('status'), 'available'))
			.collect();

		return blocked.map((b) => b.date);
	}
});

export const isAvailable = query({
	args: {
		propertyId: v.id('properties'),
		checkIn: v.string(),
		checkOut: v.string()
	},
	handler: async (ctx, args) => {
		const blocked = await ctx.db
			.query('availability')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.filter((q) =>
				q.and(
					q.neq(q.field('status'), 'available'),
					q.gte(q.field('date'), args.checkIn),
					q.lt(q.field('date'), args.checkOut)
				)
			)
			.collect();

		return blocked.length === 0;
	}
});
