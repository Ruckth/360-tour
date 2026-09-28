import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { stayDates } from './dates';

type Stay = Pick<Doc<'bookings'>, 'propertyId' | 'checkIn' | 'checkOut'>;

export async function blockBookingDates(
	ctx: MutationCtx,
	booking: Stay,
	bookingId: Id<'bookings'>
): Promise<void> {
	for (const date of stayDates(booking.checkIn, booking.checkOut)) {
		const existing = await ctx.db
			.query('availability')
			.withIndex('by_property_date', (q) =>
				q.eq('propertyId', booking.propertyId).eq('date', date)
			)
			.first();

		if (existing) {
			if (
				existing.status !== 'available' &&
				existing.bookingId !== undefined &&
				existing.bookingId !== bookingId
			) {
				throw new Error('These dates are no longer available. Please choose different dates.');
			}
			if (existing.status !== 'available' && existing.bookingId === undefined) {
				throw new Error('Some of these dates are blocked. Please choose different dates.');
			}
			await ctx.db.patch(existing._id, {
				status: 'booked',
				source: 'direct',
				bookingId
			});
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
	const rows = await ctx.db.query('availability').withIndex('by_property_date', q =>
		q.eq('propertyId', booking.propertyId).gte('date', booking.checkIn).lt('date', booking.checkOut)
	).take(366);
	for (const row of rows) if (row.bookingId === booking._id) await ctx.db.delete(row._id);
}

/** Mirrors a host date block as one 'blocked' availability row per night. Throws on any conflict. */
export async function writeDateBlockRows(ctx: MutationCtx, block: Doc<'dateBlocks'>): Promise<void> {
	for (const date of stayDates(block.start, block.end)) {
		const rows = await ctx.db
			.query('availability')
			.withIndex('by_property_date', (q) => q.eq('propertyId', block.propertyId).eq('date', date))
			.take(10);
		if (rows.some((row) => row.status !== 'available' && row.dateBlockId !== block._id)) {
			throw new Error(`${date} is already booked or blocked.`);
		}
		const free = rows.find((row) => row.status === 'available');
		if (free) await ctx.db.patch(free._id, { status: 'blocked', source: 'manual', dateBlockId: block._id });
		else if (!rows.some((row) => row.dateBlockId === block._id)) {
			await ctx.db.insert('availability', {
				propertyId: block.propertyId,
				date,
				status: 'blocked',
				source: 'manual',
				dateBlockId: block._id
			});
		}
	}
}

export async function releaseDateBlockRows(ctx: MutationCtx, blockId: Id<'dateBlocks'>): Promise<void> {
	const rows = await ctx.db.query('availability').withIndex('by_dateBlockId', (q) => q.eq('dateBlockId', blockId)).take(400);
	for (const row of rows) await ctx.db.delete(row._id);
}
