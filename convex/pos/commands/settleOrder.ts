import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { markBookingPaid } from '../../bookings/model';
import { captureAffiliateSnapshot, syncAffiliateCredit } from '../../marketing/model';
import { recordAppointmentChange } from '../../services/model';
import { effectiveTime } from '../../lib/bookingMoney';
import { consumeOrderCoupon } from '../../marketing/model';
import { DISCARDED_ORDER } from '../private/orderLifecycle';
import { orderLines } from '../private/orderLines';
import { RECEIPT_COUNTER, nextCounter } from '../private/orderLinks';
import { isOpenOrder } from '../private/orderLinks';
import { assertTenders, lineNet, orderTotals, roundMoney } from '../../shared/orderMath';
import { appendRecordHistory } from '../../settings/model';
import { assertNoPendingApprovals } from '../private/staffApprovalState';
import { CUSTOMER_POS_INTEGRATION_ENABLED, assertCustomerReviewed } from '../private/customerModel';
import { ATTACHED_PRICE, isSourceRow, orderCouponUnavailable, quoteOrderCoupon, sourceIssue, tenderValidator } from '../private/orderModel';

/**
 * Pays the order. `idempotencyKey` identifies one payment attempt: retrying it after a dropped
 * connection returns the first result instead of charging twice. `expectedDue` and
 * `expectedRevision` are what staff reviewed; if the order changed since (items, prices or its
 * customer), nothing is written.
 *
 * `effectiveAt` is the business date the money was received (default now; any past date, never the
 * future). It is kept on the payments, on each stay's payment record and on each appointment's
 * `paidAt`; the receipt's issue time (`paidAt` on the order) is always now. `notifyGuest` decides
 * whether a charged stay's confirmation is emailed (default: not for stays that started before
 * today). `expectedCustomerRevision` is the linked customer's profile revision staff reviewed
 * (customers.ts assertCustomerReviewed); it refuses a payment reviewed before a profile correction
 * or merge, and becomes required when customers.ts turns on CUSTOMER_POS_INTEGRATION_ENABLED.
 */
