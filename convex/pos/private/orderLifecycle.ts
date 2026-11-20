import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { lineNet, orderTitle, orderTotals } from '../../shared/orderMath';
import { assertMoney } from '../../shared/money';
import { receiptVat } from '../../shared/commerce/vat';
import { readBudget } from '../../lib/readBudget';
import { isOpenOrder } from './orderLinks';
import { orderLines } from './orderLines';

/**
 * Rules for the order lifecycle beyond paying: discarding and restoring unpaid orders, and
 * no-show / late-cancellation fee rows. The mutations live in convex/pos/.
 */

type ReadCtx = QueryCtx | MutationCtx;

export const DISCARDED_ORDER = 'This order was discarded. Restore it from Orders → Discarded before changing or paying it.';

export type FeeKind = 'no_show' | 'late_cancellation';

/** The appointment status a fee kind is for. The appointment itself is never changed by a fee. */
export const FEE_STATUS: Record<FeeKind, Doc<'appointments'>['status']> = { no_show: 'no_show', late_cancellation: 'cancelled' };

export const FEE_LABEL: Record<FeeKind, string> = { no_show: 'No-show fee', late_cancellation: 'Late cancellation fee' };

/** How many fee rows one appointment's guard reads. More is refused rather than half-checked. */
const FEE_SCAN = 50;

/**
 * Whether a fee of this kind may be charged for the appointment now, or why not. The appointment
 * must still be marked no-show (or cancelled, for a late cancellation) and unpaid: a fee is not a
 * payment for the service, and a prepaid appointment's money is corrected by a refund instead.
 */
export function feeBlocker(appointment: Doc<'appointments'> | null, kind: FeeKind): string | null {
	if (!appointment) return 'This appointment no longer exists.';
	if (appointment.status !== FEE_STATUS[kind]) {
		return kind === 'no_show'
			? 'Only an appointment marked as a no-show can take a no-show fee.'
			: 'Only a cancelled appointment can take a late cancellation fee.';
	}
	if (appointment.paymentStatus !== 'unpaid') {
		return appointment.paymentStatus === 'paid'
			? 'This appointment is already paid. Record a refund of the difference instead of charging a fee.'
			: 'This appointment was refunded, so a fee can’t be charged on it.';
	}
	if (appointment.currency !== 'THB') return `This appointment is priced in ${appointment.currency}. Checkout takes THB only.`;
	return null;
}

/** Rechecked at settlement too: corrected service prices must still cap an existing fee. */
export function feePriceBlocker(amount: number, appointment: Doc<'appointments'>): string | null {
	return appointment.price > 0 && amount > appointment.price ? 'A fee can’t be more than the appointment’s price.' : null;
}

/** A fee amount: more than zero, whole satang, no more than the appointment's price when it has one. */
export function assertFeeAmount(amount: number, appointment: Doc<'appointments'>) {
	assertMoney(amount, 'Fee');
	const blocked = feePriceBlocker(amount, appointment);
	if (blocked) throw new ConvexError(blocked);
}

/**
 * Other fee rows for this appointment that still count: on an open order (could be charged) or on
 * a settled one that retained its money. Plain void does not return money or release the fee.
 */
export async function liveFees(ctx: ReadCtx, appointmentId: Id<'appointments'>, exceptOrderId?: Id<'orders'>, metered = false) {
	const feeRows = () => ctx.db.query('orderLines').withIndex('by_feeAppointmentId', (q) => q.eq('feeAppointmentId', appointmentId)).take(FEE_SCAN + 1);
	const rows = metered ? await readOrderProjection(ctx, feeRows) : await feeRows();
	if (rows.length > FEE_SCAN) throw new ConvexError('This appointment has too many fee rows to check. Contact support.');
	const live: Array<{ line: Doc<'orderLines'>; order: Doc<'orders'> }> = [];
	for (const line of rows) {
		if (line.orderId === exceptOrderId) continue;
		const readOrder = () => ctx.db.get(line.orderId);
		const order = metered ? await readOrderProjection(ctx, readOrder) : await readOrder();
		if (order && (isOpenOrder(order) || order.status === 'paid' || (order.status === 'void' && !order.voidUnreceived))) live.push({ line, order });
	}
	return live;
}

/** Why another fee row for the appointment rules this one out, or null. */
export function otherFeeMessage(other: { order: Doc<'orders'> } | undefined) {
	if (!other) return null;
	return isOpenOrder(other.order)
		? `A fee for this appointment is already on ${orderTitle(other.order.orderNumber)}.`
		: `A fee for this appointment was already charged on ${orderTitle(other.order.orderNumber)}${other.order.receiptNumber !== undefined ? ` (receipt ${other.order.receiptNumber})` : ''}.`;
}

export function externalOrderPayments(payments: readonly Doc<'orderPayments'>[]) {
  return payments.filter(payment => payment.method !== 'voucher');
}

export function voucherOrderPayments(payments: readonly Doc<'orderPayments'>[]) {
	return payments.filter(payment => payment.method === 'voucher');
}

