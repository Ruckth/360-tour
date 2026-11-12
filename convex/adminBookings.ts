import { adminQuery, adminMutation } from './auth/model';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { internal } from './_generated/api';
import { markBookingPaid, queueBookingEmails, recordStayPayment } from './bookings';
import {
	blockBookingDates,
	releaseBookingDates,
	releaseDateBlockRows,
	writeDateBlockRows
} from './lib/availabilityWrites';
import {
	PROPERTY_UNAVAILABLE,
	assertBookableProperty,
	assertCapacity,
	assertStayDates,
	assertStayFree,
	cleanGuestDetails,
	createBookingRecord,
	guestLookupFields
} from './lib/bookingWrites';
import {
	appendBookingHistory,
	assertBookingRevision,
	assertNoLiveCheckout,
	assertStayPrice,
	attemptKey,
	bookingRevision,
	bookingSnapshot,
	cleanReason,
	effectiveTime,
	isHistoricalStay,
	resolveNotify,
	stayMoney,
	writeBooking,
	type BookingPatch
} from './lib/bookingMoney';
import { roundMoney } from './lib/orderMath';
import { demoCode } from './lib/codes';
import { calculateDirectQuote } from './lib/pricing';
import { nightsBetween, stayDates, resortTodayIso } from './lib/dates';
import { readBudget } from './lib/readBudget';
import { appendRecordHistory } from './lib/recordHistory';
import { manualPaymentMethod, refundMethod } from './lib/financeValidators';
import {
	cancelStayRecord,
	paymentAmendBlocker,
	paymentCancelBlocker,
	recordStayRefund,
	refundReplay,
	stayFinancials,
	stayPaymentReversalPatch
} from './lib/stayCorrections';
import { assertNoBookingOverlap, MAX_ROWS_PER_NIGHT, scanOverlappingBookings, scanOverlappingDateBlocks } from './lib/stayOverlap';
import { assertValidIsoDate } from './lib/validation';
import { assertNotOnOpenOrder, deletePlaceholderOrders, orderDeleteBlocker } from './lib/orderLinks';
import { normalizeCouponCode } from './lib/offers';
import { quoteCouponBooking, repriceCouponBooking } from './lib/couponRedemptions';

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
const MAX_CALENDAR_DAYS = 62;

/** The calendar shows at most this many villas; a 101st makes the view incomplete. */
const MAX_CALENDAR_VILLAS = 100;

/**
 * Villas, bookings, OTA blocks and host date blocks overlapping [from, to) for the admin calendar.
 * Every read counts against one shared read budget. `complete` is false when there are more villas
 * than shown, a villa had more rows than one read can check, or the budget ran out; the calendar
 * then says so instead of passing a partial view off as the whole picture.
 */
export const listForAdmin = adminQuery({
	args: { from: v.string(), to: v.string() },
	handler: async (ctx, args) => {
		assertValidIsoDate(args.from, 'From date');
		assertValidIsoDate(args.to, 'To date');
		if (args.to <= args.from) throw new Error('To date must be after from date');
		const days = nightsBetween(args.from, args.to);
		if (days > MAX_CALENDAR_DAYS) throw new Error(`Show at most ${MAX_CALENDAR_DAYS} days at a time`);

		const budget = readBudget(ctx);
		budget.range();
		const villas = await ctx.db.query('properties').take(MAX_CALENDAR_VILLAS + 1);
		for (const villa of villas) budget.document(villa);
		const properties = villas.slice(0, MAX_CALENDAR_VILLAS);
		let complete = villas.length <= MAX_CALENDAR_VILLAS;

		const bookings: Doc<'bookings'>[] = [];
		const blocks: Array<{ propertyId: Id<'properties'>; date: string; source: string }> = [];
		const dateBlocks: Doc<'dateBlocks'>[] = [];
		for (const property of properties) {
			if (budget.exhausted) {
				complete = false;
				break;
			}
			const overlap = await scanOverlappingBookings(ctx, property._id, args.from, args.to);
			bookings.push(...overlap.bookings);
			// Host blocks come from both their start and end indexes, so a long block whose nights
			// were never mirrored still shows.
			const hostBlocks = await scanOverlappingDateBlocks(ctx, property._id, args.from, args.to);
			dateBlocks.push(...hostBlocks.blocks);
			complete &&= overlap.complete && hostBlocks.complete;

			// OTA/iCal nights (read-only here).
			let rows = 0;
			budget.range();
			for await (const row of ctx.db
				.query('availability')
				.withIndex('by_property_date', (q) =>
					q.eq('propertyId', property._id).gte('date', args.from).lt('date', args.to)
				)) {
				if (++rows > days * MAX_ROWS_PER_NIGHT || !budget.document(row)) {
					complete = false;
					break;
				}
				if (row.status !== 'available' && !row.bookingId && !row.dateBlockId) {
					blocks.push({ propertyId: row.propertyId, date: row.date, source: row.source });
				}
			}
		}

		return {
			properties: properties.map((p) => ({
				_id: p._id,
				slug: p.slug,
				name: p.name,
				...(p.images[0] ? { imageUrl: p.images[0] } : {}),
				maxGuests: p.maxGuests,
				status: p.status,
				pricePerNight: p.pricePerNight,
				directDiscountPercent: p.directDiscountPercent,
				currency: p.currency
			})),
			bookings: bookings.map(toAdminBooking),
			blocks,
			dateBlocks: dateBlocks.map(({ _id, propertyId, start, end, reason }) => ({ _id, propertyId, start, end, reason })),
			complete: complete && !budget.exhausted
		};
	}
});

