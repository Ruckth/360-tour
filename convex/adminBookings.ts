import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { markBookingPaid } from './bookings';
import { requireAdmin } from './lib/adminAuth';
import { blockBookingDates } from './lib/availabilityWrites';
import { createBookingRecord } from './lib/bookingWrites';
import { demoCode } from './lib/codes';
import { assertValidIsoDate } from './lib/validation';

const MAX_RANGE_BOOKINGS = 500;

function toAdminBooking(booking: Doc<'bookings'>) {
	return {
		_id: booking._id,
		propertyId: booking.propertyId,
		guestName: booking.guestName,
		guestPhone: booking.guestPhone,
		guestEmail: booking.guestEmail,
		checkIn: booking.checkIn,
		checkOut: booking.checkOut,
		guests: booking.guests,
		nights: booking.nights,
		total: booking.total,
		currency: booking.currency,
		status: booking.status,
		paymentStatus: booking.paymentStatus,
		paymentMethod: booking.paymentMethod,
		source: booking.source ?? 'web',
		chatSessionId: booking.chatSessionId,
		confirmationCode: booking.confirmationCode,
		createdAt: booking.createdAt
	};
}

export type AdminBooking = ReturnType<typeof toAdminBooking>;

/** Villas, bookings and host/OTA blocks overlapping [from, to) for the admin calendar. */
export const listForAdmin = query({
	args: { from: v.string(), to: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		assertValidIsoDate(args.from, 'From date');
		assertValidIsoDate(args.to, 'To date');

		const properties = await ctx.db.query('properties').take(100);

		const bookings = (
			await ctx.db
				.query('bookings')
				.withIndex('by_checkIn', (q) => q.lt('checkIn', args.to))
				.order('desc')
				.take(MAX_RANGE_BOOKINGS)
		).filter((b) => b.checkOut > args.from);

		const blocks: Array<{ propertyId: Id<'properties'>; date: string; source: string }> = [];
		for (const property of properties) {
			const rows = await ctx.db
				.query('availability')
				.withIndex('by_property_date', (q) =>
					q.eq('propertyId', property._id).gte('date', args.from).lt('date', args.to)
				)
				.take(400);
			for (const row of rows) {
				if (row.status === 'blocked' && !row.bookingId) {
					blocks.push({ propertyId: row.propertyId, date: row.date, source: row.source });
				}
			}
		}

		return {
			properties: properties.map((p) => ({ _id: p._id, slug: p.slug, name: p.name, maxGuests: p.maxGuests })),
			bookings: bookings.map(toAdminBooking),
			blocks
		};
	}
});

async function releaseBookingDates(ctx: MutationCtx, booking: Doc<'bookings'>) {
	const rows = await ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', booking.propertyId).gte('date', booking.checkIn).lt('date', booking.checkOut)
		)
		.take(366);
	for (const row of rows) {
		if (row.bookingId === booking._id) await ctx.db.delete(row._id);
	}
}

export const updateBooking = mutation({
	args: {
		bookingId: v.id('bookings'),
		action: v.union(v.literal('confirm'), v.literal('cancel'), v.literal('markPaid'))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) throw new Error('Booking not found');

		if (args.action === 'cancel') {
			await ctx.db.patch(booking._id, { status: 'cancelled' });
			await releaseBookingDates(ctx, booking);
			return;
		}

		if (booking.status === 'cancelled') throw new Error('This booking was cancelled.');

		if (args.action === 'markPaid') {
			await markBookingPaid(ctx, booking._id, 'admin');
			return;
		}

		// Confirm without payment (e.g. pay on arrival): hold the dates.
		await blockBookingDates(ctx, booking, booking._id);
		await ctx.db.patch(booking._id, {
			status: 'confirmed',
			confirmationCode: booking.confirmationCode ?? demoCode('CONF', booking._id as string)
		});
	}
});

/** Manual / phone booking entered by the host. */
export const createBooking = mutation({
	args: {
		propertySlug: v.string(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const { bookingId } = await createBookingRecord(ctx, { ...args, source: 'admin' });
		await ctx.db.patch(bookingId, { confirmationCode: demoCode('CONF', bookingId as string) });
		return bookingId;
	}
});
