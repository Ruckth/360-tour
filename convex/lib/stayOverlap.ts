import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { nightsBetween } from './dates';
import { readBudget, ReadBudget, ReadBudgetExceeded } from './readBudget';

/** Rows read from each side of an overlap scan before refusing to answer. */
export const OVERLAP_SCAN_LIMIT = 1000;
/** Availability rows one night can reasonably hold: a booking hold, a host block and one per OTA feed. */
export const MAX_ROWS_PER_NIGHT = 20;

export const STAY_TAKEN_ERROR = 'These dates are no longer available. Please choose different dates.';
export const STAY_BLOCKED_ERROR = 'Some of these dates are blocked. Please choose different dates.';
export const OVERLAP_INCOMPLETE_ERROR =
	'Too many bookings to check these dates safely. Please contact us to book them.';
export const NIGHT_ROWS_ERROR = 'Too many availability records on these dates to check them safely.';

export function blocksNewBookings(booking: Pick<Doc<'bookings'>, 'status'>): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

/** Half-open ranges: [start, end). A checkout day is free for the next check-in. */
export function staysOverlap(stay: { start: string; end: string }, from: string, to: string): boolean {
	return stay.start < to && stay.end > from;
}

/**
 * Rows overlapping [from, to), read from two index ranges that each hold every overlapping row:
 * rows starting before `to` (newest start first) and rows ending after `from` (soonest end first).
 * They are read in lockstep; once either range runs out, every overlap has been seen. Cost is
 * about twice the smaller side, with no assumption about how long a legacy row can be.
 * `complete` is false when neither side ran out within `OVERLAP_SCAN_LIMIT` rows, or the shared
 * budget was spent first.
 */
async function lockstepOverlap<T extends { _id: string }>(
	startsBefore: AsyncIterator<T>,
	endsAfter: AsyncIterator<T>,
	overlaps: (row: T) => boolean,
	budget: ReadBudget,
	stopWhen?: (row: T) => boolean
): Promise<{ rows: T[]; complete: boolean }> {
	const found = new Map<string, T>();
	try {
		if (!budget.range() || !budget.range()) return { rows: [], complete: false };
		for (let read = 0; read < OVERLAP_SCAN_LIMIT; read++) {
			const [before, after] = await Promise.all([startsBefore.next(), endsAfter.next()]);
			for (const step of [before, after]) {
				if (step.done) continue;
				if (!budget.document(step.value)) return { rows: [...found.values()], complete: false };
				if (!overlaps(step.value)) continue;
				found.set(step.value._id, step.value);
				if (stopWhen?.(step.value)) return { rows: [...found.values()], complete: true };
			}
			if (before.done || after.done) return { rows: [...found.values()], complete: true };
		}
	} finally {
		await Promise.all([startsBefore.return?.(), endsAfter.return?.()]);
	}
	return { rows: [...found.values()], complete: false };
}

/** Bookings (any status) of one villa overlapping [checkIn, checkOut). See `lockstepOverlap`. */
export async function scanOverlappingBookings(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	stopWhen?: (booking: Doc<'bookings'>) => boolean
): Promise<{ bookings: Doc<'bookings'>[]; complete: boolean }> {
	if (checkOut <= checkIn) return { bookings: [], complete: true };
	const { rows, complete } = await lockstepOverlap(
		ctx.db
			.query('bookings')
			.withIndex('by_property_checkIn', (q) => q.eq('propertyId', propertyId).lt('checkIn', checkOut))
			.order('desc')
			[Symbol.asyncIterator](),
		ctx.db
			.query('bookings')
			.withIndex('by_property_checkOut', (q) => q.eq('propertyId', propertyId).gt('checkOut', checkIn))
			[Symbol.asyncIterator](),
		(booking) => staysOverlap({ start: booking.checkIn, end: booking.checkOut }, checkIn, checkOut),
		readBudget(ctx),
		stopWhen
	);
	return { bookings: rows, complete };
}

