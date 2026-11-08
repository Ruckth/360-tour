import { bookingsByPhone } from './lib/bookingPhone';
import { assertChatWriteAllowed, assertSameProposal } from './lib/chatWriteGuard';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
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
import { demoCode, signProposal, verifyProposal } from './lib/codes';
import { randomSecret } from './lib/displayTokens';
import { bookingHoldExpiresAt, getEffectiveSettings } from './lib/siteSettings';
import { blockBookingDates, releaseBookingDates } from './lib/availabilityWrites';
import { requireAdmin } from './lib/adminAuth';
import { internal } from './_generated/api';
import { enforceRateLimit } from './lib/rateLimit';
import {
	createBookingRecord,
	loadProperty,
	quoteBookableStay,
	type BookingSource
} from './lib/bookingWrites';
import { round2 } from './lib/billMath';
import { effectiveTime, resolveNotify, stayMoney, writeBooking } from './lib/bookingMoney';

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
		promotion: booking.promotion,
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

function assertNotCancelled(booking: Doc<'bookings'>): void {
	if (booking.status === 'cancelled') {
		throw new Error('This booking was cancelled.');
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
		guests: v.number(),
		/** Release 2: optional coupon. Throws ConvexError { code: 'coupon_unavailable', message, problem? } when it can't be used now. */
		couponCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		assertValidEmail(args.guestEmail);
		await enforceRateLimit(ctx, `booking-email:${args.guestEmail.trim().toLowerCase()}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, `booking-phone:${args.guestPhone.trim()}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, 'booking:global', 100, 60 * 60 * 1000);
		return await createBookingRecord(ctx, { ...args, source: 'web' });
	}
});

/**
 * A live stay a full provider refund marked `refunded` with its money written out explicitly:
 * gross `amountPaid` and an equal `amountRefunded`. Unlike a legacy refunded flag (no refund
 * amount), its balance is provable, so only what it still owes beyond the waived provider charge
 * may be collected. New provider refunds no longer write this state on live stays.
 */
export function isDocumentedLiveRefund(booking: Doc<'bookings'>) {
	return booking.status !== 'cancelled' && booking.paymentStatus === 'refunded' &&
		booking.amountPaid !== undefined && booking.amountRefunded !== undefined &&
		round2(booking.amountRefunded) === round2(booking.amountPaid);
}

/**
 * The Stripe payment recorded before payments were itemised, when it is provable: either captured
 * when the stay's first itemised payment was written, or (no itemised payment yet) the stay's own
 * Stripe PaymentIntent and gross. Provider evidence must still match its amount exactly.
 */
export function legacyStripeCharge(booking: Doc<'bookings'>, hasItemisedPayments: boolean) {
	if (booking.legacyStripePaymentIntentId !== undefined && booking.legacyStripeGross !== undefined) {
		return { paymentIntentId: booking.legacyStripePaymentIntentId, gross: booking.legacyStripeGross, captured: true };
	}
	const gross = stayMoney(booking).gross;
	if (hasItemisedPayments || booking.paymentMethod !== 'stripe' || !booking.stripePaymentIntentId || gross <= 0) return null;
	return { paymentIntentId: booking.stripePaymentIntentId, gross, captured: false };
}

export type StayPaymentInput = {
	origin: 'manual' | 'pos' | 'online';
	method: Doc<'bookingPayments'>['method'];
	/** Admin email, or `system:<provider>`. */
	actor: string;
	/** The legacy `bookings.paymentMethod` label written when it is the first payment ('admin', 'pos', 'stripe'). */
	legacyMethod: string;
	/** Business date the money was received; defaults to now. */
	effectiveAt?: number;
	billId?: Id<'bills'>;
	idempotencyKey?: string;
	note?: string;
	/** Undefined: default (online always; staff paths per lib/bookingMoney resolveNotify). */
	notifyGuest?: boolean;
	/** The amount staff reviewed; refused if the stay now owes something else. */
	expectedAmount?: number;
};

