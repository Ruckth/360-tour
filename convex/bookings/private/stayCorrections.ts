import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { attemptKey, bookingRevision, cleanReason, effectiveTime, resolveNotify } from '../../lib/bookingMoney';
import { activeSourceLink, orderLineLinks } from '../../pos/model';
import { isSettledOrder } from '../../pos/model';
import { lineNet, orderTitle, roundMoney } from '../../shared/orderMath';
import { assertMoney, stayMoney } from '../../lib/stayMoney';
import { releaseBookingDates } from './availabilityWrites';
import { writeBooking } from './money';
import { queueCancellationEmail } from './stays';

/**
 * Refunds, cancellations and mistaken-entry corrections on a stay (see lib/bookingMoney.ts for the
 * shared rules). Recording a refund moves no money: staff return it themselves (in Stripe for
 * online payments) and record what they did. A refund never reopens a balance on a live stay.
 */

type ReadCtx = QueryCtx | MutationCtx;

type Booking = Doc<'bookings'>;

export type RefundInput = {
	amount: number;
	currency: string;
	method: Doc<'bookingRefunds'>['method'];
	reason: string;
	idempotencyKey: string;
	effectiveAt?: number;
	paymentId?: Id<'bookingPayments'>;
	orderId?: Id<'orders'>;
	/** Internal operation context for atomic cancellation-and-refund retries. */
	replayContext?: string;
};

/** At most this many rows of one booking's payments or refunds are read; far above any real stay. */
export const MAX_STAY_ROWS = 100;

const MAX_ORDER_LINES = 100;

export const NOTHING_TO_REFUND = 'Nothing is left to refund on this booking.';

/** A retried refund (same key) returns the first result; a key reused for something else is refused. */
function refundFingerprint(bookingId: Id<'bookings'>, input: RefundInput, actor: string) {
	return JSON.stringify([bookingId, input.amount, input.currency, input.method, input.reason.trim(), input.effectiveAt ?? null, input.paymentId ?? null, input.orderId ?? null, actor, input.replayContext ?? null]);
}

export async function refundReplay(ctx: ReadCtx, bookingId: Id<'bookings'>, input: RefundInput, actor: string) {
	const key = attemptKey(input.idempotencyKey);
	const existing = await ctx.db.query('bookingRefunds').withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key)).first();
	if (!existing) return null;
	const matches = existing.requestFingerprint === refundFingerprint(bookingId, input, actor);
	if (!matches) {
		throw new Error('This refund attempt was already used for a different refund. Start the refund again.');
	}
	return existing;
}

/** The stay row an order charged, and what that order collected for it (its price less the deposit already paid). */
export async function orderStayCharge(ctx: ReadCtx, orderId: Id<'orders'>, bookingId: Id<'bookings'>) {
	const rows = await ctx.db.query('orderLines').withIndex('by_orderId_and_kind', (q) => q.eq('orderId', orderId).eq('kind', 'booking')).take(MAX_ORDER_LINES);
	const line = rows.find((row) => row.bookingId === bookingId);
	if (line) return { line, charged: roundMoney(lineNet(line) - (line.deposit ?? 0)) };
	// A room row paid on the order and applied to the stay later (pos.linkPaidLine).
	const link = (await orderLineLinks(ctx, orderId, 'active')).find((row) => row.bookingId === bookingId);
	const linked = link ? await ctx.db.get(link.lineId) : null;
	return link && linked ? { line: linked, charged: link.amount } : null;
}

async function refundsForOrder(ctx: ReadCtx, orderId: Id<'orders'>, bookingId: Id<'bookings'>) {
	const rows = await ctx.db.query('bookingRefunds').withIndex('by_orderId', (q) => q.eq('orderId', orderId)).take(MAX_STAY_ROWS);
	return roundMoney(rows.filter((row) => row.bookingId === bookingId).reduce((sum, row) => sum + row.amount, 0));
}

