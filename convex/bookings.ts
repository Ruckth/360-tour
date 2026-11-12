import { durableToolValidator, durableTurnValidator, currentClaim, withDurableTool } from './messaging/model';
import { startDurablePreparation } from './messaging/claims';
import { satangToBaht } from './shared/money';
import { activeGuestCoupon, assertGuestSuppliedCoupon, quoteChatStay, couponSnapshotIdentity, type ChatCouponSnapshot } from './lib/chatCoupon';
import { normalizeCouponCode } from './lib/offers';
import { cleanCapture, marketingCaptureValidator, type MarketingCapture } from './lib/marketingAttribution';
import { bookingsByPhone } from './lib/bookingPhone';
import { assertChatWriteAllowed, assertSameProposal } from './lib/chatWriteGuard';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, internalQuery, mutation, query } from './auth/model';
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
	type BookingSource
} from './lib/bookingWrites';
import { roundMoney } from './lib/orderMath';
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
		customPrice: booking.priceOverride !== undefined,
		// Guests see the code and amount only, never internal coupon or ledger ids.
		promotion: booking.priceOverride === undefined && booking.promotion ? { code: booking.promotion.code, couponVersion: booking.promotion.couponVersion, discount: booking.promotion.discount } : undefined,
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
		couponCode: v.optional(v.string()),
		/** Release 3a: the link this tab arrived through and, after consent, the visitor key. Untrusted. */
		marketing: v.optional(marketingCaptureValidator)
	},
	handler: async (ctx, args) => {
		assertValidEmail(args.guestEmail);
		await enforceRateLimit(ctx, `booking-email:${args.guestEmail.trim().toLowerCase()}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, `booking-phone:${args.guestPhone.trim()}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, 'booking:global', 100, 60 * 60 * 1000);
		return await createBookingRecord(ctx, { ...args, source: 'web' });
	}
});


export function isDocumentedLiveRefund(booking: Doc<'bookings'>) {
	return booking.status !== 'cancelled' && booking.paymentStatus === 'refunded' &&
		booking.amountPaid !== undefined && booking.amountRefunded !== undefined &&
		roundMoney(booking.amountRefunded) === roundMoney(booking.amountPaid);
}

export type StayPaymentInput = {
	origin: 'manual' | 'pos' | 'online';
	method: Doc<'bookingPayments'>['method'];
	/** Admin email, or `system:<provider>`. */
	actor: string;

	paymentLabel: string;
	/** Business date the money was received; defaults to now. */
	effectiveAt?: number;
	orderId?: Id<'orders'>;
	idempotencyKey?: string;
	note?: string;
	/** Undefined: default (online always; staff paths per lib/bookingMoney resolveNotify). */
	notifyGuest?: boolean;
	/** The amount staff reviewed; refused if the stay now owes something else. */
	expectedAmount?: number;
	/**
	 * Records only this part of what the stay owes (a paid order row linked later, pos.linkPaidLine).
	 * Refused above the balance. A part payment keeps the stay's payment status (pending stays pending).
	 */
	amount?: number;
};

