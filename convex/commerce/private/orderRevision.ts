import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { readBudget, reserveWrites } from '../../lib/readBudget';

/** Call in the same mutation as the effects, with every owning order (including both ends of a move). */
export async function bumpOrderCommerceRevision(ctx: MutationCtx, orderIds: Iterable<Id<'orders'>>) {
  const ids = [...new Set(orderIds)];
  const budget = readBudget(ctx);
  reserveWrites(ctx, ids.length);
  await Promise.all(ids.map(async id => {
    budget.range();
    budget.assert();
    const order = await ctx.db.get(id);
    if (!order) throw new Error('Commerce effect has no owning order');
    budget.document(order);
    budget.assert();
    await ctx.db.patch(id, { commerceRevision: (order.commerceRevision ?? 0) + 1 });
  }));
}
