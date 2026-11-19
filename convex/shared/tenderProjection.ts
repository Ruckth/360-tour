import type { Doc } from '../_generated/dataModel';
import { lineNet, orderTotals } from './orderMath';
import { roundMoney } from './money';
import { resortTodayIso } from './time';

type TenderMethod =
	| Doc<'orderPayments'>['method']
	| Doc<'bookingPayments'>['method']
	| Doc<'orderRefunds'>['method'];

type DatedTender = {
	method: TenderMethod;
	amount: number;
	date: number | string;
	returnId?: string;
};

export type TenderMovement = {
	kind: 'payment' | 'refund';
	day: string;
	method: Exclude<TenderMethod, 'voucher'>;
	amount: number;
};

export type TenderDay = Pick<TenderMovement, 'day' | 'method'> & {
	moneyIn: number;
	moneyOut: number;
};

export function tenderDay(date: number | string): string {
	return typeof date === 'string' ? date : resortTodayIso(date);
}

/** Payouts are the cash evidence for a commerce return. Its refund rows are owner mirrors. */
export function isExternalRefund<T extends Pick<DatedTender, 'method' | 'returnId'>>(
	refund: T,
): refund is T & { method: TenderMovement['method'] } {
	return refund.method !== 'voucher' && refund.returnId === undefined;
}

export function projectTender({
	payments = [],
	stayPayments = [],
	refunds = [],
	payouts = [],
	recordedPayoutTotal,
}: {
	payments?: readonly DatedTender[];
	/** The POS booking ledger already counts this part of the receipt as stay money. */
	stayPayments?: readonly DatedTender[];
	refunds?: readonly DatedTender[];
	payouts?: readonly Pick<Doc<'returnPayouts'>, 'method' | 'businessDate' | 'amount'>[];
	/** Lifetime external payout rollup when only the date-selected events are loaded. */
	recordedPayoutTotal?: number;
}) {
	const moneyIn: TenderMovement[] = [];
	const moneyOut: TenderMovement[] = [];
	for (const payment of payments) {
		if (payment.method === 'voucher') continue;
		moneyIn.push({ kind: 'payment', day: tenderDay(payment.date), method: payment.method, amount: payment.amount });
	}
	for (const payment of stayPayments) {
		moneyIn.push({ kind: 'payment', day: tenderDay(payment.date), method: 'order', amount: -payment.amount });
	}
	for (const refund of refunds) {
		if (!isExternalRefund(refund)) continue;
		moneyOut.push({ kind: 'refund', day: tenderDay(refund.date), method: refund.method, amount: refund.amount });
	}
	const legacyRefunded = moneyOut.reduce((sum, movement) => sum + movement.amount, 0);
	let payoutAmount = 0;
	for (const payout of payouts) {
		moneyOut.push({ kind: 'refund', day: payout.businessDate, method: payout.method, amount: payout.amount });
		payoutAmount += payout.amount;
	}
	return {
		moneyIn,
		moneyOut,
		collected: roundMoney(moneyIn.reduce((sum, movement) => sum + movement.amount, 0)),
		refunded: roundMoney(legacyRefunded + (recordedPayoutTotal ?? payoutAmount)),
	};
}

/** 'order' offsets a booking-owned share where the original split has no per-method allocation. */
export function addTenderDay(days: Map<string, TenderDay>, movement: TenderMovement) {
	const { day, method, kind, amount } = movement;
	const key = `${day}:${method}`;
	const totals = days.get(key) ?? { day, method, moneyIn: 0, moneyOut: 0 };
	if (kind === 'payment') totals.moneyIn += amount;
	else totals.moneyOut += amount;
	days.set(key, totals);
}

export type VoucherDay = {
	day: string;
	kind: 'issued' | 'redeemed' | 'credited' | 'revoked' | 'expired';
	paid: number;
	goodwill: number;
};

/** Balance changes are liability movements. A replacement code carries the refund's existing value. */
export function projectVoucherMovement(
	entry: Pick<Doc<'voucherEntries'>, 'kind' | 'createdAt' | 'before' | 'after'>,
	sourceKind?: Doc<'vouchers'>['source']['kind'],
): VoucherDay | null {
	let kind: VoucherDay['kind'];
	switch (entry.kind) {
		case 'issue':
			kind = sourceKind === 'refund_credit' ? 'credited' : 'issued';
			break;
		case 'spend':
			kind = 'redeemed';
			break;
		case 'refund_credit':
			kind = 'credited';
			break;
		case 'revoke':
			kind = 'revoked';
			break;
		case 'expire':
			kind = 'expired';
			break;
		default:
			return null;
	}
	const gain = kind === 'issued' || kind === 'credited';
	const [from, to] = gain ? [entry.before, entry.after] : [entry.after, entry.before];
	const paid = to.paid - from.paid;
	const goodwill = to.goodwill - from.goodwill;
	return paid || goodwill ? { day: tenderDay(entry.createdAt), kind, paid, goodwill } : null;
}

type SaleLine = Pick<Doc<'orderLines'>, 'kind' | 'saleSnapshot' | 'unitPrice' | 'qty' | 'priceOverride' | 'discount' | 'couponDiscount'>;

/** The row VAT base already includes its package contents, frozen under its sale-time VAT setting. */
export function projectOrderSale(lines: readonly SaleLine[]) {
	let saleValue = 0;
	let vatBase = 0;
	for (const line of lines) {
		// The booking ledger owns the accommodation charged on an attached booking row.
		if (line.kind === 'booking') continue;
		vatBase += line.saleSnapshot?.vatBase ?? 0;
		saleValue += line.saleSnapshot?.paidShare ?? lineNet(line);
	}
	return { saleValue, vatBase, vat: orderTotals([{ unitPrice: vatBase, qty: 1 }]).vat };
}

/** D1 excludes product and package rows. v27 explicitly allows credit on a standalone voucher sale. */
export function excludesAffiliateCredit(kind: SaleLine['kind']) {
	return kind === 'product' || kind === 'package';
}