/** Full booking detail for the admin sheet, including the private pay-link token while unpaid. */
export const getForAdmin = adminQuery({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		if (!booking) return null;
		const property = await ctx.db.get(booking.propertyId);
		const payable = booking.paymentStatus === 'pending' && booking.status !== 'cancelled';
		const redemption = booking.promotion ? await ctx.db.get(booking.promotion.redemptionId) : null;
		return {
			...toAdminBooking(booking),
			redemption: redemption ? { state: redemption.state, overLimit: redemption.overLimit ?? false } : null,
			/** Release 3a: which marketing link brought the booking (frozen at creation); null when none. */
			marketingAttribution: booking.marketingAttribution ?? null,
			propertyName: property?.name ?? 'Unknown villa',
			propertyStatus: property?.status ?? 'archived',
			subtotal: booking.subtotal,
			discountAmount: booking.discountAmount,
			priceOverride: booking.priceOverride ?? null,
			paidAt: booking.paidAt,
			refundedAt: booking.refundedAt,
			hasStripePayment: Boolean(booking.stripePaymentIntentId),
			checkoutLive: (booking.stripeCheckoutExpiresAt ?? 0) > Date.now(),
			adminNotes: booking.adminNotes,
			accessToken: payable ? booking.accessToken : undefined,
			money: stayMoney(booking),
			createdBy: booking.createdBy,
			cancelledAt: booking.cancelledAt,
			cancelledBy: booking.cancelledBy,
			cancelReason: booking.cancelReason,
			/** Started before today: corrections default to not emailing the guest. */
			historical: isHistoricalStay(booking),
			guestEmailsOff: booking.guestEmailsOff ?? false,
			/** A confirmation was already emailed, so paying won't send another. */
			confirmationEmailed: Boolean(booking.confirmationEmailsQueuedAt),
			/** What a staff action does about guest email when not told otherwise. */
			notifyByDefault: resolveNotify(undefined, booking)
		};
	}
});

/**
 * Guest search by name, phone, email or confirmation code. Exact phone (digits), email and code
 * matches come from indexes, so old bookings are found too; names also use a word-prefix search
 * index. Substring matches (part of a name, phone or email) cover only the newest bookings.
 */
export const searchBookings = adminQuery({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		const raw = args.query.trim();
		const text = raw.toLowerCase();
		if (text.length < 2) return [];
		const digits = text.replace(/\D/g, '');
		const [byPhone, byEmail, byCode, byName, recent] = await Promise.all([
			digits.length >= 3
				? ctx.db.query('bookings').withIndex('by_guestPhoneDigits', (q) => q.eq('guestPhoneDigits', digits)).order('desc').take(20)
				: [],
			text.includes('@')
				? ctx.db.query('bookings').withIndex('by_guestEmailNormalized', (q) => q.eq('guestEmailNormalized', text)).order('desc').take(20)
				: [],
			ctx.db.query('bookings').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', raw.toUpperCase())).take(5),
			ctx.db.query('bookings').withSearchIndex('search_guestName', (q) => q.search('guestName', raw)).take(20),
			ctx.db.query('bookings').order('desc').take(SEARCH_SCAN_LIMIT)
		]);
		const newestFirst = (a: Doc<'bookings'>, b: Doc<'bookings'>) => b.createdAt - a.createdAt;
		const substring = recent.filter(
			(b) =>
				b.guestName.toLowerCase().includes(text) ||
				(b.guestEmail ?? '').toLowerCase().includes(text) ||
				(b.confirmationCode ?? '').toLowerCase().includes(text) ||
				(digits.length >= 3 && b.guestPhone.replace(/\D/g, '').includes(digits))
		);
		// Exact matches first, then name and substring matches; newest first within each.
		const merged = new Map<Id<'bookings'>, Doc<'bookings'>>();
		for (const b of [...byPhone, ...byEmail, ...byCode].sort(newestFirst)) merged.set(b._id, b);
		for (const b of [...byName, ...substring].sort(newestFirst)) merged.set(b._id, b);
		return [...merged.values()].slice(0, 20).map(toAdminBooking);
	}
});

const MAX_GUEST_SUGGESTIONS = 5;

/** `stays` counts the matching bookings this lookup read (exact matches plus recent ones), not a lifetime total. */
type GuestSuggestion = { guestName: string; guestPhone: string; guestEmail?: string; stays: number; lastCheckIn: string };

/**
 * Previous guests whose phone or email matches what the host is typing in the new-booking form.
 * Exact phone and email matches come from indexes (any age); partial ones from the most recent bookings.
 */
