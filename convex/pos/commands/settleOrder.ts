import { ConvexError, v } from 'convex/values';
import { canReadCheckoutOrder, staffMutation, type StaffActor } from '../../auth/model';
import { markBookingPaid } from '../../bookings/model';
import { captureAffiliateSnapshot, syncAffiliateCredit } from '../../marketing/model';
import { recordAppointmentChange } from '../../services/model';
import { effectiveTime } from '../../shared/bookingMoney';
import { consumeOrderCoupon } from '../../marketing/model';
import { DISCARDED_ORDER } from '../private/orderLifecycle';
import { orderLines } from '../private/orderLines';
import { RECEIPT_COUNTER, nextCounter } from '../private/orderLinks';
import { isOpenOrder } from '../private/orderLinks';
import { assertTenders, lineNet, roundMoney, type Tender } from '../../shared/orderMath';
import { appendRecordHistory } from '../../settings/model';
import { isSourceRow, sourceIssue, tenderValidator } from '../private/orderModel';
import { assertNoPendingApprovals } from '../private/staffApprovalState';
import { assertCustomerReviewed, CUSTOMER_POS_INTEGRATION_ENABLED } from '../private/customerModel';
import { closeSettledDirectPanel } from '../private/directPanels';
import { assertCurrentPaymentSource, checkPaymentCart, checkPaymentTotals, isCommerceLine } from '../private/paymentReview';
import { paymentEvidence } from '../private/paymentRecovery';
import { preflightAttempt } from '../private/attemptPreflight';
import { writeCommercePayment } from '../private/paymentCommerce';
import {
  assertActiveAttempt, attemptForOwner, attemptOwnerArgs, checkoutPaymentSettings, externalTenders,
  needsPaymentCheck, paymentError, paymentRefusal,
} from '../private/paymentAttempt';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { assertDirectPaymentAdmission } from '../../commerce/model';
import { resortMidnight, resortTodayIso } from '../../shared/time';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

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
 *
 * During the payments rollout pause only a registered direct panel (`tillId` + `panelKey`) may
 * still settle. Clients without a registration can use direct settlement before the pause.
 */
export const settleOrder = staffMutation({
  capability: 'checkout',
	args: {
		orderId: v.id('orders'), idempotencyKey: v.string(), expectedDue: v.number(), expectedRevision: v.number(), tenders: v.array(tenderValidator),
		effectiveAt: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		expectedCustomerRevision: v.optional(v.number()),
		// The direct panel's registration (commerce/paymentCutover openDirectPanel); required while checkout is paused.
		tillId: v.optional(v.id('tills')),
		panelKey: v.optional(v.string()),
		// The panel's device and tab: a registration belongs to one till and tab.
		deviceKey: v.optional(v.string()),
		tabKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const key = args.idempotencyKey.trim();
		if (key.length < 8 || key.length > 100) throw new ConvexError('Invalid payment attempt');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		const inScope = canReadCheckoutOrder(admin, order);
		// The original direct cashier can recover a lost acknowledgement for a backdated sale.
		if (!isOpenOrder(order) && order.vatVersion !== 2 && order.settleKey === key && order.receiptNumber !== undefined &&
			(inScope || order.paidBy === admin.email)) {
			return { receiptNumber: order.receiptNumber, replayed: true };
		}
		if (!inScope) throw new ConvexError('Order not found');
		if (!isOpenOrder(order)) {
			throw new ConvexError(order.status === 'void' ? 'This order was voided' : order.status === 'discarded' ? DISCARDED_ORDER : 'This order is already paid');
		}
    const settings = await checkoutPaymentSettings(ctx);
    if (settings.paymentsMode === 'attempts') paymentError('attempt_required', 'Reload checkout before taking payment.');
    const panel = await assertDirectPaymentAdmission(ctx, {
      orderId: order._id, actor: admin.tokenIdentifier, tillId: args.tillId, panelKey: args.panelKey, deviceKey: args.deviceKey, tabKey: args.tabKey,
      payment: { revision: args.expectedRevision, due: roundMoney(args.expectedDue), tenders: args.tenders.map(({ method, amount }) => ({ method, amount })) },
    }, settings);
    await assertNoPendingApprovals(ctx, order._id);
    const lines = await orderLines(ctx, order._id);
    if (!lines.length) throw new ConvexError('Add an item first');
    if (lines.some(isCommerceLine)) paymentError('sale_disabled', 'Commerce rows require the new payments panel.');
    const totals = await checkPaymentTotals(ctx, order, lines, { revision: args.expectedRevision, due: roundMoney(args.expectedDue) }, false);
    assertTenders(args.tenders, totals.due);
    const customer = order.customerId ? await ctx.db.get(order.customerId) : null;
    if (order.customerId) {
      assertCustomerReviewed(customer, args.expectedCustomerRevision ?? (CUSTOMER_POS_INTEGRATION_ENABLED ? undefined : (customer?.revision ?? 0)));
    }
    const now = Date.now();
    const effectiveAt = effectiveTime(args.effectiveAt, now);
    const cart = { lines, totals, customer, appointment: (id: Doc<'appointments'>['_id']) => ctx.db.get(id) };
    const result = await writeOrderPayment(ctx, order, cart, args.tenders, admin, { key, now, effectiveAt, notifyGuest: args.notifyGuest ?? panel.notifyGuest });
    await closeSettledDirectPanel(ctx, order._id, panel.owner, panel.till, args.panelKey);
    return result;
  }
});

