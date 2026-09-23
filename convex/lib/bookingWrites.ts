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

	return property;
}

function blocksNewBookings(booking: Doc<'bookings'>): boolean {
	return booking.status === 'confirmed' || booking.status === 'completed';
}

async function assertNoOverlap(
	ctx: QueryCtx | MutationCtx,
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
	ctx: QueryCtx | MutationCtx,
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

/** Validates a stay (dates, capacity, overlap, blocked dates) and prices it. */
export async function quoteBookableStay(ctx: QueryCtx | MutationCtx, input: StayInput) {
	assertValidIsoDate(input.checkIn, 'Check-in date');
	assertValidIsoDate(input.checkOut, 'Check-out date');
	assertPositiveInt(input.guests, 'Guest count');

	const property = await loadProperty(ctx, input.propertySlug);

	if (input.guests > property.maxGuests) {
		throw new Error(`Guest count exceeds max capacity (${property.maxGuests})`);
	}

	if (input.checkIn < todayIso()) {
		throw new Error('Check-in date cannot be in the past');
	}
	if (input.checkOut <= input.checkIn) {
		throw new Error('Check-out must be after check-in');
	}

	const nights = nightsBetween(input.checkIn, input.checkOut);
	if (!Number.isFinite(nights) || nights <= 0) {
		throw new Error('Check-out must be after check-in');
	}

	await assertNoOverlap(ctx, property._id, input.checkIn, input.checkOut);
	await assertNotBlocked(ctx, property._id, input.checkIn, input.checkOut);

	return { property, nights, quote: calculateDirectQuote(property, nights) };
}

export async function createBookingRecord(ctx: MutationCtx, input: BookingInput) {
	const guestName = input.guestName.trim();
	const guestPhone = input.guestPhone.trim();
	const guestEmail = input.guestEmail?.trim() || undefined;
	if (!guestName) throw new Error('Guest name is required');
	if (!guestPhone) throw new Error('Guest phone is required');
	if (guestEmail) assertValidEmail(guestEmail);

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
