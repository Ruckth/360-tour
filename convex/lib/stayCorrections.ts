import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { queueCancellationEmail } from '../bookings';
import { releaseBookingDates } from './availabilityWrites';
import { lineNet, orderTitle, round2 } from './billMath';
import {
	assertMoney,
	attemptKey,
	bookingRevision,
	cleanReason,
	effectiveTime,
	resolveNotify,
	stayMoney,
	unitemisedStayMoney,
	writeBooking
} from './bookingMoney';
import { isSettledOrder } from './orderLinks';
import { orderLineLinks } from './lineLinks';

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
	billId?: Id<'bills'>;
	unitemised?: boolean;
	/** Internal operation context for atomic cancellation-and-refund retries. */
	replayContext?: string;
};

/** At most this many rows of one booking's payments or refunds are read; far above any real stay. */
export const MAX_STAY_ROWS = 100;
const MAX_ORDER_LINES = 100;

export const NOTHING_TO_REFUND = 'Nothing is left to refund on this booking.';
export const LEGACY_REFUNDED = 'This booking was marked refunded before refund amounts were recorded, so nothing more can be refunded.';

/** A retried refund (same key) returns the first result; a key reused for something else is refused. */
function refundFingerprint(bookingId: Id<'bookings'>, input: RefundInput, actor: string) {
	return JSON.stringify([bookingId, input.amount, input.currency, input.method, input.reason.trim(), input.effectiveAt ?? null, input.paymentId ?? null, input.billId ?? null, input.unitemised ?? false, actor, input.replayContext ?? null]);
}

export async function refundReplay(ctx: ReadCtx, bookingId: Id<'bookings'>, input: RefundInput, actor: string) {
	const key = attemptKey(input.idempotencyKey);
	const existing = await ctx.db.query('bookingRefunds').withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key)).first();
	if (!existing) return null;
	const matches = existing.requestFingerprint
		? existing.requestFingerprint === refundFingerprint(bookingId, input, actor)
		: existing.bookingId === bookingId && existing.amount === input.amount && existing.currency === input.currency && existing.method === input.method && existing.reason === input.reason.trim() && existing.recordedBy === actor && (input.effectiveAt === undefined || existing.effectiveAt === input.effectiveAt) && existing.paymentId === input.paymentId && existing.billId === input.billId && !input.unitemised;
	if (!matches) {
		throw new Error('This refund attempt was already used for a different refund. Start the refund again.');
	}
	return existing;
}

/** The stay row an order charged, and what that order collected for it (its price less the deposit already paid). */
export async function orderStayCharge(ctx: ReadCtx, billId: Id<'bills'>, bookingId: Id<'bookings'>) {
	const rows = await ctx.db.query('billLines').withIndex('by_billId_and_kind', (q) => q.eq('billId', billId).eq('kind', 'booking')).take(MAX_ORDER_LINES);
	const line = rows.find((row) => row.bookingId === bookingId);
	if (line) return { line, charged: round2(lineNet(line) - (line.deposit ?? 0)) };
	// A room row paid on the order and applied to the stay later (pos.linkPaidLine).
	const link = (await orderLineLinks(ctx, billId, 'active')).find((row) => row.bookingId === bookingId);
	const linked = link ? await ctx.db.get(link.lineId) : null;
	return link && linked ? { line: linked, charged: link.amount } : null;
}

async function refundsForOrder(ctx: ReadCtx, billId: Id<'bills'>, bookingId: Id<'bookings'>) {
	const rows = await ctx.db.query('bookingRefunds').withIndex('by_billId', (q) => q.eq('billId', billId)).take(MAX_STAY_ROWS);
	return round2(rows.filter((row) => row.bookingId === bookingId).reduce((sum, row) => sum + row.amount, 0));
}

