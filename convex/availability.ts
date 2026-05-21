import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { assertValidIsoDate } from './lib/validation';
import type { Doc } from './_generated/dataModel';

function blocksNewBookings(booking: Doc<'bookings'>): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

export const getForProperty = query({
	args: {
		propertyId: v.id('properties'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.startDate, 'Start date');
		assertValidIsoDate(args.endDate, 'End date');
		if (args.endDate < args.startDate) {
			throw new Error('End date must be on or after start date');
		}
		return await ctx.db
			.query('availability')
			.withIndex('by_property_date', (q) =>
				q.eq('propertyId', args.propertyId).gte('date', args.startDate).lte('date', args.endDate)
			)
			.take(366);
	}
});

export const getBlockedDates = query({
	args: {
		propertyId: v.id('properties'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.startDate, 'Start date');
		assertValidIsoDate(args.endDate, 'End date');
		const all = await ctx.db
			.query('availability')
			.withIndex('by_property_date', (q) =>
				q.eq('propertyId', args.propertyId).gte('date', args.startDate).lte('date', args.endDate)
			)
			.take(731);

		return all.filter((a) => a.status !== 'available').map((a) => a.date);
	}
});

export const getBlockedDatesByProperty = query({
	args: {
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.startDate, 'Start date');
		assertValidIsoDate(args.endDate, 'End date');
		const properties = await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.collect();
		const map: Record<string, string[]> = {};
		for (const property of properties) {
			const rows = await ctx.db
				.query('availability')
				.withIndex('by_property_date', (q) =>
					q.eq('propertyId', property._id).gte('date', args.startDate).lte('date', args.endDate)
				)
				.take(731);
			for (const r of rows) {
				if (r.status === 'available') continue;
				(map[r.propertyId] ??= []).push(r.date);
			}
		}
		return map;
	}
});

export const seedBlockedRange = mutation({
	args: {
		propertySlug: v.string(),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.startDate, 'Start date');
		assertValidIsoDate(args.endDate, 'End date');
		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
			.first();
		if (!property) throw new Error(`Property not found: ${args.propertySlug}`);

		const start = new Date(args.startDate);
		const end = new Date(args.endDate);
		let inserted = 0;
		for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
			const d = new Date(t);
			const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
			const existing = await ctx.db
				.query('availability')
				.withIndex('by_property_date', (q) =>
					q.eq('propertyId', property._id).eq('date', date)
				)
				.first();
			if (existing) {
				await ctx.db.patch(existing._id, { status: 'booked', source: 'manual' });
			} else {
				await ctx.db.insert('availability', {
					propertyId: property._id,
					date,
					status: 'booked',
					source: 'manual'
				});
			}
			inserted++;
		}
		return { propertyId: property._id, inserted };
	}
});

export const isAvailable = query({
	args: {
		propertyId: v.id('properties'),
		checkIn: v.string(),
		checkOut: v.string()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.checkIn, 'Check-in date');
		assertValidIsoDate(args.checkOut, 'Check-out date');
		if (args.checkOut <= args.checkIn) return false;
		const inRange = await ctx.db
			.query('availability')
			.withIndex('by_property_date', (q) =>
				q.eq('propertyId', args.propertyId).gte('date', args.checkIn).lt('date', args.checkOut)
			)
			.take(366);

		if (!inRange.every((a) => a.status === 'available')) return false;

		const bookings = await ctx.db
			.query('bookings')
			.withIndex('by_property_checkIn', (q) =>
				q.eq('propertyId', args.propertyId).lt('checkIn', args.checkOut)
			)
			.take(500);

		return bookings.every((booking) => !blocksNewBookings(booking) || booking.checkOut <= args.checkIn);
	}
});