/** Host date blocks of one villa overlapping [from, to), including mirror-less legacy ones. */
export async function scanOverlappingDateBlocks(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	from: string,
	to: string
): Promise<{ blocks: Doc<'dateBlocks'>[]; complete: boolean }> {
	if (to <= from) return { blocks: [], complete: true };
	const { rows, complete } = await lockstepOverlap(
		ctx.db
			.query('dateBlocks')
			.withIndex('by_property_start', (q) => q.eq('propertyId', propertyId).lt('start', to))
			.order('desc')
			[Symbol.asyncIterator](),
		ctx.db
			.query('dateBlocks')
			.withIndex('by_propertyId_and_end', (q) => q.eq('propertyId', propertyId).gt('end', from))
			[Symbol.asyncIterator](),
		(block) => staysOverlap(block, from, to),
		readBudget(ctx)
	);
	return { blocks: rows, complete };
}

/** Like `scanOverlappingBookings`, but throws instead of returning a partial list. */
export async function findOverlappingBookings(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	stopWhen?: (booking: Doc<'bookings'>) => boolean
): Promise<Doc<'bookings'>[]> {
	const { bookings, complete } = await scanOverlappingBookings(ctx, propertyId, checkIn, checkOut, stopWhen);
	if (!complete) {
		throw readBudget(ctx).exhausted ? new ReadBudgetExceeded() : new Error(OVERLAP_INCOMPLETE_ERROR);
	}
	return bookings;
}

/** Throws if another confirmed/completed booking overlaps the stay. */
export async function assertNoBookingOverlap(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	excludeBookingId?: Id<'bookings'>
): Promise<void> {
	const conflicts = (booking: Doc<'bookings'>) => booking._id !== excludeBookingId && blocksNewBookings(booking);
	const overlapping = await findOverlappingBookings(ctx, propertyId, checkIn, checkOut, conflicts);
	if (overlapping.some(conflicts)) throw new Error(STAY_TAKEN_ERROR);
}

/**
 * First availability row in [checkIn, checkOut) that blocks the stay. Reads every row of the
 * range (a night can have several: one per OTA feed, a host block, a booking), refusing ranges
 * with more rows than `MAX_ROWS_PER_NIGHT` per night. `ignoreBookingId` skips the booking's own hold.
 */
export async function findBlockingNight(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	ignoreBookingId?: Id<'bookings'>
): Promise<Doc<'availability'> | null> {
	const budget = readBudget(ctx);
	const maxRows = Math.max(1, nightsBetween(checkIn, checkOut)) * MAX_ROWS_PER_NIGHT;
	if (!budget.range()) throw new ReadBudgetExceeded();
	let read = 0;
	for await (const row of ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', propertyId).gte('date', checkIn).lt('date', checkOut)
		)) {
		if (++read > maxRows) throw new Error(NIGHT_ROWS_ERROR);
		if (!budget.document(row)) throw new ReadBudgetExceeded();
		if (row.status === 'available') continue;
		if (ignoreBookingId && row.bookingId === ignoreBookingId) continue;
		return row;
	}
	return null;
}

/** Every availability row of one night, refusing more than `MAX_ROWS_PER_NIGHT`. */
export async function nightRows(
	ctx: QueryCtx,
	propertyId: Id<'properties'>,
	date: string
): Promise<Doc<'availability'>[]> {
	const budget = readBudget(ctx);
	if (!budget.range()) throw new ReadBudgetExceeded();
	const rows = await ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) => q.eq('propertyId', propertyId).eq('date', date))
		.take(MAX_ROWS_PER_NIGHT + 1);
	if (rows.length > MAX_ROWS_PER_NIGHT) throw new Error(NIGHT_ROWS_ERROR);
	for (const row of rows) if (!budget.document(row)) throw new ReadBudgetExceeded();
	return rows;
}