/** The itemised payment an order settled for this stay, if the order was paid after payments were itemised. */
export async function orderStayPayment(ctx: ReadCtx, billId: Id<'bills'>, bookingId: Id<'bookings'>) {
	const rows = await ctx.db.query('bookingPayments').withIndex('by_billId', (q) => q.eq('billId', billId)).take(MAX_STAY_ROWS);
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
	if (money.legacyRefund) throw new Error(LEGACY_REFUNDED);
	if (money.refundable <= 0) {
		throw new Error(money.refundContext === 'credit' && money.net > 0
			? 'The guest has paid no more than the stay costs. To refund money on a live stay, correct its price or cancel it first.'
			: NOTHING_TO_REFUND);
	}
	if (input.amount > money.net) throw new Error(`At most ${money.net} actual money remains to refund.`);
	if (input.amount > money.refundable) {
		throw new Error(money.refundContext === 'credit'
			? `Only the credit of ${money.refundable} can be refunded while the stay is live. Correct the price or cancel the booking to refund more.`
			: `At most ${money.refundable} is left to refund.`);
	}

	let paymentId: Id<'bookingPayments'> | undefined;
	let billId: Id<'bills'> | undefined;
	if (input.unitemised && (input.paymentId || input.billId)) throw new Error('Choose one refund source.');
	if (!input.paymentId && !input.billId) {
		const financials = await stayFinancials(ctx, booking);
		if (!financials.complete) throw new Error('Review the complete payment history before recording this refund.');
		const payments = financials.payments.filter(p => p.status === 'recorded' && p.refundable > 0);
		const orders = financials.legacyOrders.filter(o => o.refundable > 0);
		const unknown = financials.unitemisedRefundable;
		if (input.unitemised) {
			if (input.amount > unknown) throw new Error(`At most ${unknown} of older unitemised money remains. Select the payment or receipt for the rest.`);
		} else if (payments.length + orders.length === 1 && unknown === 0) {
			input = payments.length ? { ...input, paymentId: payments[0]._id } : { ...input, billId: orders[0]._id };
		} else if (payments.length || orders.length) {
			throw new Error('Select the payment or receipt this refund returns. Record separate refunds for separate payments.');
		}
	}
	if (input.paymentId) {
		const payment = await ctx.db.get(input.paymentId);
		if (!payment || payment.bookingId !== booking._id) throw new Error('That payment belongs to another booking.');
		if (payment.status !== 'recorded') throw new Error('That payment entry was cancelled as recorded in error, so it has nothing to refund.');
		const left = round2(payment.amount - payment.refunded);
		if (input.amount > left) throw new Error(`At most ${left} of that payment is left to refund.`);
		await ctx.db.patch(payment._id, { refunded: round2(payment.refunded + input.amount) });
		paymentId = payment._id;
		billId = payment.billId;
		if (input.billId && input.billId !== billId) throw new Error('The selected payment belongs to a different receipt.');
	} else if (input.billId) {
		const order = await ctx.db.get(input.billId);
		if (!order || !isSettledOrder(order)) throw new Error('Refer only to a paid order that charged this stay.');
		if (order.voidUnreceived) throw new Error('That order was voided as recorded in error; no money was taken on it.');
		const charge = await orderStayCharge(ctx, order._id, booking._id);
		if (!charge) throw new Error('That order did not charge this stay.');
		const itemised = await orderStayPayment(ctx, order._id, booking._id);
		if (itemised) {
			if (itemised.status !== 'recorded' || input.amount > round2(itemised.amount - itemised.refunded)) throw new Error('This payment has insufficient refundable money.');
			await ctx.db.patch(itemised._id, { refunded: round2(itemised.refunded + input.amount) });
			paymentId = itemised._id;
		}
		// Paid before payments were itemised: the order's own row says what it collected for the stay.
		const left = round2(charge.charged - (await refundsForOrder(ctx, order._id, booking._id)));
		if (input.amount > left) throw new Error(`At most ${Math.max(left, 0)} of what ${orderTitle(order.orderNumber)} took for this stay is left to refund.`);
		billId = order._id;
	}

	const now = Date.now();
	const effectiveAt = effectiveTime(input.effectiveAt, now);
	const netAfter = round2(money.net - input.amount);
	const refundId = await ctx.db.insert('bookingRefunds', {
		bookingId: booking._id, amount: input.amount, currency: booking.currency, method: input.method, reason,
		context: money.refundContext, ...(paymentId ? { paymentId } : {}), ...(billId ? { billId } : {}),
		effectiveAt, recordedAt: now, recordedBy: actor, idempotencyKey: key, requestFingerprint, netBefore: money.net, netAfter
	});
	const fullyRefunded = netAfter === 0 && booking.status === 'cancelled';
	const updated = await writeBooking(ctx, booking, {
		amountRefunded: round2(money.refunded + input.amount),
		...(fullyRefunded ? { paymentStatus: 'refunded' as const, refundedAt: effectiveAt } : {})
	}, {
		actor, kind: 'refund_recorded', reason, effectiveAt,
		details: { refundId, amount: input.amount, method: input.method, context: money.refundContext, ...(paymentId ? { paymentId } : {}), ...(billId ? { billId } : {}) }
	});
	return { booking: updated, refundId };
}