export const findGuests = adminQuery({
	args: { phone: v.optional(v.string()), email: v.optional(v.string()) },
	handler: async (ctx, args): Promise<GuestSuggestion[]> => {
		const phone = (args.phone ?? '').trim();
		const digits = phone.replace(/\D/g, '');
		const email = (args.email ?? '').trim().toLowerCase();
		const parsed = parsePhoneNumberFromString(phone);
		const national = parsed?.formatNational();
		const rawForms = [...new Set([phone, national, national?.replace(/\D/g, '')])]
			.filter((value): value is string => Boolean(value));
		// Country-aware input emits E.164; older bookings may hold national numbers.
		const digitForms = [...new Set([digits, parsed?.nationalNumber, national?.replace(/\D/g, '')])]
			.filter((value): value is string => Boolean(value && value.length >= 4));
		if (digits.length < 4 && email.length < 3) return [];

		const [exactPhone, exactDigits, exactEmail, recent] = await Promise.all([
			// Raw national forms also find old contacts without guestPhoneDigits.
			Promise.all(rawForms.map((form) =>
				ctx.db.query('bookings').withIndex('by_guestPhone', (q) => q.eq('guestPhone', form)).order('desc').take(50)
			)).then((rows) => rows.flat()),
			Promise.all(digitForms.map((form) =>
				ctx.db.query('bookings').withIndex('by_guestPhoneDigits', (q) => q.eq('guestPhoneDigits', form)).order('desc').take(50)
			)).then((rows) => rows.flat()),
			email.includes('@')
				? ctx.db.query('bookings').withIndex('by_guestEmailNormalized', (q) => q.eq('guestEmailNormalized', email)).order('desc').take(50)
				: [],
			ctx.db.query('bookings').order('desc').take(SEARCH_SCAN_LIMIT)
		]);
		const seen = new Set<string>();
		const guests = new Map<string, GuestSuggestion>();
		for (const booking of [...exactPhone, ...exactDigits, ...exactEmail, ...recent]) {
			if (seen.has(booking._id)) continue;
			seen.add(booking._id);
			const bookingDigits = booking.guestPhone.replace(/\D/g, '');
			const bookingEmail = (booking.guestEmail ?? '').toLowerCase();
			const matches =
				digitForms.some((form) => bookingDigits.includes(form)) || (email.length >= 3 && bookingEmail.includes(email));
			if (!matches) continue;
			const contact = parsePhoneNumberFromString(booking.guestPhone, 'TH');
			const key = contact?.isValid() && !contact.ext ? contact.number : bookingDigits || bookingEmail;
			const guest = guests.get(key);
			if (guest) {
				guest.stays++;
				if (booking.checkIn > guest.lastCheckIn) guest.lastCheckIn = booking.checkIn;
				guest.guestEmail ??= booking.guestEmail;
			} else {
				guests.set(key, {
					guestName: booking.guestName,
					guestPhone: booking.guestPhone,
					guestEmail: booking.guestEmail,
					stays: 1,
					lastCheckIn: booking.checkIn
				});
			}
		}
		return [...guests.values()].slice(0, MAX_GUEST_SUGGESTIONS);
	}
});

const priceOverrideInput = v.object({ total: v.number(), reason: v.string() });
const refundInput = {
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

async function loadBooking(ctx: QueryCtx | MutationCtx, bookingId: Id<'bookings'>) {
	const booking = await ctx.db.get(bookingId);
	if (!booking) throw new Error('Booking not found');
	return booking;
}

/** Confirms a pending stay without payment (pay later / on arrival) and holds its nights. */
async function confirmStay(ctx: MutationCtx, booking: Doc<'bookings'>, actor: string, notifyGuest: boolean | undefined) {
	if (booking.status !== 'pending') return;
	await blockBookingDates(ctx, booking, booking._id);
	const notify = resolveNotify(notifyGuest, booking);
	await writeBooking(ctx, booking, {
		status: 'confirmed',
		confirmationCode: booking.confirmationCode ?? demoCode('CONF', booking._id as string)
	}, { actor, kind: 'confirmed', details: { notifiedGuest: notify } });
	if (notify) await queueBookingEmails(ctx, booking);
}


export const updateBooking = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		action: v.union(v.literal('confirm'), v.literal('cancel'), v.literal('markPaid')),
		expectedRevision: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);

		if (args.action === 'cancel') {
			await cancelStayRecord(ctx, booking, {
				actor: admin.email, reason: args.reason, notifyGuest: args.notifyGuest
			});
			return;
		}

		if (booking.status === 'cancelled') throw new Error('This booking was cancelled.');

		if (args.action === 'markPaid') {
			// Paying it here while checkout is charging it on an open order would collect it twice.
			await assertNotOnOpenOrder(ctx, { bookingId: booking._id }, 'This stay');
			await markBookingPaid(ctx, booking._id, 'admin', { actor: admin.email, notifyGuest: args.notifyGuest });
			return;
		}

		await confirmStay(ctx, booking, admin.email, args.notifyGuest);
	}
});

/**
 * Records money received at the desk for everything the stay owes: how it was paid, the business
 * date it was received (any past date) and an optional note. Nothing is charged. Retrying with the
 * same `idempotencyKey` returns the first result.
 */
export const recordPayment = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		/** The balance staff reviewed; refused if the stay now owes something else. */
		expectedAmount: v.number(),
		method: manualPaymentMethod,
		effectiveAt: v.optional(v.number()),
		note: v.optional(v.string()),
		idempotencyKey: v.string(),
		notifyGuest: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const key = attemptKey(args.idempotencyKey);
		const replay = await ctx.db.query('bookingPayments').withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key)).first();
		if (replay) {
			if (replay.bookingId !== args.bookingId) throw new Error('This payment attempt was already used for another booking.');
			return { paymentId: replay._id, replayed: true };
		}
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		await assertNotOnOpenOrder(ctx, { bookingId: booking._id }, 'This stay');
		const note = cleanReason(args.note, 'Note', false);
		const { paymentId } = await recordStayPayment(ctx, booking._id, {
			origin: 'manual', method: args.method, actor: admin.email, paymentLabel: 'admin',
			effectiveAt: args.effectiveAt, note, idempotencyKey: key, notifyGuest: args.notifyGuest, expectedAmount: args.expectedAmount
		});
		if (!paymentId) throw new Error('Nothing is owed on this stay.');
		return { paymentId, replayed: false };
	}
});

