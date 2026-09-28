import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { markBookingPaid, queueBookingEmails, queueCancellationEmail } from './bookings';
import { requireAdmin } from './lib/adminAuth';
import {
	blockBookingDates,
	releaseBookingDates,
	releaseDateBlockRows,
	writeDateBlockRows
} from './lib/availabilityWrites';
import {
	assertCapacity,
	assertStayDates,
	assertStayFree,
	cleanGuestDetails,
	createBookingRecord
} from './lib/bookingWrites';
import { demoCode } from './lib/codes';
import { calculateDirectQuote } from './lib/pricing';
import { assertValidIsoDate } from './lib/validation';

const MAX_RANGE_BOOKINGS = 500;
const SEARCH_SCAN_LIMIT = 1000;

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

/** Villas, bookings, OTA blocks and host date blocks overlapping [from, to) for the admin calendar. */
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

		// OTA/iCal nights (read-only here) and host date blocks (editable ranges).
		const blocks: Array<{ propertyId: Id<'properties'>; date: string; source: string }> = [];
		const dateBlocks: Doc<'dateBlocks'>[] = [];
		for (const property of properties) {
			const rows = await ctx.db
				.query('availability')
				.withIndex('by_property_date', (q) =>
					q.eq('propertyId', property._id).gte('date', args.from).lt('date', args.to)
				)
				.take(400);
			for (const row of rows) {
				if (row.status !== 'available' && !row.bookingId && !row.dateBlockId) {
					blocks.push({ propertyId: row.propertyId, date: row.date, source: row.source });
				}
			}
			const hostBlocks = await ctx.db
				.query('dateBlocks')
				.withIndex('by_property_start', (q) => q.eq('propertyId', property._id).lt('start', args.to))
				.order('desc')
				.take(100);
			dateBlocks.push(...hostBlocks.filter((block) => block.end > args.from));
		}

		return {
			properties: properties.map((p) => ({
				_id: p._id,
				slug: p.slug,
				name: p.name,
				maxGuests: p.maxGuests,
				status: p.status,
				pricePerNight: p.pricePerNight,
				directDiscountPercent: p.directDiscountPercent,
				currency: p.currency
			})),
			bookings: bookings.map(toAdminBooking),
			blocks,
			dateBlocks: dateBlocks.map(({ _id, propertyId, start, end, reason }) => ({ _id, propertyId, start, end, reason }))
		};
	}
});

/** Full booking detail for the admin sheet, including the private pay-link token while unpaid. */
export const getForAdmin = query({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) return null;
		const property = await ctx.db.get(booking.propertyId);
		const payable = booking.paymentStatus === 'pending' && booking.status !== 'cancelled';
		return {
			...toAdminBooking(booking),
			propertyName: property?.name ?? 'Unknown villa',
			subtotal: booking.subtotal,
			discountAmount: booking.discountAmount,
			amountPaid: booking.paymentStatus === 'paid' ? (booking.amountPaid ?? booking.total) : undefined,
			paidAt: booking.paidAt,
			refundedAt: booking.refundedAt,
			hasStripePayment: Boolean(booking.stripePaymentIntentId),
			checkoutLive: (booking.stripeCheckoutExpiresAt ?? 0) > Date.now(),
			adminNotes: booking.adminNotes,
			accessToken: payable ? booking.accessToken : undefined
		};
	}
});

/** Guest search by name, phone, email or confirmation code over the most recent bookings. */
export const searchBookings = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const text = args.query.trim().toLowerCase();
		if (text.length < 2) return [];
		const digits = text.replace(/\D/g, '');
		const recent = await ctx.db.query('bookings').order('desc').take(SEARCH_SCAN_LIMIT);
		return recent
			.filter(
				(b) =>
					b.guestName.toLowerCase().includes(text) ||
					(b.guestEmail ?? '').toLowerCase().includes(text) ||
					(b.confirmationCode ?? '').toLowerCase().includes(text) ||
					(digits.length >= 3 && b.guestPhone.replace(/\D/g, '').includes(digits))
			)
			.slice(0, 20)
			.map(toAdminBooking);
	}
});

