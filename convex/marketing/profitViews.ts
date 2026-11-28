import { ConvexError, v } from 'convex/values';
import { api, internal } from '../_generated/api';
import { env } from '../_generated/server';
import { ConvexHttpClient } from 'convex/browser';
import type { Id } from '../_generated/dataModel';
import { internalAction, internalMutation, marketingMutation, marketingQuery, publicQuery } from '../auth/model';
import { ReadBudgetExceeded } from '../lib/readBudget';
import { MAX_REPORT_DAYS, reportDayCount, reportRangeBounds } from '../shared/marketingReport';
import { retireView, storeSourceView, viewOwner } from './private/profitViews';
import { discloseServiceFinanceFacts, expensesFor, readServiceFinanceFacts, type ReportFacts } from './private/serviceFinanceFacts';
import { profitVisitPage } from '../services/model';
import { profitFees } from '../pos/model';
import { sha256 } from '../shared/displayTokens';
import type { CustomerHistory } from '../shared/profitability';


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
      .withIndex('by_owner_range_parent', (q) =>
        q.eq('owner', owner).eq('from', from).eq('to', to).eq('named', named).eq('parentViewId', undefined),
      )
      .order('desc')
      .first();
    if (previous && previous.expiresAt > Date.now() + 60_000 && previous.assemblyState !== 'failed' &&
      (!refresh || previous.assemblyState === 'building')) return previous._id;
    let data: string | null = null;
    try {
      data = JSON.stringify(await readServiceFinanceFacts(ctx, from, to, named));
    } catch (error) {
      if (!(error instanceof ReadBudgetExceeded)) throw error;
      if (process.env.PROFIT_PREPARATION_PAUSED === '1')
        throw new ConvexError('This report exceeds the source read limit. Choose a shorter period.');
    }
    if (data && new TextEncoder().encode(data).length > snapshotLimit)
      throw new ConvexError('Choose a shorter period to open this report.');
    const key = data === null ? crypto.randomUUID() + crypto.randomUUID() : null;
    const active = await ctx.db.query('serviceProfitViews').withIndex('by_owner_parent_expiry', (q) =>
      q.eq('owner', owner).eq('parentViewId', undefined).gt('expiresAt', Date.now()),
    ).take(4);
    if (active.length === 4) await retireView(ctx, active[0]);
    const id = await ctx.db.insert('serviceProfitViews', {
      owner,
      from,
      to,
      named,
      expiresAt: Date.now() + lifetime,
      ...(key && { assemblyState: 'building' as const, assemblyKey: await sha256(key) }),
    });
    if (data !== null) await storeSourceView(ctx, id, data);
    else if (key) await ctx.scheduler.runAfter(0, internal.marketing.profitViews.buildLargeSource, { id, key });
    await ctx.scheduler.runAfter(lifetime, internal.marketing.profitViews.expireView, { id });
    return id;
  },
});
export const sourceStatus = marketingQuery({
  permission: 'spend',
  args: { id: v.id('serviceProfitViews') },
  returns: v.union(v.literal('ready'), v.literal('building'), v.literal('failed'), v.literal('expired')),
  handler: async (ctx, { id }) => {
    const view = await ctx.db.get(id);
    if (!view || view.parentViewId || view.owner !== await viewOwner(ctx) ||
      view.named !== ctx.marketing.capabilities.serviceFinance || view.expiresAt <= Date.now()) return 'expired';
    return view.assemblyState ?? 'ready';
  },
});

const sourceReadArgs = {
  id: v.id('serviceProfitViews'),
  key: v.string(),
};
type SourcePage = Awaited<ReturnType<typeof profitVisitPage>>;
const sourceLanes = [0, 1, 2, 3] as const;
const sourceLane = v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3));
type SourceLane = (typeof sourceLanes)[number];
type SourceExtras = Pick<ReportFacts, 'expenses' | 'missingMonths' | 'asOf'> & { fees: ReportFacts['lines'] };

// This endpoint is called by the scheduled worker over the database's timestamp-pinned HTTP transport.
// The capability is created after finance authorization and is sent only in the private scheduled job.
export const sourceBatch = publicQuery({
  reason: 'A private scheduled finance job reads its bound source scope using a one-time capability.',
  args: {
    ...sourceReadArgs,
    batch: v.union(v.literal('visits'), v.literal('extras')),
    lane: sourceLane,
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { id, key, batch, lane, cursor }) => {
    const view = await ctx.db.get(id);
    if (key.length !== 72 || !view || view.assemblyState !== 'building' ||
      view.expiresAt <= Date.now() || view.assemblyKey !== await sha256(key))
      throw new ConvexError('Report source access expired.');
    const { start, end } = reportRangeBounds(view.from, view.to);
    if (batch === 'visits') {
      const split = (index: number) => start + Math.floor((end - start) * index / 3);
      const scan = lane === 0 ? { to: start } : { from: split(lane - 1), to: split(lane) };
      return JSON.stringify(await profitVisitPage(ctx, start, end, cursor, scan));
    }
    const [fees, expense] = await Promise.all([profitFees(ctx, start, end), expensesFor(ctx, view.from, view.to)]);
    const extra: SourceExtras = { fees, ...expense, asOf: Date.now() };
    return JSON.stringify(extra);
  },
});

