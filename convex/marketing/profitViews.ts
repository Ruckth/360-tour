import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, marketingMutation } from '../auth/model';
import { ReadBudgetExceeded } from '../lib/readBudget';
import { MAX_REPORT_DAYS, reportDayCount } from '../shared/marketingReport';
import { viewOwner } from './private/profitViews';
import { readServiceFinanceFacts } from './private/serviceFinanceFacts';

const lifetime = 15 * 60_000;
export const openView = marketingMutation({
  permission: 'spend',
  args: { from: v.string(), to: v.string(), refresh: v.boolean() },
  returns: v.id('serviceProfitViews'),
  handler: async (ctx, { from, to, refresh }): Promise<Id<'serviceProfitViews'>> => {
    const days = reportDayCount(from, to);
    if (!days || days > MAX_REPORT_DAYS) throw new ConvexError('Select between 1 and 92 Bangkok days.');
    const named = ctx.marketing.capabilities.serviceFinance,
      owner = await viewOwner(ctx);
    const previous = await ctx.db
      .query('serviceProfitViews')
      .withIndex('by_owner_range', (q) => q.eq('owner', owner).eq('from', from).eq('to', to).eq('named', named))
      .order('desc')
      .first();
    if (!refresh && previous && previous.expiresAt > Date.now() + 60_000) return previous._id;
    let data;
    try {
      data = JSON.stringify(await readServiceFinanceFacts(ctx, from, to, named));
    } catch (error) {
      if (error instanceof ReadBudgetExceeded)
        throw new ConvexError('This period exceeds the report read limit. Choose a shorter period.');
      throw error;
    }
    if (new TextEncoder().encode(data).length > 4_000_000)
      throw new ConvexError('Choose a shorter period to open this report.');
    const id = await ctx.db.insert('serviceProfitViews', {
      owner,
      from,
      to,
      named,
      expiresAt: Date.now() + lifetime,
    });
    // Limit UTF-16 chunk size so even multi-byte service names fit well below Convex's document limit.
    for (let at = 0, sequence = 0; at < data.length; sequence++) {
      let next = Math.min(at + 100_000, data.length);
      if (next < data.length && data.charCodeAt(next - 1) >= 0xd800 && data.charCodeAt(next - 1) <= 0xdbff) next--;
      await ctx.db.insert('serviceProfitViewChunks', { viewId: id, sequence, payload: data.slice(at, next) });
      at = next;
    }
    await ctx.scheduler.runAfter(lifetime, internal.marketing.profitViews.expireView, { id });
    return id;
  },
});
export const expireView = internalMutation({
  args: { id: v.id('serviceProfitViews') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    for (const part of await ctx.db
      .query('serviceProfitViewChunks')
      .withIndex('by_view', (q) => q.eq('viewId', id))
      .take(65))
      await ctx.db.delete(part._id);
    if (await ctx.db.get(id)) await ctx.db.delete(id);
    return null;
  },
});