/**
 * Corrects how or when a hand-entered payment was received (wrong method, wrong date, note). The
 * amount is not changed here: cancel a mistaken entry instead. Order and online payments refuse.
 */
export const amendPayment = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		paymentId: v.id('bookingPayments'),
		expectedRevision: v.number(),
		method: v.optional(manualPaymentMethod),
		effectiveAt: v.optional(v.number()),
		note: v.optional(v.string()),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		const payment = await ctx.db.get(args.paymentId);
		if (!payment || payment.bookingId !== booking._id) throw new Error('That payment belongs to another booking.');
		const blocked = paymentAmendBlocker(payment);
		if (blocked) throw new Error(blocked);
		const reason = cleanReason(args.reason, 'Reason for the correction')!;
		const method = args.method ?? payment.method;
		const effectiveAt = args.effectiveAt === undefined ? payment.effectiveAt : effectiveTime(args.effectiveAt);
		const note = args.note === undefined ? payment.note : cleanReason(args.note, 'Note', false);
		if (method === payment.method && effectiveAt === payment.effectiveAt && note === payment.note) throw new Error('Nothing changed.');
		const now = Date.now();
		await ctx.db.patch(payment._id, { method, effectiveAt, note, amendedAt: now, amendedBy: admin.email });
		const patch: BookingPatch = booking.paidAt === payment.effectiveAt && effectiveAt !== payment.effectiveAt ? { paidAt: effectiveAt } : {};
		await writeBooking(ctx, booking, patch, {
			actor: admin.email, kind: 'payment_amended', reason, effectiveAt,
			details: { paymentId: payment._id, before: { method: payment.method, effectiveAt: payment.effectiveAt, note: payment.note ?? null }, after: { method, effectiveAt, note: note ?? null } }
		});
	}
});


export const cancelPayment = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		paymentId: v.id('bookingPayments'),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		assertNoLiveCheckout(booking);
		const reason = cleanReason(args.reason, 'Reason')!;
		const money = stayMoney(booking);
		const now = Date.now();
		let amount = 0;
		let paymentId: Id<'bookingPayments'> | undefined;
		if (args.paymentId) {
			const payment = await ctx.db.get(args.paymentId);
			if (!payment || payment.bookingId !== booking._id) throw new Error('That payment belongs to another booking.');
			const blocked = paymentCancelBlocker(booking, payment);
			if (blocked) throw new Error(blocked);
			await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: now, cancelledBy: admin.email, cancelReason: reason });
			amount = payment.amount;
			paymentId = payment._id;
		}

		const gross = roundMoney(money.gross - amount);
		await writeBooking(ctx, booking, await stayPaymentReversalPatch(ctx, booking, gross),
			{ actor: admin.email, kind: 'payment_cancelled', reason, details: { amount, paymentId } });
	}
});

/**
 * Records a refund given back to the guest. Recording moves no money. A live stay refunds only
 * what exceeds its price (a credit, e.g. after it was shortened), so it can't be charged again;
 * a cancelled stay can refund any part of what it kept. Duplicates (same key), overrefunds, other
 * currencies and payments of other bookings are refused.
 */
export const recordRefund = adminMutation({
	args: { bookingId: v.id('bookings'), expectedRevision: v.number(), ...refundInput },
	handler: async (ctx, { bookingId, expectedRevision, ...input }) => {
		const admin = ctx.admin;
		const replay = await refundReplay(ctx, bookingId, input, admin.email);
		if (replay) return { refundId: replay._id, replayed: true };
		const booking = await loadBooking(ctx, bookingId);
		assertBookingRevision(booking, expectedRevision);
		assertNoLiveCheckout(booking);
		const { refundId } = await recordStayRefund(ctx, booking, input, admin.email);
		return { refundId, replayed: false };
	}
});

/**
 * Cancels a stay. Paid money is kept unless `refund` records a refund of any part of it in the
 * same transaction; cancelling never implies a refund. `notifyGuest` defaults to no for stays that
 * started before today.
 */
export const cancelStay = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		reason: v.optional(v.string()),
		effectiveAt: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		refund: v.optional(v.object(refundInput))
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const refund = args.refund ? { ...args.refund, replayContext: JSON.stringify(['cancel', args.reason?.trim() ?? null, args.effectiveAt ?? null, args.notifyGuest ?? null]) } : undefined;
		if (refund) {
			const replay = await refundReplay(ctx, args.bookingId, refund, admin.email);
			if (replay) return { replayed: true };
		}
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		if (booking.status === 'cancelled') throw new Error('This booking is already cancelled.');
		await cancelStayRecord(ctx, booking, {
			actor: admin.email, reason: args.reason, effectiveAt: args.effectiveAt, notifyGuest: args.notifyGuest, refund
		});
		return { replayed: false };
	}
});

/**
 * Reopens a cancelled, expired or refunded stay. Its refund records and payments stay; money still
 * kept makes it paid and confirmed, otherwise it is unpaid. The nights are checked again (held when
 * confirmed), and a live online checkout or a conflicting stay refuses. An archived villa needs a
 * reason and a stay that started in the past.
 */