/**
 * Records money received for everything the stay still owes, confirms it and holds its nights, in
 * the caller's transaction. Writes a bookingPayments row, adds it to the gross `amountPaid` (so
 * earlier deposits and recorded refunds stay counted) and appends the booking history. A stay that
 * owes nothing is left alone and returns `paymentId: null`.
 */
export async function recordStayPayment(ctx: MutationCtx, bookingId: Id<'bookings'>, input: StayPaymentInput) {
	const booking = await ctx.db.get(bookingId);
	if (!booking) {
		throw new Error('Booking not found');
	}
	assertNotCancelled(booking);
	if (booking.paymentStatus === 'failed' || (booking.paymentStatus === 'refunded' && !isDocumentedLiveRefund(booking))) {
		throw new Error('Reopen this booking before recording a payment on it.');
	}
	if (input.origin !== 'online' && (booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
		throw new Error('An active Stripe checkout must expire before changing this booking manually.');
	}
	const money = stayMoney(booking);
	if (input.expectedAmount !== undefined && round2(input.expectedAmount) !== money.owed) {
		throw new Error(`This stay now owes ${money.owed}, not ${round2(input.expectedAmount)}. Review the balance and try again.`);
	}
	if (money.owed <= 0) return { booking, paymentId: null };
	// Validates (no overlapping confirmed booking, no other hold or block) and holds the nights in
	// this transaction; a conflict throws before anything is marked paid.
	await blockBookingDates(ctx, booking, bookingId);

	// The first itemised payment keeps the provable legacy Stripe payment's identity and amount, so
	// a later refund or completion redelivery of it still reconciles (a later online payment
	// replaces stripePaymentIntentId).
	const hasItemised = Boolean(await ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', bookingId)).first());
	const legacy = legacyStripeCharge(booking, hasItemised);
	const legacyEvidence = legacy && !legacy.captured
		? { legacyStripePaymentIntentId: legacy.paymentIntentId, legacyStripeGross: legacy.gross }
		: {};

	const now = Date.now();
	const effectiveAt = effectiveTime(input.effectiveAt, now);
	const paymentId = await ctx.db.insert('bookingPayments', {
		bookingId, origin: input.origin, amount: money.owed, currency: booking.currency, method: input.method,
		...(input.billId ? { billId: input.billId } : {}),
		effectiveAt, recordedAt: now, recordedBy: input.actor,
		...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		...(input.note ? { note: input.note } : {}),
		refunded: 0, status: 'recorded'
	});
	const bookingIdText = bookingId as string;
	const updated = await writeBooking(ctx, booking, {
		paymentStatus: 'paid',
		status: 'confirmed',
		// The first payment's business date; a later balance payment keeps it.
		paidAt: booking.paymentStatus === 'paid' ? (booking.paidAt ?? effectiveAt) : effectiveAt,
		// Paid in full: a deposit taken earlier is part of the total, not on top of it.
		amountPaid: round2(money.gross + money.owed),
		paymentMethod: booking.paymentMethod ?? input.legacyMethod,
		confirmationCode: booking.confirmationCode ?? demoCode('CONF', bookingIdText),
		invoiceNumber: booking.invoiceNumber ?? demoCode('INV', bookingIdText),
		receiptNumber: booking.receiptNumber ?? demoCode('REC', bookingIdText),
		...legacyEvidence
	}, {
		actor: input.actor, kind: 'payment_recorded', effectiveAt,
		...(input.note ? { reason: input.note } : {}),
		details: {
			paymentId, origin: input.origin, method: input.method, amount: money.owed, ...(input.billId ? { billId: input.billId } : {}),
			...('legacyStripeGross' in legacyEvidence ? { legacyStripeGross: legacyEvidence.legacyStripeGross } : {})
		}
	});

	// The guest started an online payment themselves, so it is always confirmed to them.
	const notify = input.origin === 'online' ? (input.notifyGuest ?? true) : resolveNotify(input.notifyGuest, booking);
	if (notify) await queueBookingEmails(ctx, booking);
	return { booking: updated, paymentId };
}

/**
 * Marks what the stay owes paid. Kept for the online-payment and legacy callers: `stripe` and other
 * providers are online payments (and a repeat delivery is a no-op), `admin` is the legacy manual
 * "Mark paid" (method not recorded), `pos` a settled order.
 */
export async function markBookingPaid(ctx: MutationCtx, bookingId: Id<'bookings'>, paymentMethod: string, options: Partial<Omit<StayPaymentInput, 'legacyMethod'>> = {}) {
	const origin = options.origin ?? (paymentMethod === 'admin' ? 'manual' : paymentMethod === 'pos' ? 'pos' : 'online');
	if (origin === 'online') {
		const booking = await ctx.db.get(bookingId);
		if (booking?.paymentStatus === 'paid') return booking;
	}
	const method = options.method ?? (origin === 'manual' ? 'unrecorded' : origin === 'pos' ? 'order' : paymentMethod === 'stripe' ? 'stripe' : 'provider');
	const { booking } = await recordStayPayment(ctx, bookingId, {
		...options, origin, method, actor: options.actor ?? `system:${paymentMethod}`, legacyMethod: paymentMethod
	});
	return booking;
}

export async function queueBookingEmails(ctx: MutationCtx, booking: Doc<'bookings'>, force = false) {
	const bookingId = booking._id;
	if (force || !booking.confirmationEmailsQueuedAt) {
		const property = await ctx.db.get(booking.propertyId);
		const details = {
			guestName: booking.guestName,
			propertyName: property?.name ?? 'Your stay',
			checkIn: booking.checkIn,
			checkOut: booking.checkOut,
			nights: booking.nights,
			guests: booking.guests,
			total: booking.total,
			currency: booking.currency
		};
		await ctx.db.patch(bookingId, { confirmationEmailsQueuedAt: Date.now() });
		if (booking.guestEmail) {
			await ctx.scheduler.runAfter(0, internal.emails.sendBookingConfirmation, {
				...details,
				guestEmail: booking.guestEmail
			});
		}
		await ctx.scheduler.runAfter(0, internal.emails.sendOwnerNotification, {
			...details,
			guestEmail: booking.guestEmail ?? '',
			guestPhone: booking.guestPhone
		});
	}
}

export async function queueCancellationEmail(ctx: MutationCtx, booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled' || booking.cancellationEmailQueuedAt || !booking.guestEmail?.trim()) return;
	await ctx.db.patch(booking._id, { cancellationEmailQueuedAt: Date.now() });
	await ctx.scheduler.runAfter(0, internal.emails.sendCancellation, { bookingId: booking._id });
}

export const getLifecycleEmailDetails = internalQuery({
	args: {
		bookingId: v.id('bookings'),
		kind: v.union(v.literal('cancellation'), v.literal('preArrival'), v.literal('review'), v.literal('updated'))
	},
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		if (!booking?.guestEmail?.trim()) return null;
		if (args.kind === 'cancellation' && (booking.status !== 'cancelled' || !booking.cancellationEmailQueuedAt)) return null;
		// A historical entry recorded without telling the guest gets no automatic lifecycle emails.
		if ((args.kind === 'preArrival' || args.kind === 'review') && booking.guestEmailsOff) return null;
		if (args.kind === 'preArrival' && (booking.status !== 'confirmed' || !booking.preArrivalEmailQueuedAt)) return null;
		if (args.kind === 'review' && (booking.status !== 'confirmed' || !booking.reviewEmailQueuedAt)) return null;
		if (args.kind === 'updated' && booking.status === 'cancelled') return null;
		const property = await ctx.db.get(booking.propertyId);
		return {
			guestName: booking.guestName,
			guestEmail: booking.guestEmail,
			propertyName: property?.name ?? 'Your stay',
			checkIn: booking.checkIn,
			checkOut: booking.checkOut,
			guests: booking.guests,
			total: booking.total,
			currency: booking.currency
		};
	}
});

export const markPaidFromTrustedWebhook = internalMutation({
	args: {
		bookingId: v.id('bookings'),
		paymentMethod: v.optional(v.string())
	},
	handler: async (ctx, args) =>
		await markBookingPaid(ctx, args.bookingId, args.paymentMethod ?? 'trusted_webhook')
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
		await requireAdmin(ctx);
		return toPublicBooking(booking);
	}
});

