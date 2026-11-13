import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { recordAppointmentChange, appointmentMoney } from '../../services/model';
import { assertNoLiveCheckout } from '../../lib/bookingMoney';
import { writeBooking, MAX_STAY_ROWS, stayPaymentReversalPatch } from '../../bookings/model';
import { stayMoney } from '../../lib/stayMoney';
import { activeSourceLink } from '../../lib/lineLinks';
import { openOrderCharging } from '../../lib/orderLinks';
import { bookingBalance, lineNet, orderTitle, roundMoney } from '../../lib/orderMath';
import { CURRENCY, LINK_TARGET, Line, Order, ReadCtx, appointmentAttachable, bookingCheckoutBlock, bookingClosedReason, sourceRows } from './orderModel';

/** The paid row to link, or why it can't be. */
export function linkableRow(order: Order, line: Line | null) {
	if (!line || line.orderId !== order._id) throw new ConvexError('Item not found on this order');
	const target = LINK_TARGET[line.kind];
	if (!target || line.fee) throw new ConvexError('Only a paid service or room row can be linked to an appointment or stay');
	const amount = lineNet(line);
	if (amount <= 0) throw new ConvexError('Nothing was charged for this row, so there is no payment to apply');
	return { line, target, amount };
}

/** Why this appointment can't take this paid service row, or null. Nothing is written. */
export async function appointmentLinkProblem(ctx: ReadCtx, line: Line, appointment: Doc<'appointments'>) {
	if (!appointmentAttachable(appointment)) return 'This appointment is already paid, cancelled or a no-show.';
	if (appointment.serviceId !== line.serviceId) return 'This is a different service. Only an appointment for the same service can take this payment.';
	if (appointment.currency !== CURRENCY) return `This appointment is priced in ${appointment.currency}.`;
	if (await activeSourceLink(ctx, { appointmentId: appointment._id })) return 'This appointment is already linked to another paid row.';
	const open = await openOrderCharging(ctx, { appointmentId: appointment._id });
	if (open) return `This appointment is on ${orderTitle(open.orderNumber)}, which is still open. Take the payment there, or remove it from that order first.`;
	return null;
}

/** Why this stay can't take this paid room row, or null. Nothing is written. */
export async function bookingLinkProblem(ctx: ReadCtx, order: Order, line: Line, booking: Doc<'bookings'>, amount: number) {
	const closed = bookingClosedReason(booking);
	if (closed) return `${closed}.`;
	const online = bookingCheckoutBlock(booking);
	if (online) return online;
	if (booking.propertyId !== line.propertyId) return 'This stay is in a different villa. Only a stay in the same villa can take this payment.';
	if (booking.currency !== CURRENCY) return `This stay is priced in ${booking.currency}.`;
	if (await activeSourceLink(ctx, { bookingId: booking._id })) return 'This stay is already linked to another paid row.';
	const open = await openOrderCharging(ctx, { bookingId: booking._id });
	if (open) return `This stay is on ${orderTitle(open.orderNumber)}, which is still open. Take the payment there, or remove it from that order first.`;
	if ((await sourceRows(ctx, order._id)).some((row) => row.bookingId === booking._id)) return 'This order already paid for this stay at checkout.';
	const { owed } = bookingBalance(booking);
	if (owed <= 0) return 'Nothing is left to pay on this stay.';
	if (amount > owed) return `This stay owes ${(owed / 100).toLocaleString('en-US')} ${booking.currency}, less than this row's ${(amount / 100).toLocaleString('en-US')}. Correct the stay's price first, or link a smaller charge.`;
	if (amount < owed && booking.paymentStatus !== 'pending' && booking.paymentStatus !== 'paid') return 'This stay can only be paid in full here. Reopen it first.';
	return null;
}

/**
 * Proves an active link can be undone exactly, writing nothing, and returns the reversal to run:
 * the appointment goes back to unpaid at its price before the link; the stay's payment from the
 * link is cancelled and its payment status restored. Refused if any of that money was refunded or
 * the target changed since (repaid, repriced, refunded, or under an online checkout).
 */
export async function linkReversal(ctx: MutationCtx, link: Doc<'orderLineLinks'>, name: string, options: { paymentUnlinked?: boolean } = {}) {
	if (link.appointmentId) {
		const appointment = await ctx.db.get(link.appointmentId);
		if (!appointment) throw new ConvexError(`${name}: the appointment was deleted, so its payment can't be reversed.`);
		if (appointmentMoney(appointment).refunded > 0 || await ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', appointment._id)).first())
			throw new ConvexError(`${name}: part of the appointment's payment was refunded, so it can't be unlinked.`);
		if (appointment.paymentStatus !== 'paid' || appointment.price !== link.amount || (appointment.amountPaid ?? appointment.price) !== link.amount)
			throw new ConvexError(`${name}: the appointment changed since it was linked (repaid or repriced), so it can't be unlinked automatically.`);
		return async (actor: string, reason: string) => {
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'unpaid', price: link.appointmentPriceBefore ?? appointment.price, amountPaid: 0, amountRefunded: 0, paidAt: undefined, paidBy: undefined },
				{ actor, kind: 'payment', reason });
		};
	}
	const booking = link.bookingId ? await ctx.db.get(link.bookingId) : null;
	if (!booking) throw new ConvexError(`${name}: the stay was deleted, so its payment can't be reversed.`);
	assertNoLiveCheckout(booking);
	const payment = link.bookingPaymentId ? await ctx.db.get(link.bookingPaymentId) : null;
	if (!payment || payment.status !== 'recorded') throw new ConvexError(`${name}: the stay's payment from this link was already reversed.`);
	if (payment.refunded > 0) throw new ConvexError(`${name}: part of what this link paid on the stay was refunded, so it can't be unlinked.`);
	const money = stayMoney(booking);
	const gross = roundMoney(money.gross - payment.amount);
	if (gross < money.refunded) throw new ConvexError(`${name}: refunds on the stay would exceed what is left paid.`);
	const reversal = await stayPaymentReversalPatch(ctx, booking, gross);
	// A stay that was pending before the link (a deposit, say) goes back to pending, not "paid",
	// unless it was paid again since (then it is a paid stay owing this amount again).
	const paidSince = (await ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id).gt('recordedAt', payment.recordedAt)).take(MAX_STAY_ROWS))
		.some((row) => row.status === 'recorded');
	const patch = link.bookingPaymentStatusBefore === 'pending' && reversal.paymentStatus === 'paid' && !paidSince
		? { ...reversal, paymentStatus: 'pending' as const, paidAt: link.bookingPaidAtBefore }
		: reversal;
	return async (actor: string, reason: string) => {
		await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: actor, cancelReason: reason });
		await writeBooking(ctx, booking, patch, { actor, kind: 'payment_cancelled', reason, details: { paymentId: payment._id, orderId: link.orderId, amount: payment.amount, linkId: link._id } }, options);
	};
}