/** Tender corrections replace the external methods. Voucher spend keeps its sale-time identity and amount. */
export function orderPaymentRecord(order: Doc<'orders'>, payments: readonly Doc<'orderPayments'>[]) {
	const allTenders = payments.map(payment => payment.method === 'voucher'
		? { method: payment.method, amount: payment.amount, voucherId: payment.voucherId }
		: { method: payment.method, amount: payment.amount, ...(payment.received !== undefined ? { received: payment.received } : {}) });
	const tenders = order.amendedTenders ?? allTenders.filter(tender => tender.method !== 'voucher');
	const voucherTenders = allTenders.filter(tender => tender.method === 'voucher');
	return {
		effectiveAt: order.paymentEffectiveAt ?? order.paidAt ?? null,
		// Reporting and external refund defaults consume the external column.
		tenders,
		...(voucherTenders.length ? { allTenders: order.amendedTenders ? [...tenders, ...voucherTenders] : allTenders } : {}),
		customer: order.amendedCustomer !== undefined ? order.amendedCustomer : (order.customerSnapshot ?? null)
	};
}

export function lineGoodwillDiscount(line: Doc<'orderLines'>) {
	return line.saleSnapshot?.goodwillDiscounts.reduce((sum, discount) => sum + discount.amount, 0) ?? 0;
}

export function receiptTotals(order: Doc<'orders'>, lines: readonly Doc<'orderLines'>[]) {
	const totals = orderTotals(lines);
	const goodwillDiscount = lines.reduce((sum, line) => sum + lineGoodwillDiscount(line), 0);
	const total = totals.total - goodwillDiscount;
	const deposit = Math.min(total, totals.deposit);
	const vat = order.vatVersion === 2
		? receiptVat({ vatVersion: 2, lines: lines.map(line => ({ vatBase: line.saleSnapshot?.vatBase ?? lineNet(line) })) })
		: null;
	return {
		...totals,
		...(goodwillDiscount ? { goodwillDiscount, discount: totals.discount + goodwillDiscount, total, deposit, due: total - deposit } : {}),
		...vat,
	};
}

export function isCommerceLine(line: Doc<'orderLines'>) {
	return line.kind === 'product' || line.kind === 'package' || line.kind === 'voucher' || line.coverage !== undefined ||
		lineGoodwillDiscount(line) > 0 || line.saleSnapshot?.tenderCells.some(cell => cell.kind === 'voucher') === true;
}

/** Count a single get or bounded index range against the invocation's read budget. */
export async function readOrderProjection<T>(ctx: ReadCtx, read: () => Promise<T>): Promise<T> {
	const budget = readBudget(ctx);
	budget.range();
	budget.assert();
	const result = await read();
	for (const row of Array.isArray(result) ? result : [result]) {
		if (row !== null) budget.document(row);
		budget.assert();
	}
	return result;
}

export function openOrderReturn(ctx: ReadCtx, orderId: Id<'orders'>) {
	return readOrderProjection(ctx, () => ctx.db.query('orderReturns')
		.withIndex('by_orderId_and_status', q => q.eq('orderId', orderId).eq('status', 'authorized')).first());
}

export async function voucherCodeMask(ctx: ReadCtx, voucher: Doc<'vouchers'>) {
	const { activeCodeId } = voucher;
	if (!activeCodeId) return null;
	const code = await readOrderProjection(ctx, () => ctx.db.get(activeCodeId));
	return code?.voucherId === voucher._id && code.status === 'active' && code.mask && !code.mask.includes(code.code) ? code.mask : null;
}

export function correctionPreviewBlocker(commerce: boolean, activeReturn: Doc<'orderReturns'> | null) {
	if (activeReturn) {
		return { code: 'RETURN_IN_PROGRESS' as const, message: 'Return in progress', returnId: activeReturn._id };
	}
	if (commerce) return { code: 'COMMERCE_CORRECTION_UNAVAILABLE' as const, message: 'This receipt has commerce items or voucher value. Use the commerce correction flow.' };
	return null;
}

// W1 treats the whole receipt as the correction unit, including links on a pre-commerce sibling.
export function isCommerceReceipt(order: Doc<'orders'>, lines: readonly Doc<'orderLines'>[], hasVoucherTender: boolean) {
	return order.returnedTotal !== undefined || hasVoucherTender || lines.some(isCommerceLine);
}

export async function readCommerceReceiptStatus(ctx: ReadCtx, order: Doc<'orders'>, lines: readonly Doc<'orderLines'>[]) {
	if (isCommerceReceipt(order, lines, false)) return true;
	const voucherTender = await readOrderProjection(ctx, () => ctx.db.query('orderPayments')
		.withIndex('by_orderId_and_method', q => q.eq('orderId', order._id).eq('method', 'voucher')).first());
	return voucherTender !== null;
}

export async function assertReceiptCorrectionSupported(ctx: ReadCtx, order: Doc<'orders'>, lines?: readonly Doc<'orderLines'>[]) {
	const activeReturn = await openOrderReturn(ctx, order._id);
	const commerce = !activeReturn && await readCommerceReceiptStatus(ctx, order, lines ?? await readOrderProjection(ctx, () => orderLines(ctx, order._id)));
	const blocker = correctionPreviewBlocker(commerce, activeReturn);
	if (blocker) throw new ConvexError(blocker);
}
