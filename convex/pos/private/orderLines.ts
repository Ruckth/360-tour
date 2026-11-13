import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

/** An order holds at most this many rows (convex/pos/private/lineCommands.ts refuses more), so one bounded read gets them all. */
export const MAX_LINES = 100;

/** An order's rows, oldest first. */
export async function orderLines(ctx: QueryCtx | MutationCtx, orderId: Id<'orders'>) {
	return await ctx.db.query('orderLines').withIndex('by_orderId', (q) => q.eq('orderId', orderId)).take(MAX_LINES);
}
