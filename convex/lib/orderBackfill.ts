import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { billTotals } from './billMath';
import { ORDER_COUNTER, isOpenOrder, linkedOpenOrder, nextCounter } from './orderLinks';

/**
 * Turns bills written before orders existed into orders (migrations:backfillOrders). Per row:
 *
 * - a permanent order number, issued from the "order" counter in creation order; never changed once set;
 * - the legacy `held` status becomes `draft` (both are unpaid);
 * - `due` for the orders list (0 once paid or voided);
 * - a booking link when every charged stay/appointment row points to one booking, or a standalone
 *   appointment link when the only charged row is one appointment without a stay. Rows charging
 *   several bookings stay unlinked (each row keeps its own booking reference) and are reported;
 *   nothing is guessed;
 * - for paid and void rows, the copied guest name becomes the receipt's frozen customer name.
 *   No customer profile is created or matched from a name;
 * - for paid and void rows, each therapist row without a frozen name gets the therapist's name as
 *   it is at migration time (`billLines.staffName`, marked with `staffNameBackfilledAt`), so a
 *   later rename doesn't change an issued receipt. A rename made before the migration can't be
 *   undone; rows whose staff record is gone are reported and keep "Former staff member".
 *
 * Payments, receipt numbers, prices, quantities, sources and audit entries are not touched; on
 * rows only those two fields are added. Rerunning changes nothing.
 */

type ReadCtx = QueryCtx | MutationCtx;
export type OrderBackfillPlan = {
	patch: Partial<Doc<'bills'>>;
	/** Paid or void rows getting their therapist's name frozen (see unfrozenStaffNames). */
	lineStaffNames: Array<{ lineId: Id<'billLines'>; staffName: string }>;
	needsNumber: boolean;
	/** Why a row was left unlinked, for review. */
	notes: string[];
};

const LINE_SCAN = 101;

export async function orderBackfillPlan(ctx: ReadCtx, order: Doc<'bills'>): Promise<OrderBackfillPlan> {
	const patch: Partial<Doc<'bills'>> = {};
	const notes: string[] = [];
	const lines = await ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(LINE_SCAN);
	if (order.status === 'held') patch.status = 'draft';
	if (order.due === undefined) patch.due = isOpenOrder(order) ? billTotals(lines).due : 0;

	if (!order.bookingId && !order.appointmentId) {
		const bookingIds = [...new Set(lines.flatMap((line) => (line.bookingId ? [line.bookingId] : [])))];
		const appointmentIds = [...new Set(lines.flatMap((line) => (line.appointmentId ? [line.appointmentId] : [])))];
		const appointments = (await Promise.all(appointmentIds.map((id) => ctx.db.get(id)))).filter((a): a is Doc<'serviceAppointments'> => a !== null);
		// Stays the appointments belong to count as that booking.
		const stays = new Set<Id<'bookings'>>([...bookingIds, ...appointments.flatMap((a) => (a.bookingId ? [a.bookingId] : []))]);
		const standalone = appointments.filter((a) => !a.bookingId);
		const missing = appointmentIds.length - appointments.length;
		if (missing > 0) {
			// A deleted appointment's stay is unknown, so no single booking can be inferred.
			notes.push(`Source missing: ${missing === 1 ? 'a charged appointment no longer exists' : `${missing} charged appointments no longer exist`}; left unlinked, each row keeps its own reference`);
		} else if (stays.size > 1 || (stays.size === 1 && standalone.length > 0) || standalone.length > 1) {
			notes.push(`Charges ${stays.size} booking(s) and ${standalone.length} standalone appointment(s); left unlinked, each row keeps its own reference`);
		} else if (stays.size === 1) {
			const [bookingId] = stays;
			const other = isOpenOrder(order) ? await linkedOpenOrder(ctx, { bookingId }) : null;
			if (!(await ctx.db.get(bookingId))) notes.push('Booking no longer exists; left unlinked');
			else if (other && other._id !== order._id) notes.push(`Booking already has open order ${other._id}; left unlinked`);
			else patch.bookingId = bookingId;
		} else if (standalone.length === 1) {
			const appointmentId = standalone[0]._id;
			const other = isOpenOrder(order) ? await linkedOpenOrder(ctx, { appointmentId }) : null;
			if (other && other._id !== order._id) notes.push(`Appointment already has open order ${other._id}; left unlinked`);
			else patch.appointmentId = appointmentId;
		}
	}

	if (!isOpenOrder(order) && !order.customerSnapshot && order.guestName) {
		patch.customerSnapshot = { name: order.guestName, ...(order.guestPhone ? { phone: order.guestPhone } : {}), ...(order.guestEmail ? { email: order.guestEmail } : {}) };
	}
	const { names: lineStaffNames, unknown } = isOpenOrder(order) ? { names: [], unknown: 0 } : await unfrozenStaffNames(ctx, lines);
	if (unknown) {
		notes.push(`${unknown === 1 ? 'A paid row names a therapist' : `${unknown} paid rows name a therapist`} whose staff record no longer exists; the receipt shows "Former staff member"`);
	}
	return { patch, lineStaffNames, needsNumber: order.orderNumber === undefined, notes };
}

/**
 * Therapist names for a paid or void order's rows that were paid before names were frozen
 * (`staffName` missing): the staff member's name as it is now, which is the best record left.
 * A name changed before this runs can't be recovered. Rows whose staff record is gone are counted.
 */
export async function unfrozenStaffNames(ctx: ReadCtx, lines: Array<Doc<'billLines'>>) {
	const names: Array<{ lineId: Id<'billLines'>; staffName: string }> = [];
	const staff = new Map<Id<'staff'>, Doc<'staff'> | null>();
	let unknown = 0;
	for (const line of lines) {
		if (!line.staffId || line.staffName !== undefined) continue;
		if (!staff.has(line.staffId)) staff.set(line.staffId, await ctx.db.get(line.staffId));
		const person = staff.get(line.staffId);
		if (person) names.push({ lineId: line._id, staffName: person.name });
		else unknown++;
	}
	return { names, unknown };
}

/**
 * The migration step for one row: the plan, plus its order number from the counter. Frozen
 * therapist names are written onto their rows here (only `staffName` and
 * `staffNameBackfilledAt` are added; nothing on the row is changed). A dry run rolls these back
 * with the rest of the batch.
 */
export async function orderBackfillPatch(ctx: MutationCtx, order: Doc<'bills'>) {
	const { patch, lineStaffNames, needsNumber, notes } = await orderBackfillPlan(ctx, order);
	if (notes.length) console.warn(`bills ${order._id}: ${notes.join('; ')}`);
	const now = Date.now();
	for (const { lineId, staffName } of lineStaffNames) await ctx.db.patch(lineId, { staffName, staffNameBackfilledAt: now });
	if (needsNumber) patch.orderNumber = await nextCounter(ctx, ORDER_COUNTER);
	return Object.keys(patch).length ? patch : undefined;
}
