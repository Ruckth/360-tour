import type { Infer } from 'convex/values';
import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { syncAffiliateCredit } from '../../marketing/model';
import { recordAppointmentChange, appointmentMoney } from '../../services/model';
import { appendBookingHistory, writeBooking, orderStayPayment, stayPaymentReversalPatch } from '../../bookings/model';
import { assertNoLiveCheckout, cleanReason, effectiveTime } from '../../lib/bookingMoney';
import { stayMoney } from '../../lib/stayMoney';
import { syncOrderCouponRedemption } from '../../marketing/model';
import { resortTodayIso } from '../../lib/dates';
import { orderLineLinks } from '../../lib/lineLinks';
import { assertTenders, lineNet, orderTitle, roundMoney } from '../../lib/orderMath';
import { assertNoPosRefunds } from '../../lib/orderRefunds';
import { canReadCheckoutOrder, requireCashierAction, type StaffActor } from '../../auth/model';
import { assertCustomerCanLink, assertCustomerReviewed } from './customerModel';
import { Line, MISSING_PAYMENT_EVIDENCE, Order, amendOrderPaymentArgs, assertCorrectionRevision, cleanTender, correctionReplay, sourceRows, voidUnreceivedOrderArgs } from './orderModel';
import { linkReversal } from './paidLinkModel';

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeAmendOrderPayment(ctx: MutationCtx, args: Infer<typeof amendOrderPaymentArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'paymentFix');
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'amended');
		if (existing) return { sequence: existing.sequence, replayed: true };
		const order = await ctx.db.get(args.orderId);
		if (!order || !canReadCheckoutOrder(admin, order)) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s payment can be corrected.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the correction')!;
		const payments = await ctx.db.query('orderPayments').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).take(10);
		const paidTotal = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
		const now = Date.now();
		const patch: Partial<Order> = {};
		const correction: Partial<Doc<'orderCorrections'>> = {};

		if (args.tenders) {
			if (paidTotal === 0) throw new ConvexError('Nothing was paid on this order, so there are no tenders to correct.');
			assertTenders(args.tenders, paidTotal);
			const before = order.amendedTenders ?? payments.map(cleanTender);
			const after = args.tenders.map(cleanTender);
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				patch.amendedTenders = after;
				correction.tendersBefore = before;
				correction.tendersAfter = after;
			}
		}
		const previousEffective = order.paymentEffectiveAt ?? order.paidAt ?? now;
		let newEffective: number | undefined;
		if (args.effectiveAt !== undefined) {
			const at = effectiveTime(args.effectiveAt, now);
			const firstRefund = await ctx.db.query('orderRefunds').withIndex('by_orderId_and_businessDate', q => q.eq('orderId', order._id)).first();
			if (firstRefund && resortTodayIso(at) > firstRefund.businessDate)
				throw new ConvexError({ code: 'PAYMENT_DATE_AFTER_REFUND', message: 'Payment business date cannot be later than the earliest POS refund.', earliestRefundBusinessDate: firstRefund.businessDate });
			if (at !== previousEffective) {
				newEffective = at;
				patch.paymentEffectiveAt = at;
				correction.effectiveAtBefore = previousEffective;
				correction.effectiveAtAfter = at;
			}
		}
		if (args.customer) {
			const before = order.amendedCustomer !== undefined ? order.amendedCustomer : (order.customerSnapshot ?? null);
			let after: Doc<'orders'>['amendedCustomer'] = null;
			if (args.customer.customerId) {
				const customer = assertCustomerCanLink(await ctx.db.get(args.customer.customerId));
				assertCustomerReviewed(customer, args.customer.expectedCustomerRevision);
				after = { name: customer.name, ...(customer.phone ? { phone: customer.phone } : {}), ...(customer.email ? { email: customer.email } : {}) };
			}
			const idBefore = order.customerId ?? null;
			const idAfter = args.customer.customerId;
			if (idBefore !== idAfter || JSON.stringify(before) !== JSON.stringify(after)) {
				patch.amendedCustomer = after;
				patch.customerId = idAfter ?? undefined;
				Object.assign(correction, { customerBefore: before, customerAfter: after, customerIdBefore: idBefore, customerIdAfter: idAfter });
			}
		}
		if (!Object.keys(patch).length) throw new ConvexError('Nothing changed.');

		const sequence = (order.correctionRevision ?? 0) + 1;
		await ctx.db.insert('orderCorrections', { orderId: order._id, sequence, kind: 'amended', reason, actor: admin.email, recordedAt: now, idempotencyKey: key, ...correction });
		await ctx.db.patch(order._id, { ...patch, correctionRevision: sequence });

		// Both checkout sources and later links follow the same correction rules.
		const [chargedRows, linkedRows] = await Promise.all([sourceRows(ctx, order._id), orderLineLinks(ctx, order._id, 'active')]);
		const sources = [
			...chargedRows.map((row) => ({ bookingId: row.bookingId, appointmentId: row.appointmentId, link: null })),
			...linkedRows.map((link) => ({ bookingId: link.bookingId, appointmentId: link.appointmentId, link }))
		];
		for (const { bookingId, appointmentId, link } of sources) {
			if (link && newEffective !== undefined) await ctx.db.patch(link._id, { effectiveAt: newEffective });
			if (bookingId) {
				const booking = await ctx.db.get(bookingId);
				if (!booking) continue;
				const payment = link?.bookingPaymentId ? await ctx.db.get(link.bookingPaymentId) : await orderStayPayment(ctx, order._id, booking._id);
				const details = {
					orderId: order._id, sequence, tendersChanged: Boolean(patch.amendedTenders), customerChanged: 'amendedCustomer' in patch,
					...(link ? { linkId: link._id } : {})
				};
				if (newEffective !== undefined && payment?.status === 'recorded') {
					await ctx.db.patch(payment._id, { effectiveAt: newEffective, amendedAt: now, amendedBy: admin.email });
					await writeBooking(ctx, booking, booking.paidAt === payment.effectiveAt ? { paidAt: newEffective } : {}, {
						actor: admin.email, kind: 'payment_amended', reason, effectiveAt: newEffective,
						details: { ...details, paymentId: payment._id, before: { effectiveAt: payment.effectiveAt }, after: { effectiveAt: newEffective } }
					});
				} else {
					await appendBookingHistory(ctx, booking._id, { actor: admin.email, kind: 'order_payment_amended', reason, after: details });
				}
			}
			if (appointmentId && newEffective !== undefined) {
				const appointment = await ctx.db.get(appointmentId);
				if (appointment?.paymentStatus === 'paid' && appointment.paidAt === previousEffective) {
					await recordAppointmentChange(ctx, appointment, { paidAt: newEffective }, { actor: admin.email, kind: 'payment', reason, effectiveAt: newEffective });
				}
			}
		}
		return { sequence, replayed: false };
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeVoidUnreceivedOrder(ctx: MutationCtx, args: Infer<typeof voidUnreceivedOrderArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'paymentFix');
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'void_unreceived');
		if (existing) return { replayed: true };
		const order = await ctx.db.get(args.orderId);
		if (!order || !canReadCheckoutOrder(admin, order)) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order can be voided');
		await assertNoPosRefunds(ctx, order._id);
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason')!;

		// Prove every reversal before writing anything.
		if (await ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', order._id)).first())
			throw new ConvexError('Part of this order was refunded, so money was received.');
		const stays: Array<{ booking: Doc<'bookings'>; payment: Doc<'bookingPayments'> }> = [];
		const appointments: Array<{ appointment: Doc<'appointments'>; line: Line }> = [];
		for (const row of await sourceRows(ctx, order._id)) {
			if (row.bookingId) {
				const booking = await ctx.db.get(row.bookingId);
				if (!booking) throw new ConvexError(`${row.name} was deleted, so its payment can't be reversed.`);
				// Reopening a balance under a live online checkout would make its completion unrecordable.
				assertNoLiveCheckout(booking);
				const payment = await orderStayPayment(ctx, order._id, booking._id);
				if (!payment) throw new ConvexError(MISSING_PAYMENT_EVIDENCE(row.name));
				if (payment.status !== 'recorded') throw new ConvexError(`${row.name}: this payment was already reversed.`);
				if (payment.refunded > 0) throw new ConvexError(`Part of what this order took for ${row.name} was refunded, so money was received.`);
				const money = stayMoney(booking);
				if (roundMoney(money.gross - payment.amount) < money.refunded) throw new ConvexError(`Refunds on ${row.name} would exceed what is left paid.`);
				stays.push({ booking, payment });
			}
			if (row.appointmentId) {
				const appointment = await ctx.db.get(row.appointmentId);
				if (!appointment) throw new ConvexError(`${row.name} was deleted, so its payment can't be reversed.`);
				if (appointmentMoney(appointment).refunded > 0 || await ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', appointment._id)).first())
					throw new ConvexError(`Part of ${row.name} was refunded, so money was received.`);
				if (appointment.paymentStatus !== 'paid' || appointment.price !== lineNet(row)) {
					throw new ConvexError(`${row.name} changed since it was paid here (refunded, repriced or paid again), so its payment can't be reversed automatically.`);
				}
				appointments.push({ appointment, line: row });
			}
		}
		// Rows linked after payment applied this order's money too; each is reversed exactly, or nothing is.
		const linked: Array<{ link: Doc<'orderLineLinks'>; reverse: Awaited<ReturnType<typeof linkReversal>> }> = [];
		for (const link of await orderLineLinks(ctx, order._id, 'active')) {
			const line = await ctx.db.get(link.lineId);
			linked.push({ link, reverse: await linkReversal(ctx, link, line?.name ?? 'A linked row') });
		}

		const now = Date.now();
		await syncOrderCouponRedemption(ctx, order._id, 'released');
		const sequence = (order.correctionRevision ?? 0) + 1;
		await ctx.db.patch(order._id, {
			status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, voidUnreceived: true, correctionRevision: sequence, updatedAt: now
		});
		await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email);
		await ctx.db.insert('orderCorrections', { orderId: order._id, sequence, kind: 'void_unreceived', reason, actor: admin.email, recordedAt: now, idempotencyKey: key });
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'void', note: `Recorded in error, no money received: ${reason}` });
		for (const { booking, payment } of stays) {
			await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: now, cancelledBy: admin.email, cancelReason: reason });
			const money = stayMoney(booking);
			const gross = roundMoney(money.gross - payment.amount);
			await writeBooking(ctx, booking, await stayPaymentReversalPatch(ctx, booking, gross),
				{ actor: admin.email, kind: 'payment_cancelled', reason, details: { paymentId: payment._id, orderId: order._id, amount: payment.amount } });
		}
		for (const { appointment, line } of appointments) {
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'unpaid', price: line.unitPrice, amountPaid: 0, amountRefunded: 0, paidAt: undefined, paidBy: undefined }, {
				actor: admin.email, kind: 'payment', reason: `${orderTitle(order.orderNumber)} voided as recorded in error: ${reason}`
			});
		}
		for (const { link, reverse } of linked) {
			await reverse(admin.email, `${orderTitle(order.orderNumber)} voided as recorded in error: ${reason}`);
			await ctx.db.patch(link._id, { status: 'unlinked', unlinkedAt: now, unlinkedBy: admin.email, unlinkReason: `Order voided as recorded in error: ${reason}`, unlinkSequence: sequence });
		}
		return { replayed: false };
}
