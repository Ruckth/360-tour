/**
 * POS bill math, shared by Convex and the checkout UI. Prices include 7% VAT (the receipt
 * shows the VAT portion); there is no service charge. Amounts are in the bill currency.
 */

export const VAT_RATE = 0.07;
export const MAX_TENDERS = 3;
export const NOTE_MAX = 500;
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
};
export type Tender = { method: TenderMethod; amount: number; received?: number };
export type BillTotals = { subtotal: number; discount: number; total: number; vat: number; deposit: number; due: number };

/**
 * Money rounds to the satang, halves away from zero. `toPrecision(15)` drops binary noise first,
 * so a decimal half such as 1.005 (stored as 1.00499…) rounds up like it does on paper.
 */
export const round2 = (n: number) => {
	const satang = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
	return (n < 0 ? -satang : satang) / 100;
};
/** Whole satang as an integer, for exact percentage arithmetic. */
const toSatang = (n: number) => Math.round(round2(n) * 100);
/** round(a / b) for non-negative integers, halves up, without floating-point error. */
const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));
const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));

export function linePrice(line: PricedLine) {
	return line.priceOverride?.price ?? line.unitPrice;
}

export function lineGross(line: PricedLine) {
	return round2(linePrice(line) * line.qty);
}

export function lineDiscount(line: PricedLine) {
	const gross = lineGross(line);
	if (!line.discount) return 0;
	const value = Math.max(line.discount.value, 0);
	// Percent: satang × hundredths of a percent, so 10% of 10.05 is exactly 1.005 → 1.01.
	const raw = line.discount.type === 'percent' ? divRound(toSatang(gross) * toSatang(value), 10000) / 100 : value;
	return round2(Math.min(raw, gross));
}

export function lineNet(line: PricedLine) {
	return round2(lineGross(line) - lineDiscount(line));
}

export function billTotals(lines: readonly PricedLine[]): BillTotals {
	const subtotal = sum(lines.map(lineGross));
	const discount = sum(lines.map(lineDiscount));
	const total = round2(subtotal - discount);
	const deposit = Math.min(sum(lines.map((line) => line.deposit ?? 0)), total);
	// VAT included at 7%: total × 7/107, in whole satang.
	const vat = divRound(toSatang(Math.max(total, 0)) * 7, 107) / 100;
	return { subtotal, discount, total, vat, deposit, due: round2(total - deposit) };
}

export function assertDiscount(discount: LineDiscount) {
	if (!Number.isFinite(discount.value) || discount.value < 0) throw new Error('Discount must be zero or more');
	if (discount.type === 'percent' && discount.value > 100) throw new Error('A percent discount is at most 100%');
}

/** A one-off price change needs a reason for the audit trail. Returns the trimmed note. */
export function assertPriceOverride(price: number, note: string) {
	if (!Number.isFinite(price) || price < 0) throw new Error('Price must be zero or more');
	const trimmed = note.trim();
	if (!trimmed) throw new Error('Add a note explaining the price change');
	if (trimmed.length > NOTE_MAX) throw new Error(`Note must be at most ${NOTE_MAX} characters`);
	return trimmed;
}

/** One to three payments that add up to exactly what is due; cash may be handed over in excess. */
export function assertTenders(tenders: readonly Tender[], due: number) {
	if (due === 0 && tenders.length === 0) return;
	if (tenders.length === 0) throw new Error('Choose how the guest pays');
	if (tenders.length > MAX_TENDERS) throw new Error(`Split across at most ${MAX_TENDERS} payments`);
	for (const tender of tenders) {
		if (!TENDER_METHODS.includes(tender.method)) throw new Error('Unknown payment method');
		if (!Number.isFinite(tender.amount) || tender.amount <= 0) throw new Error('Each payment must be more than zero');
		if (round2(tender.amount) !== tender.amount) throw new Error('Payments are in whole satang (at most 2 decimals)');
		if (tender.received !== undefined) {
			if (tender.method !== 'cash') throw new Error('Only cash can have an amount received');
			if (round2(tender.received) !== tender.received) throw new Error('Cash received is in whole satang (at most 2 decimals)');
			if (!(tender.received >= tender.amount)) throw new Error('Cash received is less than the amount');
		}
	}
	const paid = sum(tenders.map((tender) => tender.amount));
	if (paid !== round2(due)) throw new Error(`Payments add up to ${paid}, but ${round2(due)} is due`);
}

export function changeDue(tenders: readonly Tender[]) {
	return sum(tenders.map((tender) => (tender.received ?? tender.amount) - tender.amount));
}

export function formatReceiptNumber(n: number) {
	return `R-${String(n).padStart(6, '0')}`;
}
