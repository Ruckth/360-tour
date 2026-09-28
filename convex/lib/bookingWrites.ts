import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { nightsBetween, todayIso } from './dates';
import { assertPositiveInt, assertValidEmail, assertValidIsoDate } from './validation';
import { calculateDirectQuote } from './pricing';

export type BookingSource = 'web' | 'whatsapp' | 'messenger' | 'line' | 'instagram' | 'admin';

export type StayInput = {
	propertySlug: string;
	checkIn: string;
	checkOut: string;
	guests: number;
};

export type BookingInput = StayInput & {
	guestName: string;
	guestEmail?: string;
	guestPhone: string;
	source: BookingSource;
	chatSessionId?: Id<'chatSessions'>;
};

export async function loadProperty(
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
	if (property.status !== 'active') {
		throw new Error('Property is not available for booking');
	}

	return property;
}

function blocksNewBookings(booking: Doc<'bookings'>): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

/** Throws unless [checkIn, checkOut) is free of other confirmed bookings and blocked nights. */
export async function assertStayFree(
	ctx: QueryCtx | MutationCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	excludeBookingId?: Id<'bookings'>
): Promise<void> {
	const candidates = await ctx.db
		.query('bookings')
		.withIndex('by_property_checkIn', (q) =>
			q.eq('propertyId', propertyId).lt('checkIn', checkOut)
		)
		.take(500);
	if (candidates.some((b) => b._id !== excludeBookingId && blocksNewBookings(b) && b.checkOut > checkIn)) {
		throw new Error('These dates are no longer available. Please choose different dates.');
	}

	const inRange = await ctx.db
		.query('availability')
		.withIndex('by_property_date', (q) =>
			q.eq('propertyId', propertyId).gte('date', checkIn).lt('date', checkOut)
		)
		.take(366);
	if (inRange.some((a) => a.status !== 'available' && (!excludeBookingId || a.bookingId !== excludeBookingId))) {
		throw new Error('Some of these dates are blocked. Please choose different dates.');
	}
}

/** Validates the date pair and returns the number of nights. */
export function assertStayDates(checkIn: string, checkOut: string, { allowPastCheckIn = false } = {}): number {
	assertValidIsoDate(checkIn, 'Check-in date');
	assertValidIsoDate(checkOut, 'Check-out date');
	if (!allowPastCheckIn && checkIn < todayIso()) {
		throw new Error('Check-in date cannot be in the past');
	}
	if (checkOut <= checkIn) {
		throw new Error('Check-out must be after check-in');
	}
	const nights = nightsBetween(checkIn, checkOut);
	if (!Number.isFinite(nights) || nights <= 0) {
		throw new Error('Check-out must be after check-in');
	}
	if (nights > 365) throw new Error('A stay cannot exceed 365 nights');
	return nights;
}

export function assertCapacity(property: Doc<'properties'>, guests: number): void {
	assertPositiveInt(guests, 'Guest count');
	if (guests > property.maxGuests) {
		throw new Error(`Guest count exceeds max capacity (${property.maxGuests})`);
	}
}

/** Trims and validates guest contact details. */
export function cleanGuestDetails(input: { guestName: string; guestPhone: string; guestEmail?: string }) {
	const guestName = input.guestName.trim();
	const guestPhone = input.guestPhone.trim();
	const guestEmail = input.guestEmail?.trim() || undefined;
	if (!guestName) throw new Error('Guest name is required');
	if (!guestPhone) throw new Error('Guest phone is required');
	if (guestEmail) assertValidEmail(guestEmail);
	return { guestName, guestPhone, guestEmail };
}

/** Validates a stay (dates, capacity, overlap, blocked dates) and prices it. */
export async function quoteBookableStay(ctx: QueryCtx | MutationCtx, input: StayInput) {
	assertValidIsoDate(input.checkIn, 'Check-in date');
	assertValidIsoDate(input.checkOut, 'Check-out date');
	assertPositiveInt(input.guests, 'Guest count');

	const property = await loadProperty(ctx, input.propertySlug);
	assertCapacity(property, input.guests);
	const nights = assertStayDates(input.checkIn, input.checkOut);
	await assertStayFree(ctx, property._id, input.checkIn, input.checkOut);

	return { property, nights, quote: calculateDirectQuote(property, nights) };
}

export async function createBookingRecord(ctx: MutationCtx, input: BookingInput) {
	const { guestName, guestPhone, guestEmail } = cleanGuestDetails(input);
	const { property, nights, quote } = await quoteBookableStay(ctx, input);

	const accessToken = crypto.randomUUID();
	const bookingId = await ctx.db.insert('bookings', {
		propertyId: property._id,
		tenantId: property.tenantId,
		guestName,
		...(guestEmail ? { guestEmail } : {}),
		guestPhone,
		source: input.source,
		...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
		checkIn: input.checkIn,
		checkOut: input.checkOut,
		guests: input.guests,
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
