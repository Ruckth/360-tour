import { captureAffiliateSnapshot, syncAffiliateCredit } from './affiliateCredits';
import { resolveMarketingAttribution, type MarketingCapture } from './marketingAttribution';
import { ConvexError } from 'convex/values';
import { evaluateOffer, normalizeCouponCode } from './offers';
import { couponUnavailable, couponVersion, holdCouponRedemption } from './couponRedemptions';
import { getEffectiveSettings } from './siteSettings';
import { resortLocalParts } from './serviceSlots';
import { blockBookingDates } from './availabilityWrites';
import { internal } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { nightsBetween, resortTodayIso } from './dates';
import { assertPositiveInt, assertValidEmail, assertValidIsoDate } from './validation';
import { calculateDirectQuote } from './pricing';
import { assertNoBookingOverlap, findBlockingNight, STAY_BLOCKED_ERROR } from './stayOverlap';
import { ensureLinkedOrder } from './orderLinks';
import { appendBookingHistory, bookingSnapshot } from './bookingMoney';

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
	/** Who created it (an admin's email), recorded on the booking, its history and its order. Defaults to the channel. */
	actor?: string;
	/** Historical entries made without telling the guest; lifecycle emails then skip the booking. */
	guestEmailsOff?: boolean;
	/** Why an archived villa is used (staff historical entry only); logged in the booking history. */
	archivedVillaReason?: string;
	/** Release 2: optional coupon code; see holdCouponRedemption. */
	couponCode?: string;
	/** Release 3a: untrusted browser capture; resolved by resolveMarketingAttribution. Ignored for admin bookings. */
	marketing?: MarketingCapture;
};

/** Server-only policy: callers must authenticate the admin before enabling either relaxation. */
type StayPolicy = {
	allowPastCheckIn?: boolean;
	admin?: boolean;
	/** Accept an archived (not draft) villa, for recording a past stay there. */
	allowArchivedProperty?: boolean;
};

export const PROPERTY_UNAVAILABLE = 'Property is not available for booking';

/** Throws unless an archived villa is explicitly allowed for this (historical) stay. */
export function assertBookableProperty(property: Doc<'properties'>, policy: StayPolicy = {}) {
	if (property.status === 'active') return;
	if (property.status === 'archived' && policy.allowArchivedProperty) return;
	throw new Error(PROPERTY_UNAVAILABLE);
}

export async function loadProperty(
	ctx: QueryCtx | MutationCtx,
	slug: string,
	policy: StayPolicy = {}
): Promise<Doc<'properties'>> {
	const property = await ctx.db
		.query('properties')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.first();

	if (!property) {
		throw new Error('Property not found');
	}
	assertBookableProperty(property, policy);

	return property;
}

/** Throws unless [checkIn, checkOut) is free of other confirmed bookings and blocked nights. */
export async function assertStayFree(
	ctx: QueryCtx | MutationCtx,
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	excludeBookingId?: Id<'bookings'>
): Promise<void> {
	await assertNoBookingOverlap(ctx, propertyId, checkIn, checkOut, excludeBookingId);
	if (await findBlockingNight(ctx, propertyId, checkIn, checkOut, excludeBookingId)) {
		throw new Error(STAY_BLOCKED_ERROR);
	}
}