/** The itemised payment an order settled for this stay, if the order was paid after payments were itemised. */
export async function orderStayPayment(ctx: ReadCtx, orderId: Id<'orders'>, bookingId: Id<'bookings'>) {
	// Use the link's exact payment, even after older link/unlink cycles fill the history page.
	const link = await activeSourceLink(ctx, { bookingId });
	if (link?.orderId === orderId && link.bookingPaymentId) return ctx.db.get(link.bookingPaymentId);
	const rows = await ctx.db.query('bookingPayments').withIndex('by_orderId', (q) => q.eq('orderId', orderId)).take(MAX_STAY_ROWS);
	// A row linked, unlinked and linked again leaves a cancelled payment beside the live one.
	return rows.find((row) => row.bookingId === bookingId && row.status === 'recorded') ?? rows.find((row) => row.bookingId === bookingId) ?? null;
}

/**
 * Records a refund of money kept on the stay. Validates the amount (whole satang, at most what is
 * refundable now), currency and any payment or order it refers to, then adds it to the booking's
 * refunded total. A cancelled stay refunded in full becomes `refunded`. The caller has checked the
 * revision and replay.
 */
export async function recordStayRefund(ctx: MutationCtx, booking: Booking, input: RefundInput, actor: string) {
	const key = attemptKey(input.idempotencyKey);
	const requestFingerprint = refundFingerprint(booking._id, input, actor);
	if (input.method === 'stripe' && await ctx.db.query('stripeRefundCharges').withIndex('by_bookingId', q => q.eq('bookingId', booking._id)).first()) {
		throw new Error('Stripe refunds on this booking are reconciled automatically. Replay the provider event instead of recording the same returned money by hand.');
	}
	if (input.currency !== booking.currency) throw new Error(`This booking is in ${booking.currency}; refund it in ${booking.currency}.`);
	assertMoney(input.amount, 'Refund');
	const reason = cleanReason(input.reason, 'Refund reason')!;
	const money = stayMoney(booking);
	if (money.refundable <= 0) {
		throw new Error(money.refundContext === 'credit' && money.net > 0
			? 'The guest has paid no more than the stay costs. To refund money on a live stay, correct its price or cancel it first.'
			: NOTHING_TO_REFUND);
	}
	if (input.amount > money.net) throw new Error(`At most ${money.net / 100} actual money remains to refund.`);
	if (input.amount > money.refundable) {
		throw new Error(money.refundContext === 'credit'
			? `Only the credit of ${money.refundable / 100} can be refunded while the stay is live. Correct the price or cancel the booking to refund more.`
			: `At most ${money.refundable / 100} is left to refund.`);
	}

	let paymentId: Id<'bookingPayments'> | undefined;
	let orderId: Id<'orders'> | undefined;
 if (!input.paymentId && !input.orderId) {
  const financials = await stayFinancials(ctx, booking);
  if (!financials.complete) throw new Error('Review the complete payment history before recording this refund.');
  const refundable = financials.payments.filter(p => p.refundable > 0);
  if (refundable.length !== 1) throw new Error('Select the payment this refund returns.');
  input = { ...input, paymentId: refundable[0]._id };
 }
	if (input.paymentId) {
		const payment = await ctx.db.get(input.paymentId);
		if (!payment || payment.bookingId !== booking._id) throw new Error('That payment belongs to another booking.');
		if (payment.status !== 'recorded') throw new Error('That payment entry was cancelled as recorded in error, so it has nothing to refund.');
		const left = roundMoney(payment.amount - payment.refunded);
		if (input.amount > left) throw new Error(`At most ${left} of that payment is left to refund.`);
		await ctx.db.patch(payment._id, { refunded: roundMoney(payment.refunded + input.amount) });
		paymentId = payment._id;
		orderId = payment.orderId;
		if (input.orderId && input.orderId !== orderId) throw new Error('The selected payment belongs to a different receipt.');
	} else if (input.orderId) {
		const order = await ctx.db.get(input.orderId);
		if (!order || !isSettledOrder(order)) throw new Error('Refer only to a paid order that charged this stay.');
		if (order.voidUnreceived) throw new Error('That order was voided as recorded in error; no money was taken on it.');
		const charge = await orderStayCharge(ctx, order._id, booking._id);
		if (!charge) throw new Error('That order did not charge this stay.');
		const itemised = await orderStayPayment(ctx, order._id, booking._id);
		if (!itemised) throw new Error('Receipt has no recorded stay payment.');
		{
			if (itemised.status !== 'recorded' || input.amount > roundMoney(itemised.amount - itemised.refunded)) throw new Error('This payment has insufficient refundable money.');
			await ctx.db.patch(itemised._id, { refunded: roundMoney(itemised.refunded + input.amount) });
			paymentId = itemised._id;
		}
		// Paid before payments were itemised: the order's own row says what it collected for the stay.
		const left = roundMoney(charge.charged - (await refundsForOrder(ctx, order._id, booking._id)));
		if (input.amount > left) throw new Error(`At most ${Math.max(left, 0)} of what ${orderTitle(order.orderNumber)} took for this stay is left to refund.`);
		orderId = order._id;
	}

	const now = Date.now();
	const effectiveAt = effectiveTime(input.effectiveAt, now);
	const netAfter = roundMoney(money.net - input.amount);
	const refundId = await ctx.db.insert('bookingRefunds', {
		bookingId: booking._id, amount: input.amount, currency: booking.currency, method: input.method, reason,
		context: money.refundContext, ...(paymentId ? { paymentId } : {}), ...(orderId ? { orderId } : {}),
		effectiveAt, recordedAt: now, recordedBy: actor, idempotencyKey: key, requestFingerprint, netBefore: money.net, netAfter
	});
	const fullyRefunded = netAfter === 0 && booking.status === 'cancelled';
	const updated = await writeBooking(ctx, booking, {
		amountRefunded: roundMoney(money.refunded + input.amount),
		...(fullyRefunded ? { paymentStatus: 'refunded' as const, refundedAt: effectiveAt } : {})
	}, {
		actor, kind: 'refund_recorded', reason, effectiveAt,
		details: { refundId, amount: input.amount, method: input.method, context: money.refundContext, ...(paymentId ? { paymentId } : {}), ...(orderId ? { orderId } : {}) }
	});
	return { booking: updated, refundId };
}