export type CancelInput = {
	actor: string;
	reason?: string;
	effectiveAt?: number;
	notifyGuest?: boolean;
	refund?: RefundInput;
	/** Legacy `updateBooking({ action: 'cancel', refundRecorded: true })`: staff said everything was refunded but entered no amount or method. */
	legacyFullRefund?: boolean;
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
	if (input.legacyFullRefund && money.net > 0 && !money.legacyRefund) {
		const financials = await stayFinancials(ctx, booking);
		const sources = financials.payments.filter(p => p.refundable > 0).length + financials.legacyOrders.filter(o => o.refundable > 0).length + Number(financials.unitemisedRefundable > 0);
		if (!financials.complete || sources > 1) throw new Error('This older cancellation request cannot identify refund sources. Cancel keeping the payment, then record each refund from its payment or receipt.');
	}
	let updated = await writeBooking(ctx, booking, {
		status: 'cancelled', cancelledAt: effectiveAt, cancelledBy: input.actor, cancelReason: reason
	}, { actor: input.actor, kind: 'cancelled', reason, effectiveAt, details: { keptPaid: money.net, notifiedGuest: notify } });
	if (notify) await queueCancellationEmail(ctx, booking);
	await releaseBookingDates(ctx, booking);
	if (input.refund) {
		updated = (await recordStayRefund(ctx, updated, input.refund, input.actor)).booking;
	} else if (input.legacyFullRefund && money.net > 0 && !money.legacyRefund) {
		updated = (await recordStayRefund(ctx, updated, {
			amount: money.net, currency: booking.currency, method: 'unrecorded',
			reason: 'Recorded with the cancellation; amount and method were not entered',
			idempotencyKey: `legacy-cancel:${booking._id}:${bookingRevision(booking)}`
		}, input.actor)).booking;
	}
	return updated;
}

/**
 * Why a manual payment recorded before payments were itemised can't be cancelled as a mistake, or
 * null with its amount. It must provably be the legacy "Mark paid" alone: method `admin`, no online
 * payment, no order ever charged the stay, no itemised payment and no refund.
 */
export async function legacyManualPayment(ctx: ReadCtx, booking: Booking): Promise<{ amount: number } | { blocked: string }> {
	const money = stayMoney(booking);
	if (booking.paymentStatus !== 'paid' || money.gross <= 0) return { blocked: 'This stay has no recorded payment.' };
	if (booking.paymentMethod !== 'admin') return { blocked: 'This payment was not entered by hand on the booking, so it cannot be cancelled here.' };
	if (booking.stripePaymentIntentId) return { blocked: 'This stay has an online payment, which is the provider’s record.' };
	if (money.refunded > 0) return { blocked: 'Refunds are recorded on this stay. They would have nothing to refund.' };
	const [itemised, charged] = await Promise.all([
		ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).first(),
		ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', booking._id)).first()
	]);
	if (itemised) return { blocked: 'Correct the itemised payment entries instead.' };
	if (charged) return { blocked: 'An order has charged this stay, so the app cannot prove what this payment covered. Record a refund if money was returned.' };
	return { amount: money.gross };
}

/** Why a recorded payment can't be cancelled as a mistake, or null. */
export function paymentCancelBlocker(booking: Booking, payment: Doc<'bookingPayments'>): string | null {
	if (payment.status !== 'recorded') return 'Already cancelled.';
	if (payment.origin === 'online') return 'Online payments are the provider’s record and are never undone here. Record a refund if money was returned.';
	if (payment.origin === 'pos') return 'This was paid on an order. If no money was received, void that order as recorded in error from its receipt.';
	if (payment.refunded > 0) return 'Part of this payment was refunded, so it was real money.';
	const money = stayMoney(booking);
	if (round2(money.gross - payment.amount) < money.refunded) return 'Refunds on this stay would exceed what is left paid.';
	return null;
}

export function paymentAmendBlocker(payment: Doc<'bookingPayments'>): string | null {
	if (payment.status !== 'recorded') return 'This entry was cancelled.';
	if (payment.origin === 'online') return 'Online payments are the provider’s record and can’t be changed here.';
	if (payment.origin === 'pos') return 'This was paid on an order. Correct the tender or date on the order’s receipt.';
	return null;
}

