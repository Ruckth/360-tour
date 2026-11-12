import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { Doc, Id } from '../_generated/dataModel';
import { adminQuery } from '../auth/model';
import { isHistoricalStay, resolveNotify, stayMoney } from '../lib/bookingMoney';
import { assertCapacity, assertStayDates, assertStayFree } from '../lib/bookingWrites';
import { nightsBetween } from '../lib/dates';
import { readBudget } from '../lib/readBudget';
import { stayFinancials } from '../lib/stayCorrections';
import { MAX_ROWS_PER_NIGHT, scanOverlappingBookings, scanOverlappingDateBlocks } from '../lib/stayOverlap';
import { assertValidIsoDate } from '../lib/validation';
import { archivedVillaPolicy, assertBookingEditable, CLEANUP_SCAN_LIMIT, DAY_MS, deleteBlocker, GuestSuggestion, loadBooking, MAX_CALENDAR_DAYS, MAX_CALENDAR_VILLAS, MAX_GUEST_SUGGESTIONS, planBookingEditPricing, SEARCH_SCAN_LIMIT, toAdminBooking } from './model';

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