export const reopenBooking = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		confirmed: v.boolean(),
		reason: v.string(),
		notifyGuest: v.optional(v.boolean()),
		archivedVillaReason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		if (booking.status !== 'cancelled') throw new Error('Only cancelled, expired or refunded bookings can be reopened.');
		assertNoLiveCheckout(booking);
		const reason = cleanReason(args.reason, 'Reason')!;
		const property = await ctx.db.get(booking.propertyId);
		if (!property) throw new Error('Property not found');
		const archivedReason = archivedVillaPolicy(property, booking.checkIn, args.archivedVillaReason);
		const money = stayMoney(booking);
		const paid = money.net > 0;
		const confirmed = paid || args.confirmed;
		if (!confirmed && booking.source && booking.source !== 'admin') {
			throw new Error('Online bookings reopen as confirmed: unpaid online bookings that are pending expire automatically.');
		}
		if (confirmed) await blockBookingDates(ctx, booking, booking._id);
		else await assertStayFree(ctx, booking.propertyId, booking.checkIn, booking.checkOut, booking._id);
		const notify = resolveNotify(args.notifyGuest, booking);
		await writeBooking(ctx, booking, {
			status: confirmed ? 'confirmed' : 'pending',
			paymentStatus: paid ? 'paid' : 'pending',

			refundedAt: undefined,
			cancelledAt: undefined,
			cancelledBy: undefined,
			cancelReason: undefined,
			cancellationEmailQueuedAt: undefined,
			confirmationCode: booking.confirmationCode ?? demoCode('CONF', booking._id as string),
			// A stale online checkout can't be resumed; a new pay link starts a new one.
			stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined, checkoutRequest: undefined
		}, {
			actor: admin.email, kind: 'reopened', reason,
			details: { notifiedGuest: notify && confirmed, ...(archivedReason ? { archivedVillaReason: archivedReason } : {}) }
		});
		if (notify && confirmed) await queueBookingEmails(ctx, booking, true);
	}
});

export const resendBookingEmails = adminMutation({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		if (!booking || booking.status !== 'confirmed') throw new Error('Only confirmed bookings can be emailed');
		await queueBookingEmails(ctx, booking, true);
	}
});

/**
 * An archived villa is accepted only to record a stay that started in the past, with a reason
 * that is logged. Returns the cleaned reason, or undefined for an active villa.
 */
function archivedVillaPolicy(property: Doc<'properties'>, checkIn: string, archivedVillaReason: string | undefined, requireReason = true) {
	if (property.status === 'active') return undefined;
	if (property.status !== 'archived') throw new Error(PROPERTY_UNAVAILABLE);
	if (checkIn >= resortTodayIso()) throw new Error('Archived villas can only be used to record stays that started in the past.');
	const reason = cleanReason(archivedVillaReason, 'Reason for using an archived villa', false);
	if (!reason && requireReason) throw new Error('This villa is archived. Give a reason to record a past stay in it.');
	assertBookableProperty(property, { allowArchivedProperty: true });
	return reason;
}

function cleanPriceOverride(input: { total: number; reason: string }) {
	assertStayPrice(input.total);
	return { total: input.total, reason: cleanReason(input.reason, 'Reason for the custom price')! };
}

/**
 * Manual / phone booking entered by the host. Pending ones are exempt from the 24h expiry.
 * `notifyGuest` defaults to yes for stays from today on and no for past stays; a booking entered
 * without notification also gets no automatic pre-arrival or review emails.
 */
export const createBooking = adminMutation({
	args: {
		idempotencyKey: v.optional(v.string()),
		propertySlug: v.string(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		/** Confirmed bookings hold the dates straight away (pay later / on arrival). */
		confirmed: v.optional(v.boolean()),
		notifyGuest: v.optional(v.boolean()),
		/** Required to record a past stay in a villa that has since been archived. */
		archivedVillaReason: v.optional(v.string()),
		priceOverride: v.optional(priceOverrideInput),
		/** Release 2: optional coupon, same rules and errors as the public create. */
		couponCode: v.optional(v.string())
	},
	handler: async (ctx, { idempotencyKey, confirmed, notifyGuest, archivedVillaReason, priceOverride, ...args }) => {
		const admin = ctx.admin;
		const key = idempotencyKey === undefined ? undefined : attemptKey(idempotencyKey);
		const couponCode = normalizeCouponCode(args.couponCode ?? '');
		const fingerprint = JSON.stringify([args.propertySlug, args.guestName, args.guestPhone, args.guestEmail, args.checkIn, args.checkOut, args.guests, confirmed, notifyGuest, archivedVillaReason, priceOverride?.total, priceOverride?.reason, ...(couponCode ? [couponCode] : [])]);
		if (key) {
			const previous = await ctx.db.query('bookingCreateAttempts').withIndex('by_key', q => q.eq('key', key)).unique();
			if (previous) {
				if (previous.actor !== admin.email || previous.fingerprint !== fingerprint) throw new Error('This booking was already created with different details. Open it from the calendar to edit it.');
				if (!(await ctx.db.get(previous.bookingId))) throw new Error('This booking was already created and later removed. Start a new booking if needed.');
				return previous.bookingId;
			}
		}
		const notify = resolveNotify(notifyGuest, args);
		const archived = archivedVillaReason?.trim() ? archivedVillaReason : undefined;
		if (archived && args.checkIn >= resortTodayIso()) throw new Error('Archived villas can only be used to record stays that started in the past.');
		const custom = priceOverride ? cleanPriceOverride(priceOverride) : null;
		const { bookingId } = await createBookingRecord(
			ctx,
			{ ...args, source: 'admin', actor: admin.email, guestEmailsOff: !notify, archivedVillaReason: archived ? cleanReason(archived, 'Reason') : undefined },
			{ allowPastCheckIn: true, allowArchivedProperty: Boolean(archived) }
		);
		await ctx.db.patch(bookingId, { confirmationCode: demoCode('CONF', bookingId as string) });
		let booking = (await ctx.db.get(bookingId))!;
		if (custom) {
			booking = await writeBooking(ctx, booking, {
				total: custom.total,
				priceOverride: { total: custom.total, quotedTotal: booking.total, reason: custom.reason, by: admin.email, at: Date.now() }
			}, { actor: admin.email, kind: 'price_set', reason: custom.reason });
		}
		if (confirmed) {
			await blockBookingDates(ctx, booking, bookingId);
			await writeBooking(ctx, booking, { status: 'confirmed' }, { actor: admin.email, kind: 'confirmed', details: { notifiedGuest: notify } });
			if (notify) await queueBookingEmails(ctx, booking);
		}
		if (key) await ctx.db.insert('bookingCreateAttempts', { key, actor: admin.email, bookingId, fingerprint, recordedAt: Date.now() });
		return bookingId;
	}
});

function assertBookingEditable(booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled') throw new Error('Cancelled bookings are read-only. Reopen it first.');
	if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
		throw new Error('The guest has a Stripe checkout open. Wait for it to finish or expire before editing.');
	}
}

