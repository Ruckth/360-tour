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

/** At most 100 active links (one per order row), plus a bounded page of undone links. */
export const MAX_LINKS = 100;

export async function orderLineLinks(ctx: ReadCtx, billId: Id<'bills'>, status?: Doc<'billLineLinks'>['status']): Promise<Doc<'billLineLinks'>[]> {
	if (!status) {
		// Read active links separately so history cannot crowd them out, and show recent undos.
		const [active, history] = await Promise.all([orderLineLinks(ctx, billId, 'active'), orderLineLinks(ctx, billId, 'unlinked')]);
		return [...active, ...history];
	}
	return ctx.db
		.query('billLineLinks')
		.withIndex('by_billId_and_status', (q) => q.eq('billId', billId).eq('status', status))
		.order('desc')
		.take(MAX_LINKS);
}

export function activeLineLink(ctx: ReadCtx, lineId: Id<'billLines'>) {
	return ctx.db.query('billLineLinks').withIndex('by_lineId_and_status', (q) => q.eq('lineId', lineId).eq('status', 'active')).unique();
}

function sourceLinksQuery(ctx: ReadCtx, source: Source, status: Doc<'billLineLinks'>['status']) {
	return 'bookingId' in source
		? ctx.db.query('billLineLinks').withIndex('by_bookingId_and_status', (q) => q.eq('bookingId', source.bookingId).eq('status', status))
		: ctx.db.query('billLineLinks').withIndex('by_appointmentId_and_status', (q) => q.eq('appointmentId', source.appointmentId).eq('status', status));
}

/** Active ownership plus recent undone history, or a bounded page of the requested status. */
export async function sourceLineLinks(ctx: ReadCtx, source: Source, status?: Doc<'billLineLinks'>['status'], limit = MAX_LINKS): Promise<Doc<'billLineLinks'>[]> {
	if (status) return sourceLinksQuery(ctx, source, status).order('desc').take(limit);
	const [active, history] = await Promise.all([activeSourceLink(ctx, source), sourceLinksQuery(ctx, source, 'unlinked').order('desc').take(limit)]);
	return active ? [active, ...history] : history;
}

export function activeSourceLink(ctx: ReadCtx, source: Source) {
	return sourceLinksQuery(ctx, source, 'active').unique();
}
