import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { blockBookingDates } from '../private/availabilityWrites';
import { assertBookingRevision, assertNoLiveCheckout, cleanReason, resolveNotify } from '../../lib/bookingMoney';
import { writeBooking } from '../private/money';
import { stayMoney } from '../../lib/stayMoney';
import { assertStayFree } from '../private/bookingWrites';
import { demoCode } from '../../lib/codes';
import { archivedVillaPolicy, loadBooking, queueBookingEmails } from '../private/stays';

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