/**
 * Records money received for everything the stay still owes (or `input.amount` of it), confirms it and holds its nights, in
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
	if (input.expectedAmount !== undefined && roundMoney(input.expectedAmount) !== money.owed) {
		throw new Error(`This stay now owes ${satangToBaht(money.owed)}, not ${satangToBaht(roundMoney(input.expectedAmount))}. Review the balance and try again.`);
	}
	if (money.owed <= 0) return { booking, paymentId: null };
	const amount = input.amount ?? money.owed;
	if (input.amount !== undefined) {
		if (!Number.isFinite(amount) || amount <= 0 || roundMoney(amount) !== amount) throw new Error('The amount must be more than zero, in whole satang.');
		if (amount > money.owed) throw new Error(`This stay owes ${satangToBaht(money.owed)}, less than ${satangToBaht(amount)}.`);
		// `refunded` counts all money as returned and `failed` needs a reopen, so a part payment needs a live status.
		if (amount < money.owed && booking.paymentStatus !== 'pending' && booking.paymentStatus !== 'paid') {
			throw new Error('Record what the stay owes in full, or reopen it first.');
		}
	}
	const full = amount === money.owed;
	// Validates (no overlapping confirmed booking, no other hold or block) and holds the nights in
	// this transaction; a conflict throws before anything is marked paid.
	await blockBookingDates(ctx, booking, bookingId);

	const now = Date.now();
	const effectiveAt = effectiveTime(input.effectiveAt, now);
	const paymentId = await ctx.db.insert('bookingPayments', {
		bookingId, origin: input.origin, amount, currency: booking.currency, method: input.method,
		...(input.orderId ? { orderId: input.orderId } : {}),
		effectiveAt, recordedAt: now, recordedBy: input.actor,
		...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		...(input.note ? { note: input.note } : {}),
		refunded: 0, status: 'recorded'
	});
	const bookingIdText = bookingId as string;
	const updated = await writeBooking(ctx, booking, {
		paymentStatus: full ? 'paid' : booking.paymentStatus,
		status: 'confirmed',
		// The first payment's business date; a later balance payment keeps it. A part payment leaves it.
		paidAt: !full ? booking.paidAt : booking.paymentStatus === 'paid' ? (booking.paidAt ?? effectiveAt) : effectiveAt,
		// Paid in full: a deposit taken earlier is part of the total, not on top of it.
		amountPaid: roundMoney(money.gross + amount),
		paymentMethod: booking.paymentMethod ?? input.paymentLabel,
		confirmationCode: booking.confirmationCode ?? demoCode('CONF', bookingIdText),
		invoiceNumber: booking.invoiceNumber ?? demoCode('INV', bookingIdText),
		receiptNumber: booking.receiptNumber ?? demoCode('REC', bookingIdText)
	}, {
		actor: input.actor, kind: 'payment_recorded', effectiveAt,
		...(input.note ? { reason: input.note } : {}),
		details: {
			paymentId, origin: input.origin, method: input.method, amount, ...(input.orderId ? { orderId: input.orderId } : {})
		}
	});

	// The guest started an online payment themselves, so it is always confirmed to them.
	const notify = input.origin === 'online' ? (input.notifyGuest ?? true) : resolveNotify(input.notifyGuest, booking);
	if (notify) await queueBookingEmails(ctx, booking);
	return { booking: updated, paymentId };
}


export async function markBookingPaid(ctx: MutationCtx, bookingId: Id<'bookings'>, paymentMethod: string, options: Partial<Omit<StayPaymentInput, 'paymentLabel'>> = {}) {
	const origin = options.origin ?? (paymentMethod === 'admin' ? 'manual' : paymentMethod === 'pos' ? 'pos' : 'online');
	if (origin === 'online') {
		const booking = await ctx.db.get(bookingId);
		if (booking?.paymentStatus === 'paid') return booking;
	}
	const method = options.method ?? (origin === 'manual' ? 'unrecorded' : origin === 'pos' ? 'order' : paymentMethod === 'stripe' ? 'stripe' : 'provider');
	const { booking } = await recordStayPayment(ctx, bookingId, {
		...options, origin, method, actor: options.actor ?? `system:${paymentMethod}`, paymentLabel: paymentMethod
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

const chatSourceByChannel: Record<Doc<'conversations'>['channel'], BookingSource> = {
	web: 'web',
	whatsapp: 'whatsapp',
	facebook: 'messenger',
	line: 'line',
	instagram: 'instagram'
};

async function loadChatSession(ctx: QueryCtx | MutationCtx, sessionId: Id<'conversations'>) {
	const session = await ctx.db.get(sessionId);
	if (!session) throw new Error('Session not found');
	return session;
}

/** Whether the next message in this chat should be routed to the AI booking flow. */
export const touchChatBookingFlow = internalMutation({
	args: { durableTurn: v.optional(durableTurnValidator), sessionId: v.id('conversations') },
	handler: async (ctx, args) => {
    if (args.durableTurn) {
      const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken);
      if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch');
    }
		await ctx.db.patch(args.sessionId, { bookingFlowAt: Date.now() });
	}
});

/** Invalidate the old draft even when a replacement tool call later fails parsing or validation. */
export const invalidateChatProposal = internalMutation({
	args: { durableTool: v.optional(durableToolValidator), durableTurn: v.optional(durableTurnValidator), sessionId: v.id('conversations'), kind: v.union(v.literal('villa'), v.literal('service')), deadlineAt: v.number() },
	handler: async (ctx, args) => {
    if (args.durableTurn) {
      const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken);
      if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch');
    }
		const session = await loadChatSession(ctx, args.sessionId);
		assertChatWriteAllowed(session, args.deadlineAt);
		if (args.durableTool) {
			if (args.durableTool.name !== (args.kind === 'villa' ? 'prepare_booking' : 'prepare_service_booking')) throw new Error('Preparation kind mismatch');
			if (!await startDurablePreparation(ctx, args.sessionId, args.durableTool)) return;
		}
		await ctx.db.patch(args.sessionId, args.kind === 'villa' ? { pendingBookingQuote: undefined } : { pendingServiceQuote: undefined });
	}
});

