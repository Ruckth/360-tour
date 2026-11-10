import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Reads of billLineLinks: a paid service or room row applied later to the appointment or stay it
 * paid for (pos.linkPaidLine, schema `billLineLinks`). Every reader that asks "which order took
 * money for this source" (order lists for a booking, refunds by receipt, corrections and voids)
 * includes these links, not only rows that charged the source at checkout.
 */

type ReadCtx = QueryCtx | MutationCtx;
type Source = { bookingId: Id<'bookings'> } | { appointmentId: Id<'serviceAppointments'> };

/** Far above any real order or source; reads stay bounded. */
export const MAX_LINKS = 100;

export function orderLineLinks(ctx: ReadCtx, billId: Id<'bills'>, status?: Doc<'billLineLinks'>['status']) {
	return ctx.db
		.query('billLineLinks')
		.withIndex('by_billId_and_status', (q) => (status ? q.eq('billId', billId).eq('status', status) : q.eq('billId', billId)))
		.take(MAX_LINKS);
}

export function activeLineLink(ctx: ReadCtx, lineId: Id<'billLines'>) {
	return ctx.db.query('billLineLinks').withIndex('by_lineId_and_status', (q) => q.eq('lineId', lineId).eq('status', 'active')).first();
}

/** Links to this source, newest first; `status` narrows to active or unlinked ones. */
export function sourceLineLinks(ctx: ReadCtx, source: Source, status?: Doc<'billLineLinks'>['status'], limit = MAX_LINKS) {
	return 'bookingId' in source
		? ctx.db.query('billLineLinks').withIndex('by_bookingId_and_status', (q) => (status ? q.eq('bookingId', source.bookingId).eq('status', status) : q.eq('bookingId', source.bookingId))).order('desc').take(limit)
		: ctx.db.query('billLineLinks').withIndex('by_appointmentId_and_status', (q) => (status ? q.eq('appointmentId', source.appointmentId).eq('status', status) : q.eq('appointmentId', source.appointmentId))).order('desc').take(limit);
}

export async function activeSourceLink(ctx: ReadCtx, source: Source) {
	return (await sourceLineLinks(ctx, source, 'active', 1))[0] ?? null;
}