/** The booking's money with each payment, refund and legacy amount, for the booking sheet and later receipt/refund screens. */
export async function stayFinancials(ctx: ReadCtx, booking: Booking) {
	const money = stayMoney(booking);
	const [payments, refunds, chargedLines] = await Promise.all([
		ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS),
		ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS),
		ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS)
	]);
	const orders = new Map<Id<'bills'>, Doc<'bills'> | null>();
	const orderOf = async (id: Id<'bills'>) => {
		if (!orders.has(id)) orders.set(id, await ctx.db.get(id));
		return orders.get(id) ?? null;
	};
	const orderRef = async (id: Id<'bills'> | undefined) => {
		if (!id) return null;
		const order = await orderOf(id);
		return order ? { _id: order._id, title: orderTitle(order.orderNumber), receiptNumber: order.receiptNumber, state: order.status, corrected: (order.correctionRevision ?? 0) > 0 } : null;
	};
	const paymentRows = [];
	for (const payment of payments) {
		paymentRows.push({
			_id: payment._id, origin: payment.origin, amount: payment.amount, currency: payment.currency, method: payment.method,
			effectiveAt: payment.effectiveAt, recordedAt: payment.recordedAt, recordedBy: payment.recordedBy, note: payment.note,
			refunded: payment.refunded, refundable: payment.status === 'recorded' ? round2(payment.amount - payment.refunded) : 0,
			status: payment.status, cancelReason: payment.cancelReason, cancelledAt: payment.cancelledAt, cancelledBy: payment.cancelledBy,
			amendedAt: payment.amendedAt, amendedBy: payment.amendedBy,
			order: await orderRef(payment.billId),
			amendBlocker: paymentAmendBlocker(payment),
			cancelBlocker: paymentCancelBlocker(booking, payment)
		});
	}
	const refundRows = [];
	for (const refund of refunds) {
		refundRows.push({
			_id: refund._id, amount: refund.amount, currency: refund.currency, method: refund.method, reason: refund.reason, context: refund.context,
			effectiveAt: refund.effectiveAt, recordedAt: refund.recordedAt, recordedBy: refund.recordedBy,
			paymentId: refund.paymentId, order: await orderRef(refund.billId),
			providerChargeId: refund.providerChargeId, providerRefundId: refund.providerRefundId, providerEventId: refund.providerEventId
		});
	}
	// Orders that took money for the stay before payments were itemised: refundable by reference.
	const legacyOrders: Array<{ _id: Id<'bills'>; title: string; receiptNumber: number | undefined; state: Doc<'bills'>['status']; charged: number; refundable: number }> = [];
	for (const line of chargedLines) {
		const order = await orderOf(line.billId);
		if (!order || !isSettledOrder(order) || order.voidUnreceived || payments.some((p) => p.billId === order._id)) continue;
		if (legacyOrders.some((row) => row._id === order._id)) continue;
		const charged = round2(lineNet(line) - (line.deposit ?? 0));
		const refunded = round2(refunds.filter((r) => r.billId === order._id).reduce((sum, r) => sum + r.amount, 0));
		legacyOrders.push({ _id: order._id, title: orderTitle(order.orderNumber), receiptNumber: order.receiptNumber, state: order.status, charged, refundable: Math.max(round2(charged - refunded), 0) });
	}
	const legacy = await legacyManualPayment(ctx, booking);
	return {
		revision: bookingRevision(booking),
		money,
		payments: paymentRows,
		refunds: refundRows,
		legacyOrders,
		/** Paid before payments were itemised (or by a path that recorded no row); shown, never invented as entries. */
		unitemised: unitemisedStayMoney(money.gross, payments),
		unitemisedRefundable: Math.max(round2(money.net - paymentRows.reduce((sum, p) => sum + p.refundable, 0) - legacyOrders.reduce((sum, o) => sum + o.refundable, 0)), 0),
		legacyManual: 'amount' in legacy ? { cancellable: true as const, amount: legacy.amount } : { cancellable: false as const, reason: legacy.blocked },
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
  const net = round2(remainingGross - money.refunded);
  const fullyRefunded = net === 0 && booking.status === 'cancelled' && remainingGross > 0;
  let refundedAt = booking.refundedAt;
  if (fullyRefunded && refundedAt === undefined) {
    const refunds = await ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', booking._id)).take(MAX_STAY_ROWS + 1);
    if (refunds.length > MAX_STAY_ROWS) throw new ConvexError('Full refund history needs review before reversing this payment');
    if (!refunds.length) throw new ConvexError('Actual refund date is unknown; review this legacy payment before reversing it');
    refundedAt = Math.max(...refunds.map(r => r.effectiveAt));
  }
  return {
    amountPaid: remainingGross > 0 ? remainingGross : undefined,
    paymentStatus: net > 0 ? 'paid' as const : fullyRefunded ? 'refunded' as const : 'pending' as const,
    paidAt: net > 0 ? booking.paidAt : undefined,
    ...(fullyRefunded ? { refundedAt } : {})
  };
}
