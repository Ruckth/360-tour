import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** One sentinel detects overflow; checkout refuses it instead of charging a partial stay. */
export const MAX_STAY_APPOINTMENTS = 50;

export function readStayAppointments(ctx: QueryCtx | MutationCtx, bookingId: Id<'bookings'>) {
	return ctx.db.query('serviceAppointments').withIndex('by_booking', (q) => q.eq('bookingId', bookingId)).take(MAX_STAY_APPOINTMENTS + 1);
}