/** A coupon price preview for web or messaging; never holds dates or coupon capacity. */
export const previewChatCoupon = internalQuery({
  args: { sessionId: v.id('conversations'), couponCode: v.string(), propertySlug: v.string(), checkIn: v.string(), checkOut: v.string(), guests: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const code = normalizeCouponCode(args.couponCode);
    await assertGuestSuppliedCoupon(ctx, args.sessionId, code);
    const { property, nights, quote, offer, coupon } = await quoteChatStay(ctx, { ...args, couponCode: code, guests: args.guests ?? 1 });
    return { property: property.name, propertySlug: property.slug, checkIn: args.checkIn, checkOut: args.checkOut,
      nights, guests: args.guests ?? 1, subtotal: offer.subtotal, discountAmount: offer.discount, total: offer.total, currency: quote.currency, coupon };
  }
});

type PrepareChatBookingInput = {
  sessionId: Id<'conversations'>; propertySlug: string; checkIn: string; checkOut: string; guests: number;
  guestName: string; guestPhone?: string; couponCode?: string; deadlineAt?: number;
};

async function prepareChatBookingRecord(ctx: MutationCtx, args: PrepareChatBookingInput, byGuest = false) {
	const session = await loadChatSession(ctx, args.sessionId);
	if (!byGuest) assertChatWriteAllowed(session, args.deadlineAt);
	// WhatsApp numbers are verified by WhatsApp, so never trust a model-supplied phone there.
	const guestPhone = (
		session.channel === 'whatsapp' ? session.visitorPhone : (args.guestPhone ?? session.visitorPhone)
	)?.trim();
	if (!guestPhone) throw new Error('Ask the guest for their phone number before preparing the booking.');
	const guestName = args.guestName.trim() || session.visitorName?.trim();
	if (!guestName) throw new Error('Ask the guest for their name before preparing the booking.');

	const couponCode = normalizeCouponCode(args.couponCode ?? await activeGuestCoupon(ctx, args.sessionId) ?? '');
	if (couponCode) await assertGuestSuppliedCoupon(ctx, args.sessionId, couponCode);
	const { property, nights, quote, offer, coupon } = await quoteChatStay(ctx, { ...args, couponCode });
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
			total: offer.total,
			subtotal: offer.subtotal,
			discountAmount: offer.discount,
			...(coupon ? { coupon } : {}),
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
		total: offer.total,
		subtotal: offer.subtotal,
		discountAmount: offer.discount,
		...(coupon ? { coupon } : {}),
		currency: quote.currency
	};
}

export const prepareChatBooking = internalMutation({
	args: { durableTool: v.optional(durableToolValidator),
		sessionId: v.id('conversations'),
		propertySlug: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		guestName: v.string(),
		guestPhone: v.optional(v.string()),
		couponCode: v.optional(v.string()),
		deadlineAt: v.optional(v.number())
	},
	handler: (ctx, args) => withDurableTool(ctx, args.sessionId, args.durableTool, () => prepareChatBookingRecord(ctx, args))
});

/** A confirmed proposal shows the booking's actual frozen saving, including later staff edits. */
function bookedChatCoupon(booking: Doc<'bookings'>): ChatCouponSnapshot | undefined {
  const promotion = booking.priceOverride === undefined ? booking.promotion : undefined;
  return promotion ? { code: promotion.code, couponId: promotion.couponId, version: promotion.couponVersion,
    status: 'applied' as const, discount: promotion.discount, capped: false } : undefined;
}

