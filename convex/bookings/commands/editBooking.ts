import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { adminMutation } from '../../auth/model';
import { blockBookingDates, releaseBookingDates } from '../private/availabilityWrites';
import { assertBookingRevision, resolveNotify } from '../../lib/bookingMoney';
import { writeBooking } from '../private/money';
import { assertCapacity, assertStayDates, assertStayFree, cleanGuestDetails, guestLookupFields } from '../private/bookingWrites';
import { repriceCouponBooking } from '../../marketing/model';
import { stayDates } from '../../lib/dates';
import { archivedVillaPolicy, assertBookingEditable, assertReviewedPrice, loadBooking, planBookingEditPricing, priceOverrideInput } from '../private/stays';

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
			await ctx.scheduler.runAfter(0, internal.bookings.emails.sendBookingUpdated, { bookingId: booking._id });
		}
	}
});