export const settleOrder = staffMutation({
  capability: 'checkout',
	args: {
		orderId: v.id('orders'), idempotencyKey: v.string(), expectedDue: v.number(), expectedRevision: v.number(), tenders: v.array(tenderValidator),
		effectiveAt: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		expectedCustomerRevision: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const key = args.idempotencyKey.trim();
		if (key.length < 8 || key.length > 100) throw new ConvexError('Invalid payment attempt');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (!isOpenOrder(order)) {
			if (order.settleKey === key && order.receiptNumber !== undefined) return { receiptNumber: order.receiptNumber, replayed: true };
			throw new ConvexError(order.status === 'void' ? 'This order was voided' : order.status === 'discarded' ? DISCARDED_ORDER : 'This order is already paid');
		}
		await assertNoPendingApprovals(ctx, order._id);
		const lines = await orderLines(ctx, order._id);
		if (!lines.length) throw new ConvexError('Add an item first');
		if (order.promotion) {
			// Always a fresh check: a stored problem may be gone (a paused coupon resumed), and the
			// stored shares then differ, so staff review the new saving before paying.
			const result = await quoteOrderCoupon(ctx, lines, order.promotion.couponId, order.promotion.couponVersion);
			if (!result.ok) orderCouponUnavailable(result.problem);
			const shares = new Map(result.allocation.map(share => [share.lineId, share.discount]));
			if (result.discount !== order.promotion.discount || lines.some(line => (line.couponDiscount ?? 0) !== (shares.get(line._id) ?? 0))) {
				throw new ConvexError({ code: 'coupon_changed', message: `The coupon now saves ฿${(result.discount / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}. Check the coupon again before taking payment.`, discount: result.discount });
			}
		}
		const totals = orderTotals(lines);
		if (totals.due !== roundMoney(args.expectedDue) || order.revision !== args.expectedRevision) throw new ConvexError('The order changed. Check the total and pay again.');
		assertTenders(args.tenders, totals.due);
		const customer = order.customerId ? await ctx.db.get(order.customerId) : null;
		if (order.customerId) {
			// Missing or merged customers always refuse. The reviewed customer revision is required once
			// customers.ts enables POS integration; until then a caller that omits it is protected by the
			// order revision bump customers.ts makes on every identity edit.
			assertCustomerReviewed(customer, args.expectedCustomerRevision ?? (CUSTOMER_POS_INTEGRATION_ENABLED ? undefined : (customer?.revision ?? 0)));
		}

		const now = Date.now();
		const effectiveAt = effectiveTime(args.effectiveAt, now);
		if (order.promotion) await consumeOrderCoupon(ctx, order._id, order.promotion);
		for (const line of lines) {
			if (!isSourceRow(line)) continue;
			const issue = await sourceIssue(ctx, line);
			if (issue) throw new ConvexError(issue.kind === 'changed' ? `${line.name} changed since it was added. Update the row and review the total.` : `${line.name}: ${issue.message}`);
			if (line.bookingId) {
				// Charged at the booked price, so what the stay still owed is what this order collected for it.
				if (line.discount || line.priceOverride) throw new ConvexError(ATTACHED_PRICE);
				await markBookingPaid(ctx, line.bookingId, 'pos', { actor: admin.email, effectiveAt, orderId: order._id, notifyGuest: args.notifyGuest });
			}
			if (line.appointmentId) {
				const appointment = (await ctx.db.get(line.appointmentId))!;
				// The appointment keeps what was charged for it, after any discount or price change here.
				await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: lineNet(line), amountPaid: lineNet(line), amountRefunded: 0, paidAt: effectiveAt, paidBy: admin.email }, { actor: admin.email, kind: 'payment', reason: 'Paid at checkout', effectiveAt });
			}
		}
		// The receipt prints each therapist's name as it is now; a later rename doesn't rewrite it.
		for (const line of lines) {
			if (!line.staffId) continue;
			const person = await ctx.db.get(line.staffId);
			await ctx.db.patch(line._id, { staffName: person?.name ?? 'Former staff member' });
		}
		for (const tender of args.tenders) {
			await ctx.db.insert('orderPayments', { orderId: order._id, ...tender, idempotencyKey: key, createdBy: admin.email, createdAt: now, effectiveAt });
		}
		const receiptNumber = await nextCounter(ctx, RECEIPT_COUNTER);
		const linkedBooking = order.bookingId ? await ctx.db.get(order.bookingId) : null;
		const affiliateProperty = linkedBooking ? await ctx.db.get(linkedBooking.propertyId) : null;
		const affiliateSnapshot = await captureAffiliateSnapshot(ctx, {linkId: order.promotion?.viaLinkId, couponId: order.promotion?.couponId, propertySlug: affiliateProperty?.slug, guestEmail: customer?.email, staff: true});
		// The receipt names who it was issued to as they were then; later profile edits don't change it.
		const customerSnapshot = customer
			? { name: customer.name, phone: customer.phone, email: customer.email }
			: undefined;
		await ctx.db.patch(order._id, {
			status: 'paid', affiliateSnapshot, receiptNumber, settleKey: key, total: totals.total, due: 0, customerSnapshot, paidAt: now, paidBy: admin.email, updatedAt: now,
			paymentEffectiveAt: effectiveAt, ...(customer ? { customerRevisionAtPayment: customer.revision ?? 0 } : {})
		});
		await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email);
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'paid', toPrice: totals.due });
		// A fee is noted on its appointment's history; the appointment itself (status, payment) is unchanged.
		for (const line of lines) {
			if (!line.fee || !line.feeAppointmentId) continue;
			await appendRecordHistory(ctx, {
				entityType: 'appointment', entityId: line.feeAppointmentId, actor: admin.email, kind: 'fee_charged', effectiveAt,
				...(line.fee.reason ? { reason: line.fee.reason } : {}),
				after: { feeKind: line.fee.kind, amount: lineNet(line), currency: line.currency, orderId: order._id, receiptNumber }
			});
		}
		return { receiptNumber, replayed: false };
	}
});