/** One read-only policy for preview and save, including override reset and frozen coupon rules. */
async function planBookingEditPricing(
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

/** Preview the same pricing editBooking applies, without reserving capacity or changing the ledger. */
export const quoteBookingEdit = adminQuery({
	args: {
		bookingId: v.id('bookings'), propertySlug: v.string(), checkIn: v.string(), checkOut: v.string(), guests: v.number(),
		clearPriceOverride: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingEditable(booking);
		const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', args.propertySlug)).first();
		if (!property) throw new Error('Property not found');
		const stayChanged = property._id !== booking.propertyId || args.checkIn !== booking.checkIn || args.checkOut !== booking.checkOut;
		// Archived historical stays still need a reason on save; the quote has no reason input.
		if (stayChanged) archivedVillaPolicy(property, args.checkIn, undefined, false);
		assertCapacity(property, args.guests);
		const nights = assertStayDates(args.checkIn, args.checkOut, { allowPastCheckIn: true });
		const { pricing } = await planBookingEditPricing(ctx, booking, property, { checkIn: args.checkIn, checkOut: args.checkOut, nights }, args.clearPriceOverride ? null : undefined, admin.email);
		if (stayChanged) await assertStayFree(ctx, property._id, args.checkIn, args.checkOut, booking._id);
		const next = { ...booking, ...pricing };
		const promotion = next.priceOverride ? undefined : next.promotion;
		return {
			subtotal: next.subtotal, discountAmount: next.discountAmount, total: next.total, currency: next.currency,
			promotion: promotion ? { code: promotion.code, couponVersion: promotion.couponVersion, discount: promotion.discount } : null,
			couponRemoved: Boolean(booking.promotion && !next.promotion), repriced: pricing.total !== undefined
		};
	}
});

/** Refuses a save whose price isn't the one staff reviewed (rates, coupon or currency moved meanwhile). */
function assertReviewedPrice(expected: { total: number; currency: string }, saved: { total: number; currency: string }) {
	if (expected.total === saved.total && expected.currency === saved.currency) return;
	const money = (p: { total: number; currency: string }) => `${p.currency} ${p.total.toLocaleString('en-US')}`;
	throw new Error(`The price changed to ${money(saved)} since you reviewed ${money(expected)}. Check the new price and save again.`);
}

/**
 * Changes a booking's villa, dates, guest count, guest details or price in one transaction.
 * The price is recomputed only when the stay (villa or dates) changes, unless a custom price is
 * set (`priceOverride`, with a reason) or removed (`null`, back to the villa rate). A stay with a
 * custom price must say which when its villa or dates change. Paid bookings keep what was paid,
 * so any difference shows as a balance due or a credit. The guest is emailed about stay, guest
 * count or price changes when `notifyGuest` resolves true (default: not for past stays).
 */
export const editBooking = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		propertyId: v.id('properties'),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		expectedRevision: v.optional(v.number()),
		priceOverride: v.optional(v.union(v.null(), priceOverrideInput)),
		/** The total staff reviewed (quoteBookingEdit, or their custom price); a different saved price is refused. */
		expectedPrice: v.optional(v.object({ total: v.number(), currency: v.string() })),
		notifyGuest: v.optional(v.boolean()),
		archivedVillaReason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		// A price correction always names the revision it was reviewed against.
		assertBookingRevision(booking, args.expectedRevision, args.priceOverride !== undefined);
		assertBookingEditable(booking);

		const guest = cleanGuestDetails(args);
		const property = await ctx.db.get(args.propertyId);
		if (!property) throw new Error('Property not found');
		const stayChanged =
			args.propertyId !== booking.propertyId || args.checkIn !== booking.checkIn || args.checkOut !== booking.checkOut;

		const archivedReason = stayChanged ? archivedVillaPolicy(property, args.checkIn, args.archivedVillaReason) : undefined;
		assertCapacity(property, args.guests);
		// Authenticated hosts can correct historical dates and ongoing stays.
		const nights = assertStayDates(args.checkIn, args.checkOut, { allowPastCheckIn: true });

		const { pricing, priceReason, couponQuote } = await planBookingEditPricing(ctx, booking, property, { checkIn: args.checkIn, checkOut: args.checkOut, nights }, args.priceOverride, admin.email);
		if (args.expectedPrice) assertReviewedPrice(args.expectedPrice, { total: pricing.total ?? booking.total, currency: pricing.currency ?? booking.currency });
		if (couponQuote) await repriceCouponBooking(ctx, couponQuote);

		const holdsDates = booking.status === 'confirmed' || booking.status === 'completed'
			|| (booking.status === 'pending' && booking.source !== 'admin');
		const heldNights = new Set(holdsDates && args.propertyId === booking.propertyId ? stayDates(booking.checkIn, booking.checkOut) : []);
		await releaseBookingDates(ctx, booking);
		// Holding validates too (overlaps and blocks), so it replaces the separate check.
		if (holdsDates) await blockBookingDates(ctx, args, booking._id, heldNights);
		else if (stayChanged) await assertStayFree(ctx, args.propertyId, args.checkIn, args.checkOut, booking._id);

		const nextTotal = pricing.total ?? booking.total;
		const notify = resolveNotify(args.notifyGuest, { checkIn: args.checkIn, guestEmailsOff: booking.guestEmailsOff });
		const guestFacingChange = stayChanged || args.guests !== booking.guests || nextTotal !== booking.total;
		await writeBooking(ctx, booking, {
			propertyId: args.propertyId,
			checkIn: args.checkIn,
			checkOut: args.checkOut,
			guests: args.guests,
			nights,
			...guest,
			...guestLookupFields(guest),
			...pricing,
			// Paid: freeze what was paid. Unpaid: drop the expired checkout so a new amount can be charged.
			...(booking.paymentStatus === 'paid'
				? { amountPaid: booking.amountPaid ?? booking.total }
				: { stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined, checkoutRequest: undefined })
		}, {
			actor: admin.email, kind: 'edited',
			reason: [priceReason, archivedReason && `Archived villa: ${archivedReason}`].filter(Boolean).join(' · ') || undefined,
			details: { notifiedGuest: Boolean(guest.guestEmail && notify && guestFacingChange) }
		});

		if (guest.guestEmail && notify && guestFacingChange) {
			await ctx.scheduler.runAfter(0, internal.emails.sendBookingUpdated, { bookingId: booking._id });
		}
	}
});

