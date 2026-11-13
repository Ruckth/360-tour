import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, assertNoLiveCheckout, cleanReason } from '../../lib/bookingMoney';
import { writeBooking } from '../private/money';
import { stayMoney } from '../../lib/stayMoney';
import { roundMoney } from '../../lib/orderMath';
import { paymentCancelBlocker, stayPaymentReversalPatch } from '../private/stayCorrections';
import { loadBooking } from '../private/stays';

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
