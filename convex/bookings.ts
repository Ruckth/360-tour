import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { nightsBetween, todayIso } from './lib/dates';
import {
	assertPositiveInt,
	assertValidEmail,
	assertValidIsoDate
} from './lib/validation';
import { calculateDirectQuote } from './lib/pricing';
import { demoCode } from './lib/codes';
import { blockBookingDates } from './lib/availabilityWrites';

async function assertAuthenticated(ctx: QueryCtx | MutationCtx): Promise<void> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
}

function assertBookingAccess(
	booking: Doc<'bookings'>,
	accessToken: string | undefined
): void {
	if (!booking.accessToken || accessToken !== booking.accessToken) {
		throw new Error('Booking access denied');
	}
}

function toPublicBooking(booking: Doc<'bookings'>) {
	return {
		_id: booking._id,
		checkIn: booking.checkIn,
		checkOut: booking.checkOut,
		guests: booking.guests,
		nights: booking.nights,
		subtotal: booking.subtotal,
		discountAmount: booking.discountAmount,
		total: booking.total,
		currency: booking.currency,
		paymentStatus: booking.paymentStatus,
		status: booking.status,
		confirmationCode: booking.confirmationCode,
		invoiceNumber: booking.invoiceNumber,
		receiptNumber: booking.receiptNumber
	};
}

function blocksNewBookings(booking: Doc<'bookings'>): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

async function loadProperty(
	ctx: QueryCtx | MutationCtx,
	slug: string
): Promise<Doc<'properties'>> {
	const property = await ctx.db
		.query('properties')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.first();

	if (!property) {
		throw new Error('Property not found');
	}

	return property;
}

export const quoteStay = query({
	args: {
		propertySlug: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.checkIn, 'Check-in date');
		assertValidIsoDate(args.checkOut, 'Check-out date');
		if (args.guests !== undefined) assertPositiveInt(args.guests, 'Guest count');
		if (args.checkOut <= args.checkIn) {
			throw new Error('Check-out must be after check-in');
		}

		const property = await loadProperty(ctx, args.propertySlug);
		if (args.guests !== undefined && args.guests > property.maxGuests) {
			throw new Error(`Guest count exceeds max capacity (${property.maxGuests})`);
		}

		const nights = nightsBetween(args.checkIn, args.checkOut);
		if (!Number.isFinite(nights) || nights <= 0) {
			throw new Error('Check-out must be after check-in');
		}

		return calculateDirectQuote(property, nights);
	}
});

async function assertNoOverlap(
	ctx: MutationCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string
): Promise<void> {
	const candidates = await ctx.db
		.query('bookings')
		.withIndex('by_property_checkIn', (q) =>
			q.eq('propertyId', propertyId).lt('checkIn', checkOut)
		)
		.take(500);

	const overlapping = candidates.filter(
		(b) => blocksNewBookings(b) && b.checkOut > checkIn
	);

	if (overlapping.length > 0) {
		throw new Error('These dates are no longer available. Please choose different dates.');
	}
}

async function assertNotBlocked(
	ctx: MutationCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string
): Promise<void> {
	const inRange = await ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', propertyId).gte('date', checkIn).lt('date', checkOut)
		)
		.take(366);

	const blocked = inRange.filter((a) => a.status !== 'available');

	if (blocked.length > 0) {
		throw new Error('Some of these dates are blocked. Please choose different dates.');
	}
}

async function assertPaymentStillAvailable(
	ctx: MutationCtx,
	booking: Doc<'bookings'>,
	bookingId: Id<'bookings'>
): Promise<void> {
	const inRange = await ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', booking.propertyId).gte('date', booking.checkIn).lt('date', booking.checkOut)
		)
		.take(366);

	const conflicting = inRange.filter(
		(a) => a.status !== 'available' && a.bookingId !== bookingId
	);

	if (conflicting.length > 0) {
		throw new Error('These dates are no longer available. Please choose different dates.');
	}
}

