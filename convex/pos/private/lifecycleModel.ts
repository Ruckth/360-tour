import type { Id } from '../../_generated/dataModel';
import { liveFees } from './orderLifecycle';
import { isOpenOrder } from '../../shared/orderState';
import { linkedOpenOrder, openOrderCharging, type OrderSource } from './orderLinks';
import { orderTitle } from '../../lib/orderMath';
import { Line, Order, ReadCtx, isSourceRow, sourceIssue } from './orderModel';

/** Who, when and why an order was discarded, as the lists and the order screen show it. */
export type RestoreConflict = {
	kind: 'charged_elsewhere' | 'changed' | 'settled' | 'gone' | 'online' | 'link_shared' | 'customer';
	/** Blocking conflicts stop a restore unless `removeConflictingRows` takes those rows off. */
	blocking: boolean;
	lineId: Id<'orderLines'> | null;
	name: string;
	message: string;
	order: { _id: Id<'orders'>; title: string } | null;
};

/**
 * What restoring this discarded order would meet, row by row, without changing anything.
 * - Blocking: a stay, appointment or fee it carries is now on another open order. Restoring that
 *   row would put one source on two open orders (a second chargeable copy), so it is refused or,
 *   when asked, the row is taken off.
 * - Not blocking: the source changed, was paid, cancelled or deleted, or has an online checkout
 *   running. The row comes back exactly as it was (its source is never overwritten) and is flagged,
 *   so payment is refused until staff update or remove it, as for any open order.
 * - Not blocking: another open order is also linked to the same booking, or the linked customer was
 *   archived, merged or deleted.
 */
export async function restoreConflicts(ctx: ReadCtx, order: Order, lines: Line[]): Promise<RestoreConflict[]> {
	const out: RestoreConflict[] = [];
	for (const line of lines) {
		if (!isSourceRow(line)) continue;
		let other: Order | null = null;
		if (line.bookingId) other = await openOrderCharging(ctx, { bookingId: line.bookingId }, order._id);
		else if (line.appointmentId) other = await openOrderCharging(ctx, { appointmentId: line.appointmentId }, order._id);
		else if (line.feeAppointmentId) other = (await liveFees(ctx, line.feeAppointmentId, order._id)).find((fee) => isOpenOrder(fee.order))?.order ?? null;
		if (other) {
			out.push({
				kind: 'charged_elsewhere', blocking: true, lineId: line._id, name: line.name,
				message: `${line.name} is now on ${orderTitle(other.orderNumber)}.`, order: { _id: other._id, title: orderTitle(other.orderNumber) }
			});
			continue;
		}
		const issue = await sourceIssue(ctx, line);
		if (issue) out.push({ kind: issue.kind, blocking: false, lineId: line._id, name: line.name, message: issue.message, order: null });
	}
	const link: OrderSource | null = order.bookingId ? { bookingId: order.bookingId } : order.appointmentId ? { appointmentId: order.appointmentId } : null;
	if (link) {
		const other = await linkedOpenOrder(ctx, link);
		if (other && other._id !== order._id) {
			out.push({
				kind: 'link_shared', blocking: false, lineId: null, name: 'bookingId' in link ? 'Booking' : 'Appointment',
				message: `${orderTitle(other.orderNumber)} is also open for this booking. Both stay linked; nothing is charged twice.`,
				order: { _id: other._id, title: orderTitle(other.orderNumber) }
			});
		}
	}
	if (order.customerId) {
		const customer = await ctx.db.get(order.customerId);
		const message = !customer
			? 'The linked customer no longer exists. Link another customer or remove the link before paying.'
			: customer.mergedInto
				? 'The linked customer was merged into another profile. Review the customer before paying.'
				: customer.archivedAt
					? 'The linked customer is archived. The link stays; restore the profile or change the customer if needed.'
					: null;
		if (message) out.push({ kind: 'customer', blocking: false, lineId: null, name: customer?.name ?? 'Customer', message, order: null });
	}
	return out;
}

export const discardedInfo = (order: Order) => ({ at: order.discardedAt ?? order.updatedAt, by: order.discardedBy ?? null, reason: order.discardReason ?? null });