export const listByProperty = query({
	args: {
		propertyId: v.id('properties'),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await ctx.db
			.query('bookings')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

// --- AI chat booking (prepare → confirm in chat or pay page) ---

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
		return Boolean(session?.bookingFlowAt && Date.now() - session.bookingFlowAt < (await getEffectiveSettings(ctx)).bookingRules.chatQuoteValidityMinutes * 60_000);
	}
});

export const touchChatBookingFlow = internalMutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.sessionId, { bookingFlowAt: Date.now() });
	}
});

/** Invalidate the old draft even when a replacement tool call later fails parsing or validation. */
export const invalidateChatProposal = internalMutation({
	args: { sessionId: v.id('chatSessions'), kind: v.union(v.literal('villa'), v.literal('service')), deadlineAt: v.number() },
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		assertChatWriteAllowed(session, args.deadlineAt);
		await ctx.db.patch(args.sessionId, args.kind === 'villa' ? { pendingBookingQuote: undefined } : { pendingServiceQuote: undefined });
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
		guestPhone: v.optional(v.string()),
		deadlineAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		assertChatWriteAllowed(session, args.deadlineAt);
		// WhatsApp numbers are verified by WhatsApp, so never trust a model-supplied phone there.
		const guestPhone = (
			session.channel === 'whatsapp' ? session.visitorPhone : (args.guestPhone ?? session.visitorPhone)
		)?.trim();
		if (!guestPhone) throw new Error('Ask the guest for their phone number before preparing the booking.');
		const guestName = args.guestName.trim() || session.visitorName?.trim();
		if (!guestName) throw new Error('Ask the guest for their name before preparing the booking.');

		const { property, nights, quote } = await quoteBookableStay(ctx, args);
		const now = Date.now();
		const { bookingRules } = await getEffectiveSettings(ctx);
		const proposalId = crypto.randomUUID();
		const confirmSecret = randomSecret();
		const expiresAt = now + bookingRules.chatQuoteValidityMinutes * 60_000;
		const payload = `${args.sessionId}.${proposalId}.${expiresAt}`;
		const confirmToken = `${payload}.${await signProposal(payload, confirmSecret)}`;
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
				createdAt: now,
				proposalId,
				confirmSecret,
				expiresAt
			}
		});

		return {
			confirmToken,
			expiresAt,
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

async function confirmPreparedBooking(
	ctx: MutationCtx,
	args: { sessionId: Id<'chatSessions'>; deadlineAt?: number; expectedProposal?: string; byGuest?: boolean }
) {
	const session = await loadChatSession(ctx, args.sessionId);
	// The guest pressing Confirm & pay is not an AI write, so a staff takeover does not block it.
	if (!args.byGuest) assertChatWriteAllowed(session, args.deadlineAt);
	const pending = session.pendingBookingQuote;
	assertSameProposal(pending, args.expectedProposal);
	if (!pending) throw new Error('No prepared booking. Call prepare_booking first.');

	// Already confirmed (e.g. the guest said "yes" twice): return the same booking.
	const existing = pending.bookingId ? await ctx.db.get(pending.bookingId) : null;
	if (existing) {
		if (existing.status === 'cancelled')
			throw new Error('That booking has been cancelled. Prepare a new booking if the guest requests one.');
		return {
			bookingId: existing._id,
			accessToken: existing.accessToken ?? '',
			confirmationCode: existing.confirmationCode ?? '',
			property: (await ctx.db.get(existing.propertyId))?.name ?? 'Villa',
			checkIn: existing.checkIn,
			checkOut: existing.checkOut,
			guests: existing.guests,
			nights: existing.nights,
			total: existing.total,
			currency: existing.currency,
			paymentStatus: existing.paymentStatus,
			alreadyConfirmed: true
		};
	}

	if (
		Date.now() >=
		(pending.expiresAt ??
			pending.createdAt + (await getEffectiveSettings(ctx)).bookingRules.chatQuoteValidityMinutes * 60_000)
	) {
		await ctx.db.patch(args.sessionId, { pendingBookingQuote: undefined });
		throw new Error('The prepared booking expired. Call prepare_booking again.');
	}

	const currentQuote = await quoteBookableStay(ctx, pending);
	if (currentQuote.quote.directTotal !== pending.total || currentQuote.quote.currency !== pending.currency) {
		throw new Error('The villa price changed. Prepare a new quote and ask the guest to confirm it.');
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

	return {
		bookingId,
		accessToken,
		confirmationCode,
		property: currentQuote.property.name,
		checkIn: pending.checkIn,
		checkOut: pending.checkOut,
		guests: pending.guests,
		nights: pending.nights,
		total: pending.total,
		currency: pending.currency,
		paymentStatus: 'pending' as const,
		alreadyConfirmed: false
	};
}

/** Validate a capability without writing; GETs and messaging-app previews never reserve dates. */
async function loadConfirmProposal(ctx: QueryCtx | MutationCtx, token: string) {
	const parts = token.split('.');
	if (parts.length !== 4) return null;
	const [sessionKey, proposalId, expiry, signature] = parts;
	const sessionId = ctx.db.normalizeId('chatSessions', sessionKey);
	if (!sessionId) return null;
	const session = await ctx.db.get(sessionId);
	const pending = session?.pendingBookingQuote;
	if (
		!session ||
		!pending?.confirmSecret ||
		pending.proposalId !== proposalId ||
		String(pending.expiresAt) !== expiry ||
		// Once confirmed, the link keeps leading to that booking's payment while its hold lasts.
		(!pending.bookingId && Date.now() >= Number(expiry))
	)
		return null;
	if (!(await verifyProposal(parts.slice(0, 3).join('.'), signature, pending.confirmSecret))) return null;
	const booking = pending.bookingId ? await ctx.db.get(pending.bookingId) : null;
	if (pending.bookingId && (!booking
		|| (booking.status !== 'pending' && booking.status !== 'confirmed')
		|| stayMoney(booking).net >= booking.total
		|| (booking.status === 'pending' && booking.source !== 'admin' && bookingHoldExpiresAt(booking) <= Date.now()))) return null;
	return { session, pending, booking };
}

export const getConfirmProposal = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const result = await loadConfirmProposal(ctx, args.token);
		if (!result) return null;
		const { pending, booking } = result;
		const settings = await getEffectiveSettings(ctx);
		const property = booking ? await ctx.db.get(booking.propertyId) : await loadProperty(ctx, pending.propertySlug);
		if (!property) return null;
		const stay = booking ?? pending;
		return {
			property: property.name,
			checkIn: stay.checkIn,
			checkOut: stay.checkOut,
			guests: stay.guests,
			nights: stay.nights,
			total: stay.total,
			currency: stay.currency,
			cancellationPolicy: settings.cancellationPolicy,
			unpaidHoldMinutes: settings.bookingRules.unpaidHoldMinutes,
			holdExpiresAt: booking?.status === 'pending' && booking.source !== 'admin' ? bookingHoldExpiresAt(booking) : null
		};
	}
});

