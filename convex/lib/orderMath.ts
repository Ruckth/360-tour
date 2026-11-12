import { percentageOf, roundRatio, roundMoney } from '../shared/money';
export { roundMoney } from '../shared/money';
import { ConvexError } from 'convex/values';
/**
 * POS order math, shared by Convex and the checkout UI. Prices include 7% VAT (the receipt
 * shows the VAT portion); there is no service charge. Amounts are in the order currency.
 */

export const VAT_RATE = 700;
export const MAX_TENDERS = 3;
/** Bound receipt refund reads; never truncate a money balance. */
export const MAX_ORDER_REFUNDS = 1000;
export const NOTE_MAX = 500;
/**
 * Till limits. They keep every intermediate exact in doubles: a bill is at most 1e9 satang, and a
 * percent discount multiplies a line's satang by hundredths of a percent (at most 1e4), so 1e13.
 */
export const MAX_PRICE = 100_000_000;
export const MAX_QTY = 99;
/** Largest bill subtotal, and so the largest discount, payment or cash received. */
export const MAX_ORDER = 1_000_000_000;
const atMost = (max: number) => `Amounts are at most ${(max / 100).toLocaleString('en-US')}`;
export const TENDER_METHODS = ['cash', 'promptpay', 'card', 'transfer'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

/** Services are one row per unit; rooms and extras merge into a quantity. */
export const LINE_KINDS = ['service', 'room', 'extra', 'booking', 'appointment'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const MERGES_QTY: Record<LineKind, boolean> = { service: false, room: true, extra: true, booking: false, appointment: false };

export type LineDiscount = { type: 'amount' | 'percent'; value: number };
export type PricedLine = {
	unitPrice: number;
	qty: number;
	discount?: LineDiscount;
	priceOverride?: { price: number };
	/** Already paid elsewhere (e.g. a Stripe deposit on an attached booking). */
	deposit?: number;
	/**
	 * This row's share of the order's coupon (pos.applyOrderCoupon). The server recomputes it on every
	 * change to an unpaid order and it is frozen once paid, so receipts and refunds read it as stored.
	 */
	couponDiscount?: number;
};
export type Tender = { method: TenderMethod; amount: number; received?: number };
/** `discount` is every discount, the coupon included; `coupon` is the coupon's part of it. */
export type OrderTotals = { subtotal: number; discount: number; coupon: number; total: number; vat: number; deposit: number; due: number };

const sum = (values: number[]) => roundMoney(values.reduce((a, b) => a + b, 0));

export function linePrice(line: PricedLine) {
	return line.priceOverride?.price ?? line.unitPrice;
}

export function lineGross(line: PricedLine) {
	return roundMoney(linePrice(line) * line.qty);
}

/** The staff discount (amount or percent) alone, at most the row's gross. */
export function lineStaffDiscount(line: PricedLine) {
	const gross = lineGross(line);
	if (!line.discount) return 0;
	const value = Math.max(line.discount.value, 0);
	// Percent: satang × hundredths of a percent, so 10% of 10.05 is exactly 1.005 → 1.01.
	const raw = line.discount.type === 'percent' ? percentageOf(gross, value) : value;
	return roundMoney(Math.min(raw, gross));
}

/** What a coupon may discount on a row: its price after the staff discount. */
export function lineCouponBase(line: PricedLine) {
	return roundMoney(lineGross(line) - lineStaffDiscount(line));
}

/** The row's coupon share, never more than the staff discount leaves. */
export function lineCouponDiscount(line: PricedLine) {
	return roundMoney(Math.min(Math.max(line.couponDiscount ?? 0, 0), lineCouponBase(line)));
}

/** Every discount on the row: the staff discount, then the coupon share. */
export function lineDiscount(line: PricedLine) {
	return roundMoney(lineStaffDiscount(line) + lineCouponDiscount(line));
}

export function lineNet(line: PricedLine) {
	return roundMoney(lineGross(line) - lineDiscount(line));
}

export function orderTotals(lines: readonly PricedLine[]): OrderTotals {
	const subtotal = sum(lines.map(lineGross));
	const discount = sum(lines.map(lineDiscount));
	const coupon = sum(lines.map(lineCouponDiscount));
	const total = roundMoney(subtotal - discount);
	const deposit = Math.min(sum(lines.map((line) => line.deposit ?? 0)), total);
	// VAT included at 7%: total × 7/107, in whole satang.
	const vat = roundRatio(BigInt(Math.max(total, 0)) * 7n, 107);
	return { subtotal, discount, coupon, total, vat, deposit, due: roundMoney(total - deposit) };
}

export function assertDiscount(discount: LineDiscount) {
	if (!Number.isSafeInteger(discount.value) || discount.value < 0) throw new ConvexError('Discount must be zero or more');
	if (discount.type === 'percent' && discount.value > 10000) throw new ConvexError('A percent discount is at most 100%');
	if (discount.value > MAX_ORDER) throw new ConvexError(atMost(MAX_ORDER));
}

/** A typed price: finite, zero or more, and within MAX_PRICE. */
export function assertPrice(price: number) {
	if (!Number.isSafeInteger(price) || price < 0) throw new ConvexError('Price must be zero or more');
	if (price > MAX_PRICE) throw new ConvexError(atMost(MAX_PRICE));
}

/** Every write to an order checks its subtotal, which also bounds booked stays and catalog prices. */
export function assertOrderSize(totals: Pick<OrderTotals, 'subtotal'>) {
	if (totals.subtotal > MAX_ORDER) throw new ConvexError(`An order is at most ${(MAX_ORDER / 100).toLocaleString('en-US')}. Split it into two orders.`);
}

/** A one-off price change needs a reason for the audit trail. Returns the trimmed note. */
export function assertPriceOverride(price: number, note: string) {
	assertPrice(price);
	const trimmed = note.trim();
	if (!trimmed) throw new ConvexError('Add a note explaining the price change');
	if (trimmed.length > NOTE_MAX) throw new ConvexError(`Note must be at most ${NOTE_MAX} characters`);
	return trimmed;
}

/** One to three payments that add up to exactly what is due; cash may be handed over in excess. */
export function assertTenders(tenders: readonly Tender[], due: number) {
	if (due === 0 && tenders.length === 0) return;
	if (tenders.length === 0) throw new ConvexError('Choose how the guest pays');
	if (tenders.length > MAX_TENDERS) throw new ConvexError(`Split across at most ${MAX_TENDERS} payments`);
	for (const tender of tenders) {
		if (!TENDER_METHODS.includes(tender.method)) throw new ConvexError('Unknown payment method');
		if (!Number.isFinite(tender.amount) || tender.amount <= 0) throw new ConvexError('Each payment must be more than zero');
		if (tender.amount > MAX_ORDER) throw new ConvexError(atMost(MAX_ORDER));
		if (roundMoney(tender.amount) !== tender.amount) throw new ConvexError('Payments are in whole satang (at most 2 decimals)');
		if (tender.received !== undefined) {
			if (tender.method !== 'cash') throw new ConvexError('Only cash can have an amount received');
			if (!Number.isFinite(tender.received)) throw new ConvexError('Cash received must be an amount');
			if (tender.received > MAX_ORDER) throw new ConvexError(atMost(MAX_ORDER));
			if (roundMoney(tender.received) !== tender.received) throw new ConvexError('Cash received is in whole satang (at most 2 decimals)');
			if (!(tender.received >= tender.amount)) throw new ConvexError('Cash received is less than the amount');
		}
	}
	const paid = sum(tenders.map((tender) => tender.amount));
	if (paid !== roundMoney(due)) throw new ConvexError(`Payments add up to ${paid / 100}, but ${roundMoney(due) / 100} is due`);
}

export function changeDue(tenders: readonly Tender[]) {
	return sum(tenders.map((tender) => (tender.received ?? tender.amount) - tender.amount));
}

type BookingMoney = { status: string; paymentStatus: string; total: number; amountPaid?: number; amountRefunded?: number; providerRefundWaived?: number };


export function bookingBalance(booking: BookingMoney) {
	const gross = roundMoney(
		booking.paymentStatus === 'paid' || booking.paymentStatus === 'refunded' ? (booking.amountPaid ?? 0) : (booking.amountPaid ?? 0)
	);
	const refunded = roundMoney(Math.min(Math.max(booking.amountRefunded ?? 0, 0), gross));
	const paid = roundMoney(gross - refunded);
	// A provider refund waives that charge; it is neither money received nor a new deposit.
	const collectible = Math.max(0, roundMoney(booking.total - paid - (booking.providerRefundWaived ?? 0)));
	const credit = Math.max(0, roundMoney(paid - booking.total));
	return { paid, owed: roundMoney(collectible - credit), gross, refunded };
}

/** Chargeable stay terms after a provider return, without treating waived money as a deposit. */
export function bookingChargeTotal(booking: Pick<BookingMoney, 'total' | 'providerRefundWaived'>) {
	return Math.max(0, roundMoney(booking.total - (booking.providerRefundWaived ?? 0)));
}

/** A live booking with money still owed, which checkout can collect (e.g. a paid stay that was extended). */
export function bookingPayable(booking: BookingMoney) {
	return booking.status !== 'cancelled' && booking.paymentStatus !== 'refunded' && booking.paymentStatus !== 'failed' && bookingBalance(booking).owed > 0;
}

export function formatReceiptNumber(n: number) {
	return `R-${String(n).padStart(6, '0')}`;
}

/** The permanent order number, separate from the receipt number issued at payment. */
export function formatOrderNumber(n: number) {
	return `#${n}`;
}


export function orderTitle(orderNumber: number | undefined) {
	return orderNumber === undefined ? 'Order' : `Order ${formatOrderNumber(orderNumber)}`;
}
