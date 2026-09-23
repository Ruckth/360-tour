import { paginationOptsValidator } from 'convex/server';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { nightsBetween } from './lib/dates';
import {
	assertPositiveInt,
	assertValidEmail,
	assertValidIsoDate
} from './lib/validation';
import { calculateDirectQuote } from './lib/pricing';
import { demoCode } from './lib/codes';
import { blockBookingDates } from './lib/availabilityWrites';
import {
	createBookingRecord,
	loadProperty,
	quoteBookableStay,
	type BookingSource
} from './lib/bookingWrites';

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
		assertValidEmail(args.guestEmail);
		return await createBookingRecord(ctx, { ...args, source: 'web' });
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
	args: {
		propertyId: v.id('properties'),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		await assertAuthenticated(ctx);
		return await ctx.db
			.query('bookings')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

// --- AI chat booking (prepare → guest says yes → confirm) ---

export const CHAT_BOOKING_TTL_MS = 15 * 60 * 1000;

const chatSourceByChannel: Record<Doc<'chatSessions'>['channel'], BookingSource> = {
	web: 'web',
	whatsapp: 'whatsapp',
	facebook: 'messenger',
	line: 'line',
	instagram: 'instagram'
};

async function loadChatSession(ctx: QueryCtx | MutationCtx, sessionId: Id<'chatSessions'>) {
	const session = await ctx.db.get(sessionId);
	if (!session) throw new Error('Session not found');
	return session;
}

/** Whether the next message in this chat should be routed to the AI booking flow. */
export const isChatBookingFlowActive = query({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		return Boolean(session?.bookingFlowAt && Date.now() - session.bookingFlowAt < CHAT_BOOKING_TTL_MS);
	}
});

export const touchChatBookingFlow = internalMutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.sessionId, { bookingFlowAt: Date.now() });
	}
});

export const prepareChatBooking = internalMutation({
	args: {
		sessionId: v.id('chatSessions'),
		propertySlug: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		guestName: v.string(),
		guestPhone: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		// WhatsApp numbers are verified by WhatsApp, so never trust a model-supplied phone there.
		const guestPhone = (
			session.channel === 'whatsapp' ? session.visitorPhone : args.guestPhone ?? session.visitorPhone
		)?.trim();
		if (!guestPhone) throw new Error("Ask the guest for their phone number before preparing the booking.");
		const guestName = args.guestName.trim() || session.visitorName?.trim();
		if (!guestName) throw new Error("Ask the guest for their name before preparing the booking.");

		const { property, nights, quote } = await quoteBookableStay(ctx, args);
		const now = Date.now();
		await ctx.db.patch(args.sessionId, {
			bookingFlowAt: now,
			pendingBookingQuote: {
				propertySlug: property.slug,
				checkIn: args.checkIn,
				checkOut: args.checkOut,
				guests: args.guests,
				guestName,
				guestPhone,
				nights,
				total: quote.directTotal,
				currency: quote.currency,
				createdAt: now
			}
		});

		return {
			property: property.name,
			checkIn: args.checkIn,
			checkOut: args.checkOut,
			nights,
			guests: args.guests,
			guestName,
			guestPhone,
			total: quote.directTotal,
			currency: quote.currency
		};
	}
});

export const confirmChatBooking = internalMutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		const pending = session.pendingBookingQuote;
		if (!pending) throw new Error('No prepared booking. Call prepare_booking first.');

		// Already confirmed (e.g. the guest said "yes" twice): return the same booking.
		const existing = pending.bookingId ? await ctx.db.get(pending.bookingId) : null;
		if (existing) {
			return { bookingId: existing._id, accessToken: existing.accessToken ?? '', confirmationCode: existing.confirmationCode ?? '', total: existing.total, currency: existing.currency, alreadyConfirmed: true };
		}

		if (Date.now() - pending.createdAt > CHAT_BOOKING_TTL_MS) {
			await ctx.db.patch(args.sessionId, { pendingBookingQuote: undefined });
			throw new Error('The prepared booking expired. Call prepare_booking again.');
		}

		const { bookingId, accessToken } = await createBookingRecord(ctx, {
			propertySlug: pending.propertySlug,
			checkIn: pending.checkIn,
			checkOut: pending.checkOut,
			guests: pending.guests,
			guestName: pending.guestName,
			guestPhone: pending.guestPhone,
			...(session.visitorEmail ? { guestEmail: session.visitorEmail } : {}),
			source: chatSourceByChannel[session.channel],
			chatSessionId: args.sessionId
		});
		const confirmationCode = demoCode('CONF', bookingId as string);
		await ctx.db.patch(bookingId, { confirmationCode });
		await ctx.db.patch(args.sessionId, { pendingBookingQuote: { ...pending, bookingId } });

		return { bookingId, accessToken, confirmationCode, total: pending.total, currency: pending.currency, alreadyConfirmed: false };
	}
});
