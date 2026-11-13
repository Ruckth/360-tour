import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { assertStayPrice, bookingRevision, cleanReason, effectiveTime, resolveNotify, type BookingPatch } from '../../shared/bookingMoney';
import { demoCode } from '../../shared/codes';
import { resortTodayIso } from '../../shared/time';
import { refundMethod } from '../../shared/financeValidators';
import { deletePlaceholderOrders, orderDeleteBlocker } from '../../pos/model';
import { roundMoney } from '../../shared/orderMath';
import { calculateDirectQuote } from '../../shared/pricing';
import { stayMoney } from '../../shared/stayMoney';
import { quoteCouponBooking } from '../../marketing/model';
import { appendRecordHistory } from '../../settings/model';
import { satangToBaht } from '../../shared/money';
import { blockBookingDates, releaseBookingDates } from './availabilityWrites';
import { assertBookableProperty, assertStayDates, assertStayFree, PROPERTY_UNAVAILABLE } from './bookingWrites';
import { appendBookingHistory, bookingSnapshot, writeBooking } from './money';
import { assertNoBookingOverlap } from './stayOverlap';

function assertNotCancelled(booking: Doc<'bookings'>): void {
	if (booking.status === 'cancelled') {
		throw new Error('This booking was cancelled.');
	}
}

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
			await ctx.scheduler.runAfter(0, internal.bookings.emails.sendBookingConfirmation, {
				...details,
				guestEmail: booking.guestEmail
			});
		}
		await ctx.scheduler.runAfter(0, internal.bookings.emails.sendOwnerNotification, {
			...details,
			guestEmail: booking.guestEmail ?? '',
			guestPhone: booking.guestPhone
		});
	}
}

export async function queueCancellationEmail(ctx: MutationCtx, booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled' || booking.cancellationEmailQueuedAt || !booking.guestEmail?.trim()) return;
	await ctx.db.patch(booking._id, { cancellationEmailQueuedAt: Date.now() });
	await ctx.scheduler.runAfter(0, internal.bookings.emails.sendCancellation, { bookingId: booking._id });
}

export const SEARCH_SCAN_LIMIT = 1000;

export function toAdminBooking(booking: Doc<'bookings'>) {
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
		promotion: booking.promotion,
		currency: booking.currency,
		status: booking.status,
		paymentStatus: booking.paymentStatus,
		paymentMethod: booking.paymentMethod,
		/** What the guest has paid and kept, after recorded refunds; undefined while unpaid. */
		amountPaid: booking.paymentStatus === 'paid' ? stayMoney(booking).net : undefined,
		source: booking.source ?? 'web',
		chatSessionId: booking.chatSessionId,
		confirmationCode: booking.confirmationCode,
		createdAt: booking.createdAt,
		/** Send it back with a correction so a change made meanwhile is not overwritten. */
		revision: bookingRevision(booking)
	};
}

export type AdminBooking = ReturnType<typeof toAdminBooking>;

/** The calendar asks for at most ~6 weeks; this leaves room without letting one call read a year. */
export const MAX_CALENDAR_DAYS = 62;

/** The calendar shows at most this many villas; a 101st makes the view incomplete. */
export const MAX_CALENDAR_VILLAS = 100;

export const MAX_GUEST_SUGGESTIONS = 5;

/** `stays` counts the matching bookings this lookup read (exact matches plus recent ones), not a lifetime total. */
export type GuestSuggestion = { guestName: string; guestPhone: string; guestEmail?: string; stays: number; lastCheckIn: string };

export const priceOverrideInput = v.object({ total: v.number(), reason: v.string() });

export const refundInput = {
	amount: v.number(),
	currency: v.string(),
	method: refundMethod,
	reason: v.string(),
	idempotencyKey: v.string(),
	/** Business date the money was given back; defaults to now. */
	effectiveAt: v.optional(v.number()),

	paymentId: v.optional(v.id('bookingPayments')),
	orderId: v.optional(v.id('orders')),
};

export async function loadBooking(ctx: QueryCtx | MutationCtx, bookingId: Id<'bookings'>) {
	const booking = await ctx.db.get(bookingId);
	if (!booking) throw new Error('Booking not found');
	return booking;
}

/** Confirms a pending stay without payment (pay later / on arrival) and holds its nights. */
export async function confirmStay(ctx: MutationCtx, booking: Doc<'bookings'>, actor: string, notifyGuest: boolean | undefined) {
	if (booking.status !== 'pending') return;
	await blockBookingDates(ctx, booking, booking._id);
	const notify = resolveNotify(notifyGuest, booking);
	await writeBooking(ctx, booking, {
		status: 'confirmed',
		confirmationCode: booking.confirmationCode ?? demoCode('CONF', booking._id as string)
	}, { actor, kind: 'confirmed', details: { notifiedGuest: notify } });
	if (notify) await queueBookingEmails(ctx, booking);
}