/** Why a booking can't be deleted, or null. Anything that involved money must be cancelled instead. */
function deleteBlocker(booking: Doc<'bookings'>, now: number): string | null {
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
async function recordsBlocker(ctx: MutationCtx, booking: Doc<'bookings'>): Promise<string | null> {
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
async function deleteBookingRecord(ctx: MutationCtx, booking: Doc<'bookings'>, actor: string) {
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

/** Removes a test or mistaken booking. Anything that involved money must be cancelled instead. */
export const deleteBooking = adminMutation({
	args: { bookingId: v.id('bookings'), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);
		const blocker = deleteBlocker(booking, Date.now());
		if (blocker) throw new Error(blocker);
		const recordsBlock = await recordsBlocker(ctx, booking);
		if (recordsBlock) throw new Error(recordsBlock);
		await deleteBookingRecord(ctx, booking, admin.email);
	}
});

const DAY_MS = 86_400_000;
const CLEANUP_SCAN_LIMIT = 500;
const MAX_BATCH_DELETE = 100;

/**
 * Bookings the "Clean up" dialog offers to delete: deletable (unpaid pending or cancelled) and either
 * entered by hand in admin or created more than `olderThanDays` ago. Newest first.
 */
export const listCleanupCandidates = adminQuery({
	args: { olderThanDays: v.number() },
	handler: async (ctx, args) => {
		if (!Number.isFinite(args.olderThanDays) || args.olderThanDays < 0) throw new Error('Enter a number of days.');
		const now = Date.now();
		const cutoff = now - args.olderThanDays * DAY_MS;
		const byStatus = (status: 'pending' | 'cancelled') =>
			ctx.db
				.query('bookings')
				.withIndex('by_status', (q) => q.eq('status', status))
				.order('desc')
				.take(CLEANUP_SCAN_LIMIT);
		const rows = [...(await byStatus('pending')), ...(await byStatus('cancelled'))];
		return rows
			.filter((b) => deleteBlocker(b, now) === null && (b.source === 'admin' || b.createdAt <= cutoff))
			.sort((a, b) => b.createdAt - a.createdAt)
			.map(toAdminBooking);
	}
});

/** Batch delete with the same rules as `deleteBooking`; bookings that can't go are skipped with a reason. */
export const deleteBookings = adminMutation({
	args: { bookingIds: v.array(v.id('bookings')) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (args.bookingIds.length > MAX_BATCH_DELETE) {
			throw new Error(`Delete at most ${MAX_BATCH_DELETE} bookings at a time.`);
		}
		const now = Date.now();
		let deleted = 0;
		const skipped: Array<{ bookingId: Id<'bookings'>; reason: string }> = [];
		for (const bookingId of new Set(args.bookingIds)) {
			const booking = await ctx.db.get(bookingId);
			const blocker = booking ? deleteBlocker(booking, now) ?? (await recordsBlocker(ctx, booking)) : 'Booking not found';
			if (!booking || blocker) {
				skipped.push({ bookingId, reason: blocker ?? 'Booking not found' });
				continue;
			}
			await deleteBookingRecord(ctx, booking, admin.email);
			deleted++;
		}
		return { deleted, skipped };
	}
});

export const updateNotes = adminMutation({
	args: { bookingId: v.id('bookings'), notes: v.string(), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);
		const notes = args.notes.trim();
		if (notes.length > 2000) throw new Error('Notes are limited to 2,000 characters.');
		if ((notes || undefined) === booking.adminNotes) return;
		await writeBooking(ctx, booking, { adminNotes: notes || undefined }, { actor: admin.email, kind: 'notes' });
	}
});

/** The booking's payments, refunds and amounts, for the booking sheet and later receipt/refund screens. */
export const bookingFinancials = adminQuery({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		return booking ? await stayFinancials(ctx, booking) : null;
	}
});

