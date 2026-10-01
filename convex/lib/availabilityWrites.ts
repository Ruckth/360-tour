import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { nightsBetween, stayDates } from './dates';
import { readBudget } from './readBudget';
import {
	assertNoBookingOverlap,
	MAX_ROWS_PER_NIGHT,
	NIGHT_ROWS_ERROR,
	nightRows,
	STAY_BLOCKED_ERROR,
	STAY_TAKEN_ERROR
} from './stayOverlap';

type Stay = Pick<Doc<'bookings'>, 'propertyId' | 'checkIn' | 'checkOut'>;

/** Host blocks and stays are at most 365 nights (assertStayDates), so one has at most this many rows. */
const MAX_BLOCK_ROWS = 366;

/**
 * The one place a booking's nights are validated and held, in the caller's transaction: no other
 * confirmed/completed booking may overlap (checked on the bookings table, so a booking whose nights
 * were never mirrored still counts) and no night may have another booking's or a block's row.
 * Payment confirmation, checkout holds, admin confirm/create/edit all go through here.
 */
export async function blockBookingDates(
	ctx: MutationCtx,
	booking: Stay,
	bookingId: Id<'bookings'>
): Promise<void> {
	await assertNoBookingOverlap(ctx, booking.propertyId, booking.checkIn, booking.checkOut, bookingId);
	const dates = stayDates(booking.checkIn, booking.checkOut);
	const holds: Array<{ date: string; existing: Doc<'availability'> | null }> = [];
	// Check every night before writing any, so a conflict leaves nothing half-held.
	for (const date of dates) {
		let own: Doc<'availability'> | null = null;
		let free: Doc<'availability'> | null = null;
		for (const row of await nightRows(ctx, booking.propertyId, date)) {
			if (row.bookingId === bookingId) own = row;
			else if (row.status === 'available') free ??= row;
			else if (row.bookingId !== undefined) throw new Error(STAY_TAKEN_ERROR);
			else throw new Error(STAY_BLOCKED_ERROR);
		}
		holds.push({ date, existing: own ?? free });
	}
	for (const { date, existing } of holds) {
		if (existing) {
			if (existing.status !== 'booked' || existing.source !== 'direct' || existing.bookingId !== bookingId) {
				await ctx.db.patch(existing._id, { status: 'booked', source: 'direct', bookingId });
			}
		} else {
			await ctx.db.insert('availability', {
				propertyId: booking.propertyId,
				date,
				status: 'booked',
				source: 'direct',
				bookingId
			});
		}
	}
}

export async function releaseBookingDates(ctx: MutationCtx, booking: Doc<'bookings'>): Promise<void> {
	// Every row in range: other feeds' rows on the same nights must not hide this booking's.
	const maxRows = Math.max(1, nightsBetween(booking.checkIn, booking.checkOut)) * MAX_ROWS_PER_NIGHT;
	let read = 0;
	for await (const row of ctx.db.query('availability').withIndex('by_property_date', (q) =>
		q.eq('propertyId', booking.propertyId).gte('date', booking.checkIn).lt('date', booking.checkOut)
	)) {
		if (++read > maxRows) throw new Error(NIGHT_ROWS_ERROR);
		if (row.bookingId === booking._id) await ctx.db.delete(row._id);
	}
}

/** Mirrors a host date block as one 'blocked' availability row per night. Throws on any conflict. */
export async function writeDateBlockRows(
	ctx: MutationCtx,
	block: Doc<'dateBlocks'>
): Promise<void> {
	for (const date of stayDates(block.start, block.end)) {
		let free: Doc<'availability'> | null = null;
		let written = false;
		for (const row of await nightRows(ctx, block.propertyId, date)) {
			if (row.dateBlockId === block._id) written = true;
			else if (row.status !== 'available') throw new Error(`${date} is already booked or blocked.`);
			else free ??= row;
		}
		if (written) continue;
		if (free) await ctx.db.patch(free._id, { status: 'blocked', source: 'manual', dateBlockId: block._id });
		else {
			await ctx.db.insert('availability', {
				propertyId: block.propertyId,
				date,
				status: 'blocked',
				source: 'manual',
				dateBlockId: block._id
			});
		}
	}
	readBudget(ctx).assert();
}

export async function releaseDateBlockRows(ctx: MutationCtx, blockId: Id<'dateBlocks'>): Promise<void> {
	const rows = await ctx.db
		.query('availability')
		.withIndex('by_dateBlockId', (q) => q.eq('dateBlockId', blockId))
		.take(MAX_BLOCK_ROWS + 1);
	// A block writes at most one row per night; more means data this code didn't write.
	if (rows.length > MAX_BLOCK_ROWS) throw new Error('This block has more nights than expected. Contact support to remove it.');
	for (const row of rows) await ctx.db.delete(row._id);
}
