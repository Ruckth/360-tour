import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { stayDates } from './dates';

export async function blockBookingDates(
	ctx: MutationCtx,
	booking: Doc<'bookings'>,
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
