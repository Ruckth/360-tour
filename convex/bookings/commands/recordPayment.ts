import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, attemptKey, cleanReason } from '../../lib/bookingMoney';
import { manualPaymentMethod } from '../../lib/financeValidators';
import { assertNotOnOpenOrder } from '../../lib/orderLinks';
import { loadBooking, recordStayPayment } from '../private/stays';

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
