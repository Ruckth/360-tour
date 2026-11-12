import type { Infer } from 'convex/values';
import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { recordStayPayment } from '../../bookings/model';
import { syncAffiliateCredit } from '../../lib/affiliateCredits';
import { STALE_APPOINTMENT, recordAppointmentChange } from '../../lib/appointmentChanges';
import { STALE_BOOKING, bookingRevision, cleanReason } from '../../lib/bookingMoney';
import { activeLineLink } from '../../lib/lineLinks';
import { formatReceiptNumber, orderTitle } from '../../lib/orderMath';
import { assertLineHasNoPosRefunds } from '../../lib/orderRefunds';
import { canReadCheckoutOrder, requireCashierAction, type StaffActor } from '../../lib/staffAccess';
import { assertCorrectionRevision, correctionReplay, linkPaidLineArgs, oneSource, unlinkPaidLineArgs } from './orderModel';
import { appointmentLinkProblem, bookingLinkProblem, linkReversal, linkableRow } from './paidLinkModel';

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeLinkPaidLine(ctx: MutationCtx, args: Infer<typeof linkPaidLineArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'paymentFix');
		const source = oneSource(args);
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'linked');
		if (existing) {
			const same = existing.lineId === args.lineId && ('bookingId' in source ? existing.bookingId === source.bookingId : existing.appointmentId === source.appointmentId);
			if (!same) throw new ConvexError('This link attempt was already used for something else. Start again.');
			return { sequence: existing.sequence, linkId: existing.linkId!, replayed: true };
		}
		const order = await ctx.db.get(args.orderId);
		if (!order || !canReadCheckoutOrder(admin, order)) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s rows can be linked.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the link')!;
		const { line, target, amount } = linkableRow(order, await ctx.db.get(args.lineId));
		await assertLineHasNoPosRefunds(ctx, line._id);
		if (await activeLineLink(ctx, line._id)) throw new ConvexError('This row is already linked. Unlink it first.');
		const now = Date.now();
		const effectiveAt = order.paymentEffectiveAt ?? order.paidAt ?? now;
		const sequence = (order.correctionRevision ?? 0) + 1;
		const title = orderTitle(order.orderNumber);
		const note = `Paid on ${title}${order.receiptNumber !== undefined ? ` (receipt ${formatReceiptNumber(order.receiptNumber)})` : ''}, linked later: ${reason}`;
		let link: Omit<Doc<'orderLineLinks'>, '_id' | '_creationTime'>;
		const base = {
			orderId: order._id, lineId: line._id, amount, currency: line.currency, status: 'active' as const, effectiveAt,
			reason, linkedAt: now, linkedBy: admin.email, sequence
		};
		if ('appointmentId' in source) {
			if (target !== 'appointment') throw new ConvexError('A room row is linked to a stay, not an appointment.');
			const appointment = await ctx.db.get(source.appointmentId);
			if (!appointment) throw new ConvexError('Appointment not found');
			if ((appointment.revision ?? 0) !== args.expectedTargetRevision) throw new ConvexError(STALE_APPOINTMENT);
			const problem = await appointmentLinkProblem(ctx, line, appointment);
			if (problem) throw new ConvexError(problem);
			// The same fields settleOrder writes when the appointment is paid at checkout.
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: amount, amountPaid: amount, amountRefunded: 0, paidAt: effectiveAt, paidBy: admin.email },
				{ actor: admin.email, kind: 'payment', reason: note, effectiveAt });
			link = { ...base, kind: 'appointment', appointmentId: appointment._id, appointmentPriceBefore: appointment.price };
		} else {
			if (target !== 'booking') throw new ConvexError('A service row is linked to an appointment, not a stay.');
			const booking = await ctx.db.get(source.bookingId);
			if (!booking) throw new ConvexError('Booking not found');
			if (bookingRevision(booking) !== args.expectedTargetRevision) throw new ConvexError(STALE_BOOKING);
			const problem = await bookingLinkProblem(ctx, order, line, booking, amount);
			if (problem) throw new ConvexError(problem);
			const { paymentId } = await recordStayPayment(ctx, booking._id, {
				origin: 'pos', method: 'order', actor: admin.email, paymentLabel: 'pos', effectiveAt, orderId: order._id, amount, note, notifyGuest: args.notifyGuest
			});
			if (!paymentId) throw new ConvexError('Nothing is left to pay on this stay.');
			link = {
				...base, kind: 'booking', bookingId: booking._id, bookingPaymentId: paymentId, bookingPaymentStatusBefore: booking.paymentStatus,
				...(booking.paidAt !== undefined ? { bookingPaidAtBefore: booking.paidAt } : {})
			};
		}
		const linkId = await ctx.db.insert('orderLineLinks', link);
		await ctx.db.insert('orderCorrections', {
			orderId: order._id, sequence, kind: 'linked', reason, actor: admin.email, recordedAt: now, idempotencyKey: key,
			lineId: line._id, linkId, amount, ...('appointmentId' in source ? { appointmentId: source.appointmentId } : { bookingId: source.bookingId })
		});
		await ctx.db.patch(order._id, { correctionRevision: sequence, updatedAt: now });
		await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email);
		return { sequence, linkId, replayed: false };
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeUnlinkPaidLine(ctx: MutationCtx, args: Infer<typeof unlinkPaidLineArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'paymentFix');
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'unlinked');
		if (existing) {
			if (existing.linkId !== args.linkId) throw new ConvexError('This unlink attempt was already used for something else. Start again.');
			return { sequence: existing.sequence, replayed: true };
		}
		const order = await ctx.db.get(args.orderId);
		if (!order || !canReadCheckoutOrder(admin, order)) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s links can be undone.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the unlink')!;
		const link = await ctx.db.get(args.linkId);
		if (!link || link.orderId !== order._id) throw new ConvexError('Link not found on this order');
		if (link.status !== 'active') throw new ConvexError('This link was already undone.');
		const line = await ctx.db.get(link.lineId);
		const reverse = await linkReversal(ctx, link, line?.name ?? 'This row', { paymentUnlinked: true });
		const now = Date.now();
		const sequence = (order.correctionRevision ?? 0) + 1;
		await reverse(admin.email, `Unlinked from ${orderTitle(order.orderNumber)}: ${reason}`);
		await ctx.db.patch(link._id, { status: 'unlinked', unlinkedAt: now, unlinkedBy: admin.email, unlinkReason: reason, unlinkSequence: sequence });
		await ctx.db.insert('orderCorrections', {
			orderId: order._id, sequence, kind: 'unlinked', reason, actor: admin.email, recordedAt: now, idempotencyKey: key,
			lineId: link.lineId, linkId: link._id, amount: link.amount, ...(link.appointmentId ? { appointmentId: link.appointmentId } : { bookingId: link.bookingId })
		});
		await ctx.db.patch(order._id, { correctionRevision: sequence, updatedAt: now });
		await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email, 'payment_unlinked');
		return { sequence, replayed: false };
}