type SaleTender = Tender | { method: 'voucher'; voucherId: Doc<'vouchers'>['_id']; amount: number };

async function writeOrderPayment(
  ctx: MutationCtx, order: Doc<'orders'>, cart: Awaited<ReturnType<typeof checkPaymentCart>>,
  tenders: SaleTender[], admin: StaffActor, options: { key: string; now: number; effectiveAt: number; notifyGuest?: boolean; paidShares?: number[] },
) {
    const { key, now, effectiveAt, notifyGuest, paidShares } = options;
    const { lines, totals, customer } = cart;
		if (order.promotion) await consumeOrderCoupon(ctx, order._id, order.promotion);
		for (const [index, line] of lines.entries()) {
			if (!paidShares && isSourceRow(line)) assertCurrentPaymentSource(await sourceIssue(ctx, line), line);
			if (line.bookingId) {
				// Charged at the booked price, so what the stay still owed is what this order collected for it.
				await markBookingPaid(ctx, line.bookingId, 'pos', { actor: admin.email, effectiveAt, orderId: order._id, notifyGuest });
			}
			if (line.appointmentId && !line.coverage) {
				const appointment = (await cart.appointment(line.appointmentId))!;
				// The appointment keeps what was charged for it, after any discount or price change here.
				const amount = paidShares?.[index] ?? lineNet(line);
				await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: amount, amountPaid: amount, amountRefunded: 0, paidAt: effectiveAt, paidBy: admin.email }, { actor: admin.email, kind: 'payment', reason: 'Paid at checkout', effectiveAt });
			}
		}
		// The receipt prints each therapist's name as it is now; a later rename doesn't rewrite it.
		for (const line of lines) {
			if (!line.staffId) continue;
			const person = await ctx.db.get(line.staffId);
			await ctx.db.patch(line._id, { staffName: person?.name ?? 'Former staff member' });
		}
		for (const tender of tenders) {
			await ctx.db.insert('orderPayments', { orderId: order._id, ...tender, idempotencyKey: key, createdBy: admin.email, createdAt: now, effectiveAt });
		}
		const collected = paidShares?.reduce((sum, amount) => sum + amount, 0) ?? totals.due;
		const receiptNumber = await nextCounter(ctx, RECEIPT_COUNTER);
		const linkedBooking = order.bookingId ? await ctx.db.get(order.bookingId) : null;
		const affiliateProperty = linkedBooking ? await ctx.db.get(linkedBooking.propertyId) : null;
		const affiliateSnapshot = await captureAffiliateSnapshot(ctx, {linkId: order.promotion?.viaLinkId, couponId: order.promotion?.couponId, propertySlug: affiliateProperty?.slug, guestEmail: customer?.email, staff: true});
		// The receipt names who it was issued to as they were then; later profile edits don't change it.
		const customerSnapshot = customer
			? { name: customer.name, phone: customer.phone, email: customer.email }
			: undefined;
		await ctx.db.patch(order._id, {
			status: 'paid', affiliateSnapshot, receiptNumber, settleKey: key, total: collected + totals.deposit, due: 0, customerSnapshot, paidAt: now, paidBy: admin.email, updatedAt: now,
			paymentEffectiveAt: effectiveAt, ...(paidShares ? { vatVersion: 2, activeAttemptId: undefined } : {}), ...(customer ? { customerRevisionAtPayment: customer.revision ?? 0 } : {})
		});
		if (!paidShares) await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email);
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'paid', toPrice: collected });
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

