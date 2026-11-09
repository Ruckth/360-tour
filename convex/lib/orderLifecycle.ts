import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertMoney } from './bookingMoney';
import { orderTitle } from './billMath';
import { isOpenOrder } from './orderLinks';

/**
 * Rules for the order lifecycle beyond paying: discarding and restoring unpaid orders, and
 * no-show / late-cancellation fee rows. The mutations live in convex/pos.ts.
 */

type ReadCtx = QueryCtx | MutationCtx;

export const DISCARDED_ORDER = 'This order was discarded. Restore it from Orders → Discarded before changing or paying it.';

export type FeeKind = 'no_show' | 'late_cancellation';

/** The appointment status a fee kind is for. The appointment itself is never changed by a fee. */
export const FEE_STATUS: Record<FeeKind, Doc<'serviceAppointments'>['status']> = { no_show: 'no_show', late_cancellation: 'cancelled' };

export const FEE_LABEL: Record<FeeKind, string> = { no_show: 'No-show fee', late_cancellation: 'Late cancellation fee' };

/** How many fee rows one appointment's guard reads. More is refused rather than half-checked. */
const FEE_SCAN = 50;

/**
 * Whether a fee of this kind may be charged for the appointment now, or why not. The appointment
 * must still be marked no-show (or cancelled, for a late cancellation) and unpaid: a fee is not a
 * payment for the service, and a prepaid appointment's money is corrected by a refund instead.
 */
export function feeBlocker(appointment: Doc<'serviceAppointments'> | null, kind: FeeKind): string | null {
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
export function feePriceBlocker(amount: number, appointment: Doc<'serviceAppointments'>): string | null {
	return appointment.price > 0 && amount > appointment.price ? 'A fee can’t be more than the appointment’s price.' : null;
}

/** A fee amount: more than zero, whole satang, no more than the appointment's price when it has one. */
export function assertFeeAmount(amount: number, appointment: Doc<'serviceAppointments'>) {
	assertMoney(amount, 'Fee');
	const blocked = feePriceBlocker(amount, appointment);
	if (blocked) throw new ConvexError(blocked);
}

/**
 * Other fee rows for this appointment that still count: on an open order (could be charged) or on
 * a settled one that retained its money. Plain void does not return money or release the fee.
 */
export async function liveFees(ctx: ReadCtx, appointmentId: Id<'serviceAppointments'>, exceptOrderId?: Id<'bills'>) {
	const rows = await ctx.db.query('billLines').withIndex('by_feeAppointmentId', (q) => q.eq('feeAppointmentId', appointmentId)).take(FEE_SCAN + 1);
	if (rows.length > FEE_SCAN) throw new ConvexError('This appointment has too many fee rows to check. Contact support.');
	const live: Array<{ line: Doc<'billLines'>; order: Doc<'bills'> }> = [];
	for (const line of rows) {
		if (line.billId === exceptOrderId) continue;
		const order = await ctx.db.get(line.billId);
		if (order && (isOpenOrder(order) || order.status === 'paid' || (order.status === 'void' && !order.voidUnreceived))) live.push({ line, order });
	}
	return live;
}

/** Why another fee row for the appointment rules this one out, or null. */
export function otherFeeMessage(other: { order: Doc<'bills'> } | undefined) {
	if (!other) return null;
	return isOpenOrder(other.order)
		? `A fee for this appointment is already on ${orderTitle(other.order.orderNumber)}.`
		: `A fee for this appointment was already charged on ${orderTitle(other.order.orderNumber)}${other.order.receiptNumber !== undefined ? ` (receipt ${other.order.receiptNumber})` : ''}.`;
}