/**
 * The booking's history, newest first (recordChanges, entity type `booking`). Starts when booking
 * history shipped; a deleted booking's history stays readable by id.
 */
export const bookingHistory = adminQuery({
	args: { bookingId: v.id('bookings'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const { numItems } = args.paginationOpts;
		if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new Error('Page size must be 1–50');
		return await ctx.db
			.query('recordChanges')
			.withIndex('by_entityType_and_entityId_and_recordedAt', (q) => q.eq('entityType', 'booking').eq('entityId', args.bookingId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

// Host date blocks (owner stay, maintenance). `end` is exclusive: the first free night.

const dateBlockArgs = {
	propertyId: v.id('properties'),
	start: v.string(),
	end: v.string(),
	reason: v.string()
};

const MAX_BLOCKED_NIGHTS_PER_CALL = 1500;

function dateBlockSnapshot(row: { propertyId: Id<'properties'>; start: string; end: string; reason: string }) {
	return { propertyId: row.propertyId, start: row.start, end: row.end, reason: row.reason };
}

function assertDateBlockUnchanged(row: ReturnType<typeof dateBlockSnapshot>, expected?: ReturnType<typeof dateBlockSnapshot>) {
	if (expected && Object.keys(expected).some(key => row[key as keyof typeof row] !== expected[key as keyof typeof expected]))
		throw new Error('This block changed. Reopen it and review the latest dates before saving.');
}

function blockReason(value: string) {
	const reason = value.trim();
	if (!reason) throw new Error('Add a reason for the block.');
	if (reason.length > 200) throw new Error('Keep the reason under 200 characters.');
	return reason;
}

async function validateDateBlock(
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

/** One block per villa over the same nights. Villas with a conflict are reported and skipped; the rest are blocked. */
export const addDateBlocks = adminMutation({
	args: { propertyIds: v.array(v.id('properties')), start: v.string(), end: v.string(), reason: v.string() },
	handler: async (ctx, { propertyIds, start, end, ...args }) => {
		const admin = ctx.admin;
		if (propertyIds.length === 0) throw new Error('Pick at least one villa.');
		if (propertyIds.length > 100) throw new Error('Pick at most 100 villas.');
		// Date and reason problems apply to every villa, so they fail the whole request.
		const nights = assertStayDates(start, end, { allowPastCheckIn: true });
		if (new Set(propertyIds).size * nights > MAX_BLOCKED_NIGHTS_PER_CALL) {
			throw new Error(`Block at most ${MAX_BLOCKED_NIGHTS_PER_CALL} villa nights at a time. Pick fewer villas or a shorter range.`);
		}
		const reason = blockReason(args.reason);
		const results: Array<{ propertyId: Id<'properties'>; blockId: Id<'dateBlocks'> | null; error: string | null }> = [];
		for (const propertyId of new Set(propertyIds)) {
			try {
				// Reads only, so a conflict leaves nothing half-written for this villa.
				if (!(await ctx.db.get(propertyId))) throw new Error('Property not found');
				await assertStayFree(ctx, propertyId, start, end);
			} catch (err) {
				results.push({ propertyId, blockId: null, error: err instanceof Error ? err.message : 'Could not block these dates.' });
				continue;
			}
			const blockId = await ctx.db.insert('dateBlocks', { propertyId, start, end, reason, createdAt: Date.now() });
			await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
			await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: Date.parse(`${start}T00:00:00+07:00`), after: { propertyId, start, end, reason } });
			results.push({ propertyId, blockId, error: null });
		}
		return results;
	}
});

export const addDateBlock = adminMutation({
	args: dateBlockArgs,
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const reason = await validateDateBlock(ctx, args);
		const blockId = await ctx.db.insert('dateBlocks', { ...args, reason, createdAt: Date.now() });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: Date.parse(`${args.start}T00:00:00+07:00`), after: { ...args, reason } });
		return blockId;
	}
});

export const updateDateBlock = adminMutation({
	args: { blockId: v.id('dateBlocks'), ...dateBlockArgs, expected: v.optional(v.object(dateBlockArgs)) },
	handler: async (ctx, { blockId, expected, ...args }) => {
		const admin = ctx.admin;
		const before = await ctx.db.get(blockId);
		if (!before) throw new Error('Block not found');
		assertDateBlockUnchanged(before, expected);
		const heldNights = new Set(args.propertyId === before.propertyId ? stayDates(before.start, before.end) : []);
		await releaseDateBlockRows(ctx, blockId);
		const reason = await validateDateBlock(ctx, args, { rowsCheckedOnWrite: true });
		await ctx.db.patch(blockId, { ...args, reason });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!, heldNights);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'updated', effectiveAt: Date.parse(`${args.start}T00:00:00+07:00`), before: dateBlockSnapshot(before), after: { ...args, reason } });
	}
});

export const removeDateBlock = adminMutation({
	args: { blockId: v.id('dateBlocks'), expected: v.optional(v.object(dateBlockArgs)) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const before = await ctx.db.get(args.blockId);
		if (!before) return;
		assertDateBlockUnchanged(before, args.expected);
		await releaseDateBlockRows(ctx, args.blockId);
		await ctx.db.delete(args.blockId);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: args.blockId, actor: admin.email, kind: 'removed', effectiveAt: Date.parse(`${before.start}T00:00:00+07:00`), before: dateBlockSnapshot(before) });
	}
});