/** The verified legs, customer review and date all come from the durable attempt. */
export const settlePaymentAttempt = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, stockInHand: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    let prepared;
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      const { receiptNumber } = order;
      if (attempt.status === 'settled' && receiptNumber !== undefined && order.settleKey === attempt.key) {
        return { status: 'settled' as const, receiptNumber, replayed: true };
      }
      assertActiveAttempt(order, attempt);
      if (attempt.status === 'refused' && attempt.refusal) return { status: 'refused' as const, ...attempt.refusal };
      if (attempt.legs.some(needsPaymentCheck) || attempt.resolution?.giveBackLegs.some(needsPaymentCheck)) paymentError('check_previous', 'Check the previous payment first.');
      if (attempt.legs.some(leg => leg.state === 'planned')) paymentError('payment_incomplete', 'Finish recording the payment first.');
      if (attempt.status !== 'collecting' && attempt.status !== 'recovering') paymentError('attempt_not_collecting', 'Review this payment again.');

      const settings = await checkoutPaymentSettings(ctx);
      const now = Date.now();
      const businessDate = attempt.reviewedRequest.businessDate;
      const effectiveAt = effectiveTime(businessDate === resortTodayIso(now) ? now : resortMidnight(businessDate), now);
      try {
        const tenders = attempt.parentAttemptId ? (await paymentEvidence(ctx, attempt)).kept :
          externalTenders(attempt.legs.filter(leg => leg.state === 'taken'));
        if (tenders.reduce((sum, tender) => sum + tender.amount, 0) + attempt.reviewedRequest.vouchers.reduce((sum, voucher) => sum + voucher.paid + voucher.goodwill, 0) !== attempt.reviewedRequest.due) {
          paymentError('payment_incomplete', 'Finish recording the payment first.');
        }
        const checks = await preflightAttempt(ctx, order, attempt, settings, ctx.staff, tenders, now);
        if (!tenders.length && !args.stockInHand && checks.sale.stockShortages.length) {
          return { status: 'confirm_stock' as const, shortages: checks.sale.stockShortages };
        }
        if (readBudget(ctx).documents > 4000) paymentError('pay_room_first', 'Split this order into smaller payments.');
        prepared = { ...checks, attempt, order, effectiveAt, now };
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error;
        const { status, code, message } = paymentRefusal(error);
        reserveWrites(ctx, 1);
        await ctx.db.patch(attempt._id, { status, refusal: { code, message }, updatedAt: now });
        return { status, code, message };
      }
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }

    const { attempt, order, cart, sale, effectiveAt, now } = prepared;
    const result = await writeOrderPayment(ctx, order, cart, sale.payments, ctx.staff, {
      key: attempt.key, now, effectiveAt, paidShares: sale.snapshots.map(snapshot => snapshot.paidShare),
    });
    await writeCommercePayment(ctx, sale, ctx.staff.email, now);
    await syncAffiliateCredit(ctx, { orderId: order._id }, ctx.staff.email);
    reserveWrites(ctx, 1);
    await ctx.db.patch(attempt._id, { status: 'settled', updatedAt: now });
    return { status: 'settled' as const, ...result };
  },
});