export const create = mutation({
	args: {
		propertySlug: v.string(),
		guestName: v.string(),
		guestEmail: v.string(),
		guestPhone: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number()
	},
	handler: async (ctx, args) => {
		assertValidIsoDate(args.checkIn, 'Check-in date');
		assertValidIsoDate(args.checkOut, 'Check-out date');
		assertPositiveInt(args.guests, 'Guest count');
		assertValidEmail(args.guestEmail);

		const property = await loadProperty(ctx, args.propertySlug);

		if (args.guests > property.maxGuests) {
			throw new Error(`Guest count exceeds max capacity (${property.maxGuests})`);
		}

		if (args.checkIn < todayIso()) {
			throw new Error('Check-in date cannot be in the past');
		}
		if (args.checkOut <= args.checkIn) {
			throw new Error('Check-out must be after check-in');
		}

		const nights = nightsBetween(args.checkIn, args.checkOut);
		if (!Number.isFinite(nights) || nights <= 0) {
			throw new Error('Check-out must be after check-in');
		}

		const quote = calculateDirectQuote(property, nights);

		await assertNoOverlap(ctx, property._id, args.checkIn, args.checkOut);
		await assertNotBlocked(ctx, property._id, args.checkIn, args.checkOut);

		const accessToken = crypto.randomUUID();
		const bookingId = await ctx.db.insert('bookings', {
			propertyId: property._id,
			tenantId: property.tenantId,
			guestName: args.guestName,
			guestEmail: args.guestEmail,
			guestPhone: args.guestPhone,
			checkIn: args.checkIn,
			checkOut: args.checkOut,
			guests: args.guests,
			nights,
			subtotal: quote.subtotal,
			discountAmount: quote.discountAmount,
			total: quote.directTotal,
			currency: quote.currency,
			accessToken,
			paymentStatus: 'pending',
			status: 'pending',
			createdAt: Date.now()
		});

		return { bookingId, accessToken };
	}
});

export const updatePaymentStatus = mutation({
	args: {
		bookingId: v.id('bookings'),
		paymentStatus: v.union(
			v.literal('pending'),
			v.literal('paid'),
			v.literal('failed'),
			v.literal('refunded')
		)
	},
	handler: async (ctx, args) => {
		await assertAuthenticated(ctx);
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) {
			throw new Error('Booking not found');
		}

		const update: Record<string, unknown> = {
			paymentStatus: args.paymentStatus
		};
		if (args.paymentStatus === 'paid') {
			await assertPaymentStillAvailable(ctx, booking, args.bookingId);
			update.status = 'confirmed';
			update.paidAt = Date.now();
		}
		await ctx.db.patch(args.bookingId, update);

		if (args.paymentStatus === 'paid') {
			await blockBookingDates(ctx, booking, args.bookingId);
		}
	}
});

export const markPaidFromTrustedWebhook = internalMutation({
	args: {
		bookingId: v.id('bookings'),
		paymentMethod: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) {
			throw new Error('Booking not found');
		}
		await assertPaymentStillAvailable(ctx, booking, args.bookingId);

		const bookingIdText = args.bookingId as string;
		await ctx.db.patch(args.bookingId, {
			paymentStatus: 'paid',
			status: 'confirmed',
			paidAt: booking.paidAt ?? Date.now(),
			paymentMethod: booking.paymentMethod ?? args.paymentMethod ?? 'trusted_webhook',
			confirmationCode: booking.confirmationCode ?? demoCode('CONF', bookingIdText),
			invoiceNumber: booking.invoiceNumber ?? demoCode('INV', bookingIdText),
			receiptNumber: booking.receiptNumber ?? demoCode('REC', bookingIdText)
		});

		await blockBookingDates(ctx, booking, args.bookingId);
		return await ctx.db.get(args.bookingId);
	}
});

export const getById = query({
	args: { id: v.id('bookings'), accessToken: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.id);
		if (!booking) return null;
		if (args.accessToken) {
			assertBookingAccess(booking, args.accessToken);
			return toPublicBooking(booking);
		}
		await assertAuthenticated(ctx);
		return toPublicBooking(booking);
	}
});

export const listByProperty = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await assertAuthenticated(ctx);
		return await ctx.db
			.query('bookings')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.collect();
	}
});