export const updateBooking = mutation({
	args: {
		bookingId: v.id('bookings'),
		action: v.union(v.literal('confirm'), v.literal('cancel'), v.literal('markPaid')),
		refundRecorded: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) throw new Error('Booking not found');

		if (args.action === 'cancel') {
			if (booking.paymentStatus === 'paid' && args.refundRecorded !== true) {
				throw new Error('Paid booking: record the refund to cancel');
			}
			if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
				throw new Error('The Stripe checkout is active. Wait for it to expire before cancelling.');
			}
			await ctx.db.patch(booking._id, {
				status: 'cancelled',
				...(booking.paymentStatus === 'paid' ? { paymentStatus: 'refunded' as const, refundedAt: Date.now() } : {})
			});
			await queueCancellationEmail(ctx, booking);
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
		await queueBookingEmails(ctx, booking);
	}
});

export const resendBookingEmails = mutation({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking || booking.status !== 'confirmed') throw new Error('Only confirmed bookings can be emailed');
		await queueBookingEmails(ctx, booking, true);
	}
});

/** Manual / phone booking entered by the host. Pending ones are exempt from the 24h expiry. */
export const createBooking = mutation({
	args: {
		propertySlug: v.string(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		/** Confirmed bookings hold the dates straight away (pay later / on arrival). */
		confirmed: v.optional(v.boolean())
	},
	handler: async (ctx, { confirmed, ...args }) => {
		await requireAdmin(ctx);
		const { bookingId } = await createBookingRecord(ctx, { ...args, source: 'admin' });
		await ctx.db.patch(bookingId, { confirmationCode: demoCode('CONF', bookingId as string) });
		if (confirmed) {
			const booking = (await ctx.db.get(bookingId))!;
			await blockBookingDates(ctx, booking, bookingId);
			await ctx.db.patch(bookingId, { status: 'confirmed' });
			await queueBookingEmails(ctx, booking);
		}
		return bookingId;
	}
});

/**
 * Changes a booking's villa, dates, guest count or guest details in one transaction.
 * The price is recomputed only when the stay (villa or dates) changes. Paid bookings keep
 * what was paid, so any difference shows as a balance due or a credit.
 */
export const editBooking = mutation({
	args: {
		bookingId: v.id('bookings'),
		propertyId: v.id('properties'),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) throw new Error('Booking not found');
		if (booking.status === 'cancelled' || booking.paymentStatus === 'refunded') {
			throw new Error('Cancelled or refunded bookings are read-only.');
		}
		if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
			throw new Error('The guest has a Stripe checkout open. Wait for it to finish or expire before editing.');
		}

		const guest = cleanGuestDetails(args);
		const property = await ctx.db.get(args.propertyId);
		if (!property) throw new Error('Property not found');
		const stayChanged =
			args.propertyId !== booking.propertyId || args.checkIn !== booking.checkIn || args.checkOut !== booking.checkOut;
		if (stayChanged && property.status !== 'active') throw new Error('Property is not available for booking');
		assertCapacity(property, args.guests);
		// An in-house guest can still extend or shorten their stay.
		const nights = assertStayDates(args.checkIn, args.checkOut, { allowPastCheckIn: args.checkIn === booking.checkIn });

		const holdsDates = booking.status === 'confirmed' || booking.status === 'completed';
		await releaseBookingDates(ctx, booking);
		if (stayChanged || holdsDates) {
			await assertStayFree(ctx, args.propertyId, args.checkIn, args.checkOut, booking._id);
		}
		if (holdsDates) await blockBookingDates(ctx, args, booking._id);

		const quote = stayChanged ? calculateDirectQuote(property, nights) : null;
		await ctx.db.patch(booking._id, {
			propertyId: args.propertyId,
			tenantId: property.tenantId,
			checkIn: args.checkIn,
			checkOut: args.checkOut,
			guests: args.guests,
			nights,
			...guest,
			...(quote
				? { subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.directTotal, currency: quote.currency }
				: {}),
			// Paid: freeze what was paid. Unpaid: drop the expired checkout so a new amount can be charged.
			...(booking.paymentStatus === 'paid'
				? { amountPaid: booking.amountPaid ?? booking.total }
				: { stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined })
		});

		if (guest.guestEmail && (stayChanged || args.guests !== booking.guests)) {
			await ctx.scheduler.runAfter(0, internal.emails.sendBookingUpdated, { bookingId: booking._id });
		}
	}
});

