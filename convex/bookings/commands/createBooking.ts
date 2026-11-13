import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { blockBookingDates } from '../private/availabilityWrites';
import { attemptKey, cleanReason, resolveNotify } from '../../shared/bookingMoney';
import { writeBooking } from '../private/money';
import { createBookingRecord } from '../private/bookingWrites';
import { demoCode } from '../../shared/codes';
import { resortTodayIso } from '../../shared/time';
import { normalizeCouponCode } from '../../shared/offers';
import { cleanPriceOverride, priceOverrideInput, queueBookingEmails } from '../private/stays';

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
