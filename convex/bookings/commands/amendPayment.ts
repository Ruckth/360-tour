import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, cleanReason, effectiveTime, type BookingPatch } from '../../lib/bookingMoney';
import { writeBooking } from '../private/money';
import { manualPaymentMethod } from '../../lib/financeValidators';
import { paymentAmendBlocker } from '../private/stayCorrections';
import { loadBooking } from '../private/stays';

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
