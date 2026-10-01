import { query, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { assertValidIsoDate } from './lib/validation';
import { nightsBetween } from './lib/dates';
import { readBudget, ReadBudgetExceeded } from './lib/readBudget';
import {
	blocksNewBookings,
	findBlockingNight,
	findOverlappingBookings,
	MAX_ROWS_PER_NIGHT
} from './lib/stayOverlap';

/** Longest date window one read may cover: today plus a year (366 dates). */
export const MAX_RANGE_DAYS = 366;
/** Most villas one multi-villa read may name. */
export const MAX_PROPERTY_IDS = 100;
/** Villa-dates one multi-villa read may cover, e.g. 100 villas × 31 nights. */
export const MAX_PROPERTY_DAYS = 3100;

/** Validates an inclusive [startDate, endDate] window and returns how many dates it covers. */
function rangeDays(startDate: string, endDate: string): number {
	assertValidIsoDate(startDate, 'Start date');
	assertValidIsoDate(endDate, 'End date');
	if (endDate < startDate) throw new Error('End date must be on or after start date');
	const days = nightsBetween(startDate, endDate) + 1;
	if (days > MAX_RANGE_DAYS) throw new Error(`Choose at most ${MAX_RANGE_DAYS} days`);
	return days;
}

/**
 * Every availability row of a villa in [startDate, endDate]. A night can have several rows, so
 * this reads them all; a range holding far more rows than any real calendar, or a call whose
 * reads pass the shared invocation budget, is refused rather than answered from a partial read.
 */
async function* availabilityRows(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	startDate: string,
	endDate: string,
	days: number
) {
	const budget = readBudget(ctx);
	if (!budget.range()) throw new ReadBudgetExceeded();
	let read = 0;
	for await (const row of ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', propertyId).gte('date', startDate).lte('date', endDate)
		)) {
		if (++read > days * MAX_ROWS_PER_NIGHT) {
			throw new Error('Too many availability rows in this range. Choose a shorter range.');
		}
		if (!budget.document(row)) throw new ReadBudgetExceeded();
		yield row;
	}
}

/** Unavailable dates, ascending and each listed once. */
async function blockedDates(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	startDate: string,
	endDate: string,
	days: number
): Promise<string[]> {
	const dates: string[] = [];
	for await (const row of availabilityRows(ctx, propertyId, startDate, endDate, days)) {
		if (row.status !== 'available' && dates[dates.length - 1] !== row.date) dates.push(row.date);
	}
	return dates;
}

/** Public: date, status and source only. Booking, feed and block ids stay private. */
export const getForProperty = query({
	args: {
		propertyId: v.id('properties'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		const days = rangeDays(args.startDate, args.endDate);
		const rows: Array<{ date: string; status: 'available' | 'booked' | 'blocked'; source: string }> = [];
		for await (const row of availabilityRows(ctx, args.propertyId, args.startDate, args.endDate, days)) {
			rows.push({ date: row.date, status: row.status, source: row.source });
		}
		return rows;
	}
});

/** Unavailable dates of one villa in [startDate, endDate]; the booking date picker loads a month at a time. */
export const getBlockedDates = query({
	args: {
		propertyId: v.id('properties'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		const days = rangeDays(args.startDate, args.endDate);
		return await blockedDates(ctx, args.propertyId, args.startDate, args.endDate, days);
	}
});

/**
 * Unavailable dates per active villa in [startDate, endDate], keyed by villa id (villas with none
 * are left out). Pass `propertyIds` (the booking UI asks for the villas it lists over the chosen
 * stay); the villa-days limit keeps one call to a short window. Without `propertyIds` it covers
 * every active villa, which clients from before the per-month loading still call: that path is
 * served only while the whole answer fits the shared read budget and is refused otherwise.
 */
export const getBlockedDatesByProperty = query({
	args: {
		startDate: v.string(),
		endDate: v.string(),
		propertyIds: v.optional(v.array(v.id('properties')))
	},
	handler: async (ctx, args) => {
		const days = rangeDays(args.startDate, args.endDate);
		let propertyIds: Id<'properties'>[];
		if (args.propertyIds) {
			propertyIds = [...new Set(args.propertyIds)];
			if (propertyIds.length > MAX_PROPERTY_IDS) throw new Error(`Ask for at most ${MAX_PROPERTY_IDS} villas`);
			if (propertyIds.length * days > MAX_PROPERTY_DAYS) {
				throw new Error('Too many villa nights at once. Choose fewer villas or a shorter range.');
			}
			const budget = readBudget(ctx);
			for (let index = 0; index < propertyIds.length; index++) budget.range();
			const properties = await Promise.all(propertyIds.map((id) => ctx.db.get(id)));
			for (const property of properties) budget.document(property);
			budget.assert();
			propertyIds = propertyIds.filter((_, index) => properties[index]?.status === 'active');
		} else {
			const budget = readBudget(ctx);
			budget.range();
			const properties = await ctx.db
				.query('properties')
				.withIndex('by_status', (q) => q.eq('status', 'active'))
				.take(MAX_PROPERTY_IDS + 1);
			for (const property of properties) budget.document(property);
			budget.assert();
			// Never answer for only part of the catalog.
			if (properties.length > MAX_PROPERTY_IDS) throw new Error('Too many villas; ask for specific villas.');
			propertyIds = properties.map((property) => property._id);
		}

		const map: Record<string, string[]> = {};
		for (const propertyId of propertyIds) {
			const dates = await blockedDates(ctx, propertyId, args.startDate, args.endDate, days);
			if (dates.length > 0) map[propertyId] = dates;
		}
		return map;
	}
});

/** Whether [checkIn, checkOut) is free: no blocked night and no overlapping confirmed booking. */
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
		// Longer stays can't be booked (assertStayDates), so they are never available.
		if (nightsBetween(args.checkIn, args.checkOut) > 365) return false;
		if (await findBlockingNight(ctx, args.propertyId, args.checkIn, args.checkOut)) return false;

		// Also check the bookings themselves: a legacy booking may have no availability rows.
		const overlapping = await findOverlappingBookings(
			ctx,
			args.propertyId,
			args.checkIn,
			args.checkOut,
			blocksNewBookings
		);
		return !overlapping.some(blocksNewBookings);
	}
});