/** Validates the date pair and returns the number of nights. */
export function assertStayDates(checkIn: string, checkOut: string, { allowPastCheckIn = false } = {}): number {
	assertValidIsoDate(checkIn, 'Check-in date');
	assertValidIsoDate(checkOut, 'Check-out date');
	if (!allowPastCheckIn && checkIn < resortTodayIso()) {
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

/** The exact-lookup forms stored with a booking's guest details (see schema `guestPhoneDigits`). */
export function guestLookupFields(guest: { guestPhone: string; guestEmail?: string }) {
	return {
		guestPhoneDigits: guest.guestPhone.replace(/\D/g, '') || undefined,
		guestEmailNormalized: guest.guestEmail?.trim().toLowerCase() || undefined
	};
}

/** Validates a stay (dates, capacity, overlap, blocked dates) and prices it. */
export async function quoteBookableStay(ctx: QueryCtx | MutationCtx, input: StayInput, policy: StayPolicy = {}) {
	assertValidIsoDate(input.checkIn, 'Check-in date');
	assertValidIsoDate(input.checkOut, 'Check-out date');
	assertPositiveInt(input.guests, 'Guest count');

	const property = await loadProperty(ctx, input.propertySlug, policy);
	assertCapacity(property, input.guests);
	const nights = assertStayDates(input.checkIn, input.checkOut, policy);
	if (!policy.admin) {
		const { bookingRules: rules } = await getEffectiveSettings(ctx);
		const local = resortLocalParts(Date.now());
		if (input.checkIn < local.date) throw new Error('Check-in date cannot be in the past');
		if (nights < rules.minNights) throw new Error(`Minimum stay is ${rules.minNights} nights.`);
		if (nightsBetween(local.date, input.checkIn) > rules.maxAdvanceDays)
			throw new Error(`Check-in must be within ${rules.maxAdvanceDays} days.`);
		if (input.checkIn === local.date && rules.sameDayCutoff && local.time >= rules.sameDayCutoff)
			throw new Error(`Same-day check-in closes at ${rules.sameDayCutoff} resort time.`);
	}
	await assertStayFree(ctx, property._id, input.checkIn, input.checkOut);

	return { property, nights, quote: calculateDirectQuote(property, nights) };
}

export async function createBookingRecord(ctx: MutationCtx, input: BookingInput, policy: StayPolicy = {}) {
	const { guestName, guestPhone, guestEmail } = cleanGuestDetails(input);
	const { property, nights, quote } = await quoteBookableStay(ctx, input, { ...policy, admin: input.source === 'admin' });
	const code = normalizeCouponCode(input.couponCode ?? '');
	const coupon = code ? await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique() : null;
	if (code && !coupon) couponUnavailable({ code: 'not_found' });
	const rules = coupon ? await couponVersion(ctx, coupon._id, coupon.currentVersion) : null;
	const offer = coupon && rules ? evaluateOffer({
		lines: [{ id: 'accommodation', kind: 'accommodation', propertySlug: property.slug, checkIn: input.checkIn, checkOut: input.checkOut, nights, amount: quote.subtotal }],
		directDiscountPercent: property.directDiscountPercent, today: resortTodayIso(),
		coupon: { ...rules, code: coupon.code, version: coupon.currentVersion, status: coupon.status, used: coupon.used, discountGranted: coupon.discountGranted, held: coupon.held, heldDiscount: coupon.heldDiscount }
	}) : null;
	if (offer?.couponStatus === 'invalid') couponUnavailable(offer.problem!);
	if (offer?.couponStatus === 'applied' && offer.total === 0) {
		throw new ConvexError({ code: 'coupon_unavailable', message: "This code covers the whole stay, so it can't be booked online. Please contact us.", problem: { code: 'nothing_eligible' } });
	}
	const actor = input.actor ?? `system:${input.source}`;

	const accessToken = crypto.randomUUID();
	const { guestPhoneDigits, guestEmailNormalized } = guestLookupFields({ guestPhone, guestEmail });
	const createdAt = Date.now();
	const marketingAttribution = input.source !== 'admin' && input.marketing
		? await resolveMarketingAttribution(ctx, input.marketing, createdAt) : undefined;
	const unpaidHoldExpiresAt = input.source === 'admin' ? undefined
		: createdAt + (await getEffectiveSettings(ctx)).bookingRules.unpaidHoldMinutes * 60_000;
	const bookingId = await ctx.db.insert('bookings', {
		propertyId: property._id,
		tenantId: property.tenantId,
		guestName,
		...(guestEmail ? { guestEmail } : {}),
		guestPhone,
		...(guestPhoneDigits ? { guestPhoneDigits } : {}),
		...(guestEmailNormalized ? { guestEmailNormalized } : {}),
		source: input.source,
		...(marketingAttribution ? { marketingAttribution } : {}),
		...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
		checkIn: input.checkIn,
		checkOut: input.checkOut,
		guests: input.guests,
		nights,
		subtotal: offer?.subtotal ?? quote.subtotal,
		discountAmount: offer?.discount ?? quote.discountAmount,
		total: offer?.total ?? quote.directTotal,
		currency: quote.currency,
		accessToken,
		paymentStatus: 'pending',
		status: 'pending',
		revision: 0,
		createdBy: actor,
		...(input.guestEmailsOff ? { guestEmailsOff: true } : {}),
		createdAt,
		unpaidHoldExpiresAt
	});
	if (coupon && offer?.couponStatus === 'applied') {
		const redemptionId = await holdCouponRedemption(ctx, { coupon, couponVersion: coupon.currentVersion, discount: offer.discount, bookingId });
		await ctx.db.patch(bookingId, { promotion: { couponId: coupon._id, couponVersion: coupon.currentVersion, code: coupon.code, discount: offer.discount, redemptionId } });
	}
	const affiliateSnapshot = await captureAffiliateSnapshot(ctx, {linkId: marketingAttribution?.last?.linkId, marketing: input.source !== 'admin' ? input.marketing : undefined, couponId: coupon && offer?.couponStatus === 'applied' ? coupon._id : undefined, propertySlug: property.slug, guestEmail, staff: input.source === 'admin'});
	await ctx.db.patch(bookingId, {affiliateSnapshot});
	await syncAffiliateCredit(ctx, {bookingId}, actor);
	const created = (await ctx.db.get(bookingId))!;
	if (input.source !== 'admin') {
		await blockBookingDates(ctx, created, bookingId);
		await ctx.scheduler.runAt(
			unpaidHoldExpiresAt!,
			internal.crons.expireBookingHold,
			{ bookingId, expectedRevision: created.revision ?? 0 }
		);
	}
	await appendBookingHistory(ctx, bookingId, {
		actor, kind: 'created',
		...(input.archivedVillaReason ? { reason: input.archivedVillaReason } : {}),
		after: { ...bookingSnapshot(created), ...(property.status !== 'active' ? { villaStatus: property.status } : {}) }
	});
	// Every booking has its order from the start, empty until staff open it at checkout.
	await ensureLinkedOrder(ctx, { bookingId }, actor);

	return { bookingId, accessToken };
}