/** Removes a test or mistaken booking. Anything that involved money must be cancelled instead. */
export const deleteBooking = mutation({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) throw new Error('Booking not found');
		const touchedMoney =
			booking.paymentStatus === 'paid' ||
			booking.paymentStatus === 'refunded' ||
			booking.paidAt !== undefined ||
			booking.stripePaymentIntentId !== undefined;
		if ((booking.status !== 'pending' && booking.status !== 'cancelled') || touchedMoney) {
			throw new Error('Only unpaid pending or cancelled bookings can be deleted.');
		}
		if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
			throw new Error('The guest has a Stripe checkout open. Wait for it to expire before deleting.');
		}

		await releaseBookingDates(ctx, booking);
		const session = booking.chatSessionId ? await ctx.db.get(booking.chatSessionId) : null;
		if (session?.pendingBookingQuote?.bookingId === booking._id) {
			await ctx.db.patch(session._id, { pendingBookingQuote: undefined });
		}
		if (session?.pendingCancellation?.bookingId === booking._id) {
			await ctx.db.patch(session._id, { pendingCancellation: undefined });
		}
		const appointments = await ctx.db
			.query('serviceAppointments')
			.withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
			.take(50);
		for (const appointment of appointments) await ctx.db.patch(appointment._id, { bookingId: undefined });
		await ctx.db.delete(booking._id);
	}
});

export const updateNotes = mutation({
	args: { bookingId: v.id('bookings'), notes: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.bookingId))) throw new Error('Booking not found');
		const notes = args.notes.trim();
		if (notes.length > 2000) throw new Error('Notes are limited to 2,000 characters.');
		await ctx.db.patch(args.bookingId, { adminNotes: notes || undefined });
	}
});

// Host date blocks (owner stay, maintenance). `end` is exclusive: the first free night.

const dateBlockArgs = {
	propertyId: v.id('properties'),
	start: v.string(),
	end: v.string(),
	reason: v.string()
};

async function validateDateBlock(
	ctx: MutationCtx,
	args: { propertyId: Id<'properties'>; start: string; end: string; reason: string }
) {
	if (!(await ctx.db.get(args.propertyId))) throw new Error('Property not found');
	assertStayDates(args.start, args.end, { allowPastCheckIn: true });
	const reason = args.reason.trim();
	if (!reason) throw new Error('Add a reason for the block.');
	if (reason.length > 200) throw new Error('Keep the reason under 200 characters.');
	await assertStayFree(ctx, args.propertyId, args.start, args.end);
	return reason;
}

export const addDateBlock = mutation({
	args: dateBlockArgs,
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const reason = await validateDateBlock(ctx, args);
		const blockId = await ctx.db.insert('dateBlocks', { ...args, reason, createdAt: Date.now() });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
		return blockId;
	}
});

export const updateDateBlock = mutation({
	args: { blockId: v.id('dateBlocks'), ...dateBlockArgs },
	handler: async (ctx, { blockId, ...args }) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(blockId))) throw new Error('Block not found');
		await releaseDateBlockRows(ctx, blockId);
		const reason = await validateDateBlock(ctx, args);
		await ctx.db.patch(blockId, { ...args, reason });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
	}
});

export const removeDateBlock = mutation({
	args: { blockId: v.id('dateBlocks') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		await releaseDateBlockRows(ctx, args.blockId);
		if (await ctx.db.get(args.blockId)) await ctx.db.delete(args.blockId);
	}
});