/**
 * An archived villa is accepted only to record a stay that started in the past, with a reason
 * that is logged. Returns the cleaned reason, or undefined for an active villa.
 */
export function archivedVillaPolicy(property: Doc<'properties'>, checkIn: string, archivedVillaReason: string | undefined, requireReason = true) {
	if (property.status === 'active') return undefined;
	if (property.status !== 'archived') throw new Error(PROPERTY_UNAVAILABLE);
	if (checkIn >= resortTodayIso()) throw new Error('Archived villas can only be used to record stays that started in the past.');
	const reason = cleanReason(archivedVillaReason, 'Reason for using an archived villa', false);
	if (!reason && requireReason) throw new Error('This villa is archived. Give a reason to record a past stay in it.');
	assertBookableProperty(property, { allowArchivedProperty: true });
	return reason;
}

export function cleanPriceOverride(input: { total: number; reason: string }) {
	assertStayPrice(input.total);
	return { total: input.total, reason: cleanReason(input.reason, 'Reason for the custom price')! };
}

export function assertBookingEditable(booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled') throw new Error('Cancelled bookings are read-only. Reopen it first.');
	if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
		throw new Error('The guest has a Stripe checkout open. Wait for it to finish or expire before editing.');
	}
}

/** One read-only policy for preview and save, including override reset and frozen coupon rules. */
export async function planBookingEditPricing(
	ctx: QueryCtx | MutationCtx,
	booking: Doc<'bookings'>,
	property: Doc<'properties'>,
	stay: { checkIn: string; checkOut: string; nights: number },
	priceOverride: null | { total: number; reason: string } | undefined,
	actor: string
) {
	const { nights } = stay;
	const stayChanged = property._id !== booking.propertyId || stay.checkIn !== booking.checkIn || stay.checkOut !== booking.checkOut;
	// Price: villa rate on a stay change, a custom price, or back to the villa rate.
	let pricing: BookingPatch = {};
	let priceReason: string | undefined;
	const existing = booking.priceOverride;
	if (priceOverride === undefined || (priceOverride === null && !existing)) {
		if (stayChanged && existing) {
			throw new Error('This booking has a custom price. Enter the price for the new stay, or go back to the villa rate.');
		}
		if (stayChanged) {
			const quote = calculateDirectQuote(property, nights);
			pricing = { subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.directTotal, currency: quote.currency };
		}
	} else if (priceOverride === null) {
		const quote = calculateDirectQuote(property, nights);
		pricing = { subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.directTotal, currency: quote.currency, priceOverride: undefined };
		priceReason = 'Back to the villa rate';
	} else {
		const custom = cleanPriceOverride(priceOverride);
		const unchanged = !stayChanged && existing?.total === custom.total && existing.reason === custom.reason;
		if (!unchanged) {
			const quote = calculateDirectQuote(property, nights);
			pricing = {
				subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: custom.total, currency: quote.currency,
				priceOverride: { total: custom.total, quotedTotal: quote.directTotal, reason: custom.reason, by: actor, at: Date.now() }
			};
			priceReason = custom.reason;
		}
	}

	const resetPrice = priceOverride === null && existing !== undefined;
	const couponQuote = booking.promotion && !pricing.priceOverride && (!existing || resetPrice) && (stayChanged || resetPrice)
		? await quoteCouponBooking(ctx, booking, property, stay) : null;
	if (couponQuote) pricing = { ...pricing, ...couponQuote.pricing };
	// Guard the currency actually being written, including custom prices and override resets.
	if (pricing.currency !== undefined && pricing.currency !== booking.currency && (booking.paymentStatus === 'paid' || stayMoney(booking).gross > 0)) {
		throw new Error('Paid bookings cannot move to a villa with a different currency.');
	}
	return { pricing, priceReason, couponQuote };
}

/** Refuses a save whose price isn't the one staff reviewed (rates, coupon or currency moved meanwhile). */
export function assertReviewedPrice(expected: { total: number; currency: string }, saved: { total: number; currency: string }) {
	if (expected.total === saved.total && expected.currency === saved.currency) return;
	const money = (p: { total: number; currency: string }) => `${p.currency} ${p.total.toLocaleString('en-US')}`;
	throw new Error(`The price changed to ${money(saved)} since you reviewed ${money(expected)}. Check the new price and save again.`);
}