export type CancelInput = {
	actor: string;
	reason?: string;
	effectiveAt?: number;
	notifyGuest?: boolean;
	refund?: RefundInput;
};

/**
 * Cancels the stay and releases its nights. Money already paid is kept unless a refund is given
 * (any part of it, in the same transaction). The guest is emailed only when notify resolves true.
 */
export async function cancelStayRecord(ctx: MutationCtx, booking: Booking, input: CancelInput) {
	if (booking.status === 'cancelled') {
		if (input.refund) throw new Error('This booking is already cancelled. Record the refund on its own.');
		return booking;
	}
	if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) {
		throw new Error('The Stripe checkout is active. Wait for it to expire before cancelling.');
	}
	const reason = cleanReason(input.reason, 'Reason', false);
	const effectiveAt = effectiveTime(input.effectiveAt);
	const money = stayMoney(booking);
	const notify = resolveNotify(input.notifyGuest, booking);
	let updated = await writeBooking(ctx, booking, {
		status: 'cancelled', cancelledAt: effectiveAt, cancelledBy: input.actor, cancelReason: reason
	}, { actor: input.actor, kind: 'cancelled', reason, effectiveAt, details: { keptPaid: money.net, notifiedGuest: notify } });
	if (notify) await queueCancellationEmail(ctx, booking);
	await releaseBookingDates(ctx, booking);
	if (input.refund) {
		updated = (await recordStayRefund(ctx, updated, input.refund, input.actor)).booking;
	}

	return updated;
}

/** Why a recorded payment can't be cancelled as a mistake, or null. */
export function paymentCancelBlocker(booking: Booking, payment: Doc<'bookingPayments'>): string | null {
	if (payment.status !== 'recorded') return 'Already cancelled.';
	if (payment.origin === 'online') return 'Online payments are the provider’s record and are never undone here. Record a refund if money was returned.';
	if (payment.origin === 'pos') return 'This was paid on an order. If no money was received, void that order as recorded in error from its receipt.';
	if (payment.refunded > 0) return 'Part of this payment was refunded, so it was real money.';
	const money = stayMoney(booking);
	if (roundMoney(money.gross - payment.amount) < money.refunded) return 'Refunds on this stay would exceed what is left paid.';
	return null;
}

export function paymentAmendBlocker(payment: Doc<'bookingPayments'>): string | null {
	if (payment.status !== 'recorded') return 'This entry was cancelled.';
	if (payment.origin === 'online') return 'Online payments are the provider’s record and can’t be changed here.';
	if (payment.origin === 'pos') return 'This was paid on an order. Correct the tender or date on the order’s receipt.';
	return null;
}