async function confirmPreparedBooking(
	ctx: MutationCtx,
	args: { sessionId: Id<'conversations'>; deadlineAt?: number; expectedProposal?: string; byGuest?: boolean; marketing?: MarketingCapture }
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
			...(bookedChatCoupon(existing) ? { coupon: bookedChatCoupon(existing) } : {}),
			needsReview: false as const,
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

	const activeCode = await activeGuestCoupon(ctx, args.sessionId);
	const currentQuote = await quoteChatStay(ctx, { ...pending, couponCode: activeCode });
	if (activeCode !== pending.coupon?.code || currentQuote.offer.total !== pending.total || currentQuote.quote.currency !== pending.currency
      || (pending.subtotal !== undefined && currentQuote.offer.subtotal !== pending.subtotal)
      || (pending.discountAmount !== undefined && currentQuote.offer.discount !== pending.discountAmount)
      || couponSnapshotIdentity(currentQuote.coupon) !== couponSnapshotIdentity(pending.coupon)) {
    const quote = await prepareChatBookingRecord(ctx, {
      sessionId: args.sessionId, propertySlug: pending.propertySlug, checkIn: pending.checkIn, checkOut: pending.checkOut,
      guests: pending.guests, guestName: pending.guestName, guestPhone: pending.guestPhone, couponCode: activeCode, deadlineAt: args.deadlineAt
    }, args.byGuest);
    return { needsReview: true as const, quote };
  }
  if (pending.coupon?.status === 'applied' && pending.total <= 0) throw new Error('This code covers the whole stay. Please contact the host to book.');
	const { bookingId, accessToken } = await createBookingRecord(ctx, {
		propertySlug: pending.propertySlug,
		checkIn: pending.checkIn,
		checkOut: pending.checkOut,
		guests: pending.guests,
		guestName: pending.guestName,
		guestPhone: pending.guestPhone,
		...(session.visitorEmail ? { guestEmail: session.visitorEmail } : {}),
		source: chatSourceByChannel[session.channel],
		chatSessionId: args.sessionId,
		...(pending.coupon?.status === 'applied' ? { couponCode: pending.coupon.code } : {}),
		// The confirming page's own capture beats the one the chat last saw.
		marketing: session.channel === 'web' ? (args.marketing !== undefined ? cleanCapture(args.marketing) : session.marketingCapture) : undefined
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
		...(pending.coupon ? { coupon: pending.coupon } : {}),
		needsReview: false as const,
		alreadyConfirmed: false
	};
}

/** Validate a capability without writing; GETs and messaging-app previews never reserve dates. */
async function loadConfirmProposal(ctx: QueryCtx | MutationCtx, token: string) {
	const parts = token.split('.');
	if (parts.length !== 4) return null;
	const [sessionKey, proposalId, expiry, signature] = parts;
	const sessionId = ctx.db.normalizeId('conversations', sessionKey);
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
		const coupon = booking ? bookedChatCoupon(booking) : pending.coupon;
		return {
			property: property.name,
			checkIn: stay.checkIn,
			checkOut: stay.checkOut,
			guests: stay.guests,
			nights: stay.nights,
			...(coupon ? { coupon } : {}),
			subtotal: booking?.subtotal ?? pending.subtotal,
			discountAmount: booking?.discountAmount ?? pending.discountAmount,
			total: stay.total,
			currency: stay.currency,
			cancellationPolicy: settings.cancellationPolicy,
			unpaidHoldMinutes: settings.bookingRules.unpaidHoldMinutes,
			holdExpiresAt: booking?.status === 'pending' && booking.source !== 'admin' ? bookingHoldExpiresAt(booking) : null
		};
	}
});

export const confirmProposal = mutation({
	args: {
		token: v.string(),
		/** Release 3a: this page's tab and consent; `{}` means none. Overrides the chat's last capture. */
		marketing: v.optional(marketingCaptureValidator)
	},
	handler: async (ctx, args) => {
		const result = await loadConfirmProposal(ctx, args.token);
		if (!result) throw new Error('This summary has expired. Ask in the chat for a new one.');
		return await confirmPreparedBooking(ctx, { sessionId: result.session._id, byGuest: true, marketing: args.marketing });
	}
});

export const confirmChatBooking = internalMutation({
	args: { durableTool: v.optional(durableToolValidator),
		sessionId: v.id('conversations'),
		deadlineAt: v.optional(v.number()),
		expectedProposal: v.optional(v.string())
	},
	handler: async (ctx, args) => withDurableTool(ctx, args.sessionId, args.durableTool, async () => {
		return await confirmPreparedBooking(ctx, args);
	})
});

/** Bookings this chat guest may see: made in this chat, or (WhatsApp) under their verified number. */
async function guestBookingsForSession(ctx: QueryCtx | MutationCtx, session: Doc<'conversations'>) {
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
	args: { sessionId: v.id('conversations') },
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
	args: { durableTool: v.optional(durableToolValidator),
		sessionId: v.id('conversations'),
		reference: v.string(),
		turnStartedAt: v.number(),
		deadlineAt: v.optional(v.number())
	},
	handler: async (ctx, args) => withDurableTool(ctx, args.sessionId, args.durableTool, async () => {
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
	})
});