/** Why a booking can't be deleted, or null. Anything that involved money must be cancelled instead. */
export function deleteBlocker(booking: Doc<'bookings'>, now: number): string | null {
	const touchedMoney =
		booking.paymentStatus === 'paid' ||
		booking.paymentStatus === 'refunded' ||
		booking.paidAt !== undefined ||
		booking.stripePaymentIntentId !== undefined ||
		(booking.amountPaid ?? 0) > 0 ||
		(booking.amountRefunded ?? 0) > 0;
	if ((booking.status !== 'pending' && booking.status !== 'cancelled') || touchedMoney) {
		return 'Only unpaid pending or cancelled bookings can be deleted.';
	}
	if ((booking.stripeCheckoutExpiresAt ?? 0) > now) {
		return 'The guest has a Stripe checkout open. Wait for it to expire before deleting.';
	}
	return null;
}

/** Orders and financial records keep a reference to the stay, so a booking with either is cancelled, not deleted. */
export async function recordsBlocker(ctx: MutationCtx, booking: Doc<'bookings'>): Promise<string | null> {
	const [payment, refund] = await Promise.all([
		ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).first(),
		ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).first()
	]);
	if (payment || refund) return 'This booking has payment records. Cancel it instead of deleting it.';
	return await orderDeleteBlocker(ctx, booking._id);
}

/**
 * Deletes the booking and releases its nights. Its last state is kept in the booking history
 * (recordChanges) and each appointment unlinked from it gets an `appointment` history row, so the
 * removal is traceable. The appointments themselves are kept.
 */
export async function deleteBookingRecord(ctx: MutationCtx, booking: Doc<'bookings'>, actor: string) {
	if (booking.promotion) await writeBooking(ctx, booking, { status: 'cancelled' }, { actor, kind: 'cancelled', reason: 'Booking deleted' });
	await releaseBookingDates(ctx, booking);
	const session = booking.chatSessionId ? await ctx.db.get(booking.chatSessionId) : null;
	if (session?.pendingBookingQuote?.bookingId === booking._id) {
		await ctx.db.patch(session._id, { pendingBookingQuote: undefined });
	}
	if (session?.pendingCancellation?.bookingId === booking._id) {
		await ctx.db.patch(session._id, { pendingCancellation: undefined });
	}
	const appointments = await ctx.db
		.query('appointments')
		.withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
		.take(51);
	if (appointments.length > 50) throw new Error('This booking has more than 50 service appointments. Remove some before deleting it.');
	for (const appointment of appointments) {
		await ctx.db.patch(appointment._id, { bookingId: undefined });
		await appendRecordHistory(ctx, {
			entityType: 'appointment', entityId: appointment._id, actor, kind: 'booking_unlinked',
			reason: 'Its booking was deleted', before: { bookingId: booking._id }, after: { bookingId: null }
		});
	}
	// The empty order created with the booking goes with it (recordsBlocker refused any used order).
	await deletePlaceholderOrders(ctx, booking._id);
	await appendBookingHistory(ctx, booking._id, {
		actor, kind: 'deleted',
		before: { ...bookingSnapshot(booking), unlinkedAppointments: appointments.map((a) => a._id) }
	});
	await ctx.db.delete(booking._id);
}

export const DAY_MS = 86_400_000;

export const CLEANUP_SCAN_LIMIT = 500;

export const MAX_BATCH_DELETE = 100;

// Host date blocks (owner stay, maintenance). `end` is exclusive: the first free night.

export const dateBlockArgs = {
	propertyId: v.id('properties'),
	start: v.string(),
	end: v.string(),
	reason: v.string()
};

export const MAX_BLOCKED_NIGHTS_PER_CALL = 1500;

export function dateBlockSnapshot(row: { propertyId: Id<'properties'>; start: string; end: string; reason: string }) {
	return { propertyId: row.propertyId, start: row.start, end: row.end, reason: row.reason };
}

export function assertDateBlockUnchanged(row: ReturnType<typeof dateBlockSnapshot>, expected?: ReturnType<typeof dateBlockSnapshot>) {
	if (expected && Object.keys(expected).some(key => row[key as keyof typeof row] !== expected[key as keyof typeof expected]))
		throw new Error('This block changed. Reopen it and review the latest dates before saving.');
}

export function blockReason(value: string) {
	const reason = value.trim();
	if (!reason) throw new Error('Add a reason for the block.');
	if (reason.length > 200) throw new Error('Keep the reason under 200 characters.');
	return reason;
}

export async function validateDateBlock(
	ctx: MutationCtx,
	args: { propertyId: Id<'properties'>; start: string; end: string; reason: string },
	{ rowsCheckedOnWrite = false } = {}
) {
	if (!(await ctx.db.get(args.propertyId))) throw new Error('Property not found');
	assertStayDates(args.start, args.end, { allowPastCheckIn: true });
	const reason = blockReason(args.reason);
	// An edit leaves the night check to writeDateBlockRows, which lets it keep nights it held.
	if (rowsCheckedOnWrite) await assertNoBookingOverlap(ctx, args.propertyId, args.start, args.end);
	else await assertStayFree(ctx, args.propertyId, args.start, args.end);
	return reason;
}