export const confirmProposal = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const result = await loadConfirmProposal(ctx, args.token);
		if (!result) throw new Error('This summary has expired. Ask in the chat for a new one.');
		return await confirmPreparedBooking(ctx, { sessionId: result.session._id, byGuest: true });
	}
});

export const confirmChatBooking = internalMutation({
	args: {
		sessionId: v.id('chatSessions'),
		deadlineAt: v.optional(v.number()),
		expectedProposal: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		return await confirmPreparedBooking(ctx, args);
	}
});

/** Bookings this chat guest may see: made in this chat, or (WhatsApp) under their verified number. */
async function guestBookingsForSession(ctx: QueryCtx | MutationCtx, session: Doc<'chatSessions'>) {
	const fromChat = await ctx.db
		.query('bookings')
		.withIndex('by_chatSession', (q) => q.eq('chatSessionId', session._id))
		.take(20);
	const phone = session.channel === 'whatsapp' ? session.visitorPhone?.trim() : undefined;
	const byPhone = phone
		? await bookingsByPhone(ctx, phone, 20)
		: [];
	const unique = new Map([...fromChat, ...byPhone].map((b) => [b._id, b]));
	return [...unique.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function bookingReference(booking: Doc<'bookings'>) {
	return booking.confirmationCode ?? demoCode('CONF', booking._id as string);
}

export const listChatGuestBookings = internalQuery({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		const bookings = await guestBookingsForSession(ctx, session);
		return await Promise.all(
			bookings.slice(0, 10).map(async (b) => ({
				bookingId: b._id,
				reference: bookingReference(b),
				property: (await ctx.db.get(b.propertyId))?.name ?? 'Unknown villa',
				checkIn: b.checkIn,
				checkOut: b.checkOut,
				guests: b.guests,
				total: b.total,
				currency: b.currency,
				status: b.status,
				paymentStatus: b.paymentStatus,
				accessToken: b.paymentStatus === 'pending' && b.status === 'pending' ? b.accessToken : undefined
			}))
		);
	}
});

/**
 * Two-step cancel: the first call holds the cancellation and asks the guest to confirm;
 * a call on a later turn (after the guest replied) cancels. `turnStartedAt` marks the current turn.
 */
export const cancelChatBooking = internalMutation({
	args: {
		sessionId: v.id('chatSessions'),
		reference: v.string(),
		turnStartedAt: v.number(),
		deadlineAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const session = await loadChatSession(ctx, args.sessionId);
		assertChatWriteAllowed(session, args.deadlineAt);
		const reference = args.reference.trim().toUpperCase();
		const booking = (await guestBookingsForSession(ctx, session)).find(
			(b) => bookingReference(b).toUpperCase() === reference
		);
		if (!booking) throw new Error('No booking with that reference was found for this guest.');
		if (booking.status === 'cancelled') {
			return { state: 'already_cancelled' as const, reference: bookingReference(booking) };
		}
		if (booking.paymentStatus === 'paid' || booking.status !== 'pending') {
			throw new Error('Paid bookings are cancelled by the host (refunds are handled manually). Offer to connect the guest with the host.');
		}
		if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
			throw new Error('The payment checkout is active. Please wait for it to expire before cancelling.');
		}

		const pending = session.pendingCancellation;
		const confirmedByGuest =
			pending?.bookingId === booking._id &&
			pending.createdAt < args.turnStartedAt &&
			Date.now() - pending.createdAt < (await getEffectiveSettings(ctx)).bookingRules.chatQuoteValidityMinutes * 60_000;

		const summary = {
			reference: bookingReference(booking),
			checkIn: booking.checkIn,
			checkOut: booking.checkOut,
			total: booking.total,
			currency: booking.currency
		};

		if (!confirmedByGuest) {
			await ctx.db.patch(args.sessionId, {
				bookingFlowAt: Date.now(),
				pendingCancellation: { bookingId: booking._id, createdAt: Date.now() }
			});
			return { state: 'needs_confirmation' as const, ...summary };
		}

		await writeBooking(ctx, booking, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'guest:chat' }, { actor: 'guest:chat', kind: 'cancelled' });
		await queueCancellationEmail(ctx, booking);
		await releaseBookingDates(ctx, booking);
		await ctx.db.patch(args.sessionId, { pendingCancellation: undefined });
		return { state: 'cancelled' as const, ...summary };
	}
});