const snapshotLimit = 6_000_000;
const maximumSourcePages = 512;
const maximumHistoryBytes = 16_000_000;
export const buildLargeSource = internalAction({
  args: sourceReadArgs,
  returns: v.null(),
  handler: async (ctx, { id, key }): Promise<null> => {
    try {
      const deadline = Date.now() + 25_000;
      const client = new ConvexHttpClient(env.CONVEX_CLOUD_URL, { logger: false });
      // This SDK client is invocation-local. Its first call captures one timestamp for every source read.
      const parse = async <T>(batch: 'visits' | 'extras', lane: SourceLane, cursor: string | null): Promise<T> =>
        JSON.parse(await client.consistentQuery(api.marketing.profitViews.sourceBatch, { id, key, batch, lane, cursor })) as T;
      const extra = await parse<SourceExtras>('extras', 0, null);
      const encoder = new TextEncoder();
      let bytes = encoder.encode(JSON.stringify(extra)).length;
      let historyBytes = 0;
      let pages = 0;
      let cancelled = false;

      async function readLane(lane: SourceLane): Promise<SourcePage[]> {
        let cursor: string | null = null;
        const result: SourcePage[] = [];
        try {
          while (!cancelled && pages < maximumSourcePages && Date.now() < deadline) {
            pages++;
            const page: SourcePage = await parse<SourcePage>('visits', lane, cursor);
            bytes += encoder.encode(JSON.stringify(page.lines)).length;
            historyBytes += encoder.encode(JSON.stringify(page.customers)).length;
            if (bytes > snapshotLimit || historyBytes > maximumHistoryBytes || Date.now() >= deadline) break;
            result.push(page);
            if (page.cursor === null) return result;
            if (page.cursor === cursor) break;
            cursor = page.cursor;
          }
          throw new Error('The source snapshot exceeded the assembly budget.');
        } catch (error) {
          cancelled = true;
          throw error;
        }
      }

      const sources = await Promise.all(sourceLanes.map(readLane));
      const lines = [...extra.fees];
      const customers = new Map<string, CustomerHistory>();
      let excludedCurrency = 0;
      for (const source of sources) {
        for (const page of source) {
          lines.push(...page.lines);
          excludedCurrency += page.excludedCurrency;
          for (const incoming of page.customers) {
            const prior = customers.get(incoming.id);
            if (!prior) customers.set(incoming.id, incoming);
            else {
              prior.lifetime += incoming.lifetime;
              if (incoming.firstDay && (!prior.firstDay || incoming.firstDay < prior.firstDay))
                prior.firstDay = incoming.firstDay;
            }
          }
        }
      }
      const attendees = new Set(lines.flatMap((row) => row.customerId ? [row.customerId] : []));
      await ctx.runMutation(internal.marketing.profitViews.finishSource, {
        id, key, payload: JSON.stringify({
          lines, excludedCurrency, asOf: extra.asOf, expenses: extra.expenses, missingMonths: extra.missingMonths,
          customers: [...customers.values()].filter((attendee) => attendees.has(attendee.id)),
        } satisfies ReportFacts),
      });
      return null;
    } catch {
      // Discard the entire attempt on snapshot transport, permission or source-read failure.
    }
    await ctx.runMutation(internal.marketing.profitViews.finishSource, { id, key, payload: null });
    return null;
  },
});

export const finishSource = internalMutation({
  args: { ...sourceReadArgs, payload: v.union(v.null(), v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, key, payload }) => {
    const view = await ctx.db.get(id);
    if (!view || view.assemblyState !== 'building' || view.expiresAt <= Date.now() ||
      view.assemblyKey !== await sha256(key)) return null;
    // Only the timestamp-pinned job can publish a complete source. Failed jobs expose no partial data.
    const data = payload === null || view.named
      ? payload
      : JSON.stringify(discloseServiceFinanceFacts(JSON.parse(payload) as ReportFacts, false));
    if (data === null || new TextEncoder().encode(data).length > snapshotLimit) {
      await ctx.db.patch(id, { assemblyState: 'failed', assemblyKey: undefined });
    } else {
      await storeSourceView(ctx, id, data);
      await ctx.db.patch(id, { assemblyState: undefined, assemblyKey: undefined });
    }
    return null;
  },
});

export const expireView = internalMutation({
  args: { id: v.id('serviceProfitViews') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const view = await ctx.db.get(id);
    if (!view) return null;
    // Retiring one source also invalidates and queues every active child; each has its own bounded cleanup.
    if (!view.parentViewId) {
      const children = await ctx.db.query('serviceProfitViews')
        .withIndex('by_parent_expiry', (q) => q.eq('parentViewId', id).gt('expiresAt', Date.now()))
        .take(3);
      for (const child of children) await retireView(ctx, child);
    }
    const parts = await ctx.db.query('serviceProfitViewChunks')
      .withIndex('by_view', (q) => q.eq('viewId', id)).take(32);
    for (const part of parts) await ctx.db.delete(part._id);
    if (parts.length === 32)
      await ctx.scheduler.runAfter(0, internal.marketing.profitViews.expireView, { id });
    else await ctx.db.delete(id);
    return null;
  },
});


// Run before rolling back to code that does not understand prepared children and their expiry jobs.
export const drainPreparedViews = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    if (process.env.PROFIT_PREPARATION_PAUSED !== '1')
      throw new ConvexError('Pause profitability preparation before draining snapshots.');
    const child = await ctx.db.query('serviceProfitViews')
      .withIndex('by_parent_scope', (q) => q.gt('parentViewId', undefined)).first() ??
      await ctx.db.query('serviceProfitViews')
        .withIndex('by_assembly_state', (q) => q.gt('assemblyState', undefined)).first();
    if (!child) return true;
    const parts = await ctx.db.query('serviceProfitViewChunks')
      .withIndex('by_view', (q) => q.eq('viewId', child._id)).take(32);
    for (const part of parts) await ctx.db.delete(part._id);
    if (parts.length < 32) await ctx.db.delete(child._id);
    else if (child.expiresAt > Date.now()) await ctx.db.patch(child._id, { expiresAt: Date.now() });
    return false;
  },
});
