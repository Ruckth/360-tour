import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

/**
 * Reads of orderLineLinks: a paid service or room row applied later to the appointment or stay it
 * paid for (convex/pos/commands/linkPaidLine.ts, schema `orderLineLinks`). Every reader that asks "which order took
 * money for this source" (order lists for a booking, refunds by receipt, corrections and voids)
 * includes these links, not only rows that charged the source at checkout.
 */

type ReadCtx = QueryCtx | MutationCtx;

type Source = { bookingId: Id<'bookings'> } | { appointmentId: Id<'appointments'> };

/** At most 100 active links (one per order row), plus a bounded page of undone links. */
export const MAX_LINKS = 100;

export async function orderLineLinks(ctx: ReadCtx, orderId: Id<'orders'>, status?: Doc<'orderLineLinks'>['status']): Promise<Doc<'orderLineLinks'>[]> {
	if (!status) {
		// Read active links separately so history cannot crowd them out, and show recent undos.
		const [active, history] = await Promise.all([orderLineLinks(ctx, orderId, 'active'), orderLineLinks(ctx, orderId, 'unlinked')]);
		return [...active, ...history];
	}
	return ctx.db
		.query('orderLineLinks')
		.withIndex('by_orderId_and_status', (q) => q.eq('orderId', orderId).eq('status', status))
		.order('desc')
		.take(MAX_LINKS);
}

export function activeLineLink(ctx: ReadCtx, lineId: Id<'orderLines'>) {
	return ctx.db.query('orderLineLinks').withIndex('by_lineId_and_status', (q) => q.eq('lineId', lineId).eq('status', 'active')).unique();
}

function sourceLinksQuery(ctx: ReadCtx, source: Source, status: Doc<'orderLineLinks'>['status']) {
	return 'bookingId' in source
		? ctx.db.query('orderLineLinks').withIndex('by_bookingId_and_status', (q) => q.eq('bookingId', source.bookingId).eq('status', status))
		: ctx.db.query('orderLineLinks').withIndex('by_appointmentId_and_status', (q) => q.eq('appointmentId', source.appointmentId).eq('status', status));
}

/** Active ownership plus recent undone history, or a bounded page of the requested status. */
export async function sourceLineLinks(ctx: ReadCtx, source: Source, status?: Doc<'orderLineLinks'>['status'], limit = MAX_LINKS): Promise<Doc<'orderLineLinks'>[]> {
	if (status) return sourceLinksQuery(ctx, source, status).order('desc').take(limit);
	const [active, history] = await Promise.all([activeSourceLink(ctx, source), sourceLinksQuery(ctx, source, 'unlinked').order('desc').take(limit)]);
	return active ? [active, ...history] : history;
}

export function activeSourceLink(ctx: ReadCtx, source: Source) {
	return sourceLinksQuery(ctx, source, 'active').unique();
}