export async function stayFinancials(ctx: ReadCtx, booking: Booking) {
	const money = stayMoney(booking);
	const [payments, refunds, chargedLines] = await Promise.all([
		ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS),
		ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS),
		ctx.db.query('orderLines').withIndex('by_bookingId', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS)
	]);
	const orders = new Map<Id<'orders'>, Doc<'orders'> | null>();
	const orderOf = async (id: Id<'orders'>) => {
		if (!orders.has(id)) orders.set(id, await ctx.db.get(id));
		return orders.get(id) ?? null;
	};
	const orderRef = async (id: Id<'orders'> | undefined) => {
		if (!id) return null;
		const order = await orderOf(id);
		return order ? { _id: order._id, title: orderTitle(order.orderNumber), receiptNumber: order.receiptNumber, state: order.status, corrected: (order.correctionRevision ?? 0) > 0 } : null;
	};
	const paymentRows = [];
	for (const payment of payments) {
		paymentRows.push({
			_id: payment._id, origin: payment.origin, amount: payment.amount, currency: payment.currency, method: payment.method,
			effectiveAt: payment.effectiveAt, recordedAt: payment.recordedAt, recordedBy: payment.recordedBy, note: payment.note,
			refunded: payment.refunded, refundable: payment.status === 'recorded' ? roundMoney(payment.amount - payment.refunded) : 0,
			status: payment.status, cancelReason: payment.cancelReason, cancelledAt: payment.cancelledAt, cancelledBy: payment.cancelledBy,
			amendedAt: payment.amendedAt, amendedBy: payment.amendedBy,
			order: await orderRef(payment.orderId),
			amendBlocker: paymentAmendBlocker(payment),
			cancelBlocker: paymentCancelBlocker(booking, payment)
		});
	}
	const refundRows = [];
	for (const refund of refunds) {
		refundRows.push({
			_id: refund._id, amount: refund.amount, currency: refund.currency, method: refund.method, reason: refund.reason, context: refund.context,
			effectiveAt: refund.effectiveAt, recordedAt: refund.recordedAt, recordedBy: refund.recordedBy,
			paymentId: refund.paymentId, order: await orderRef(refund.orderId),
			providerChargeId: refund.providerChargeId, providerRefundId: refund.providerRefundId, providerEventId: refund.providerEventId
		});
	}
	return {
		revision: bookingRevision(booking),
		money,
		payments: paymentRows,
		refunds: refundRows,
		/** Paid before payments were itemised (or by a path that recorded no row); shown, never invented as entries. */
		hasStripePayment: Boolean(booking.stripePaymentIntentId),
		complete: payments.length < MAX_STAY_ROWS && refunds.length < MAX_STAY_ROWS && chargedLines.length < MAX_STAY_ROWS
	};
}

/**
 * Shared by the parent-owned booking/POS mistaken-payment callers. A reversal moves no money;
 * if it leaves only fully refunded real payments, retain the actual latest refund business date.
 * Status/occupancy is deliberately absent: reversing a tender does not cancel a confirmed stay.
 */
export async function stayPaymentReversalPatch(ctx: ReadCtx, booking: Booking, remainingGross: number) {
  const money = stayMoney(booking);
  if (!Number.isFinite(remainingGross) || remainingGross < money.refunded) throw new ConvexError('Refunds exceed remaining paid money');
  const net = roundMoney(remainingGross - money.refunded);
  const fullyRefunded = net === 0 && booking.status === 'cancelled' && remainingGross > 0;
  let refundedAt = booking.refundedAt;
  if (fullyRefunded && refundedAt === undefined) {
    const refunds = await ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', booking._id)).take(MAX_STAY_ROWS + 1);
    if (refunds.length > MAX_STAY_ROWS) throw new ConvexError('Full refund history needs review before reversing this payment');
    if (!refunds.length) throw new ConvexError('Actual refund date is unknown; review this payment before reversing it');
    refundedAt = Math.max(...refunds.map(r => r.effectiveAt));
  }
  return {
    amountPaid: remainingGross,
    paymentStatus: net > 0 ? 'paid' as const : fullyRefunded ? 'refunded' as const : 'pending' as const,
    paidAt: net > 0 ? booking.paidAt : undefined,
    ...(fullyRefunded ? { refundedAt } : {})
  };
}
