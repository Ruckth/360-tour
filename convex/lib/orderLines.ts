import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** An order holds at most this many rows (pos.ts refuses more), so one bounded read gets them all. */
export const MAX_LINES = 100;

/** An order's rows, oldest first. */
export async function orderLines(ctx: QueryCtx | MutationCtx, orderId: Id<'bills'>) {
	return await ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', orderId)).take(MAX_LINES);
}
