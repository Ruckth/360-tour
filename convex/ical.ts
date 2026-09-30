import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireAdmin } from './lib/adminAuth';
import { assertSafeIcalUrl, blockedDatesFromIcal } from './lib/ical';
import { todayIso } from './lib/dates';
import type { Doc, Id } from './_generated/dataModel';
import { assertValidIsoDate } from './lib/validation';
import { readBudget } from './lib/readBudget';
import { nightRows } from './lib/stayOverlap';

const DAY_MS = 86_400_000;
const MAX_FEED_BYTES = 1_000_000;
const platformValidator = v.union(v.literal('airbnb'), v.literal('booking_com'), v.literal('agoda'));

export const addSource = mutation({
  args: { propertyId: v.id('properties'), platform: platformValidator, icalUrl: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!await ctx.db.get(args.propertyId)) throw new Error('Property not found');
    return await ctx.db.insert('icalSources', { ...args, icalUrl: assertSafeIcalUrl(args.icalUrl) });
  },
});

export const listSources = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sources = await ctx.db.query('icalSources').withIndex('by_property', q => q.eq('propertyId', args.propertyId)).take(50);
    return sources.filter(source => !source.deletingAt);
  },
});

/** Rows handled per transaction when relabelling, pruning or deleting one feed's nights. */
const SOURCE_ROW_BATCH = 200;
/** A sync covers today plus 366 days; anything much larger is not a real feed. */
const MAX_FEED_NIGHTS = 400;
type OtaPlatform = 'airbnb' | 'booking_com' | 'agoda';

async function liveSource(ctx: MutationCtx, sourceId: Id<'icalSources'>) {
  const source = await ctx.db.get(sourceId);
  return source && !source.deletingAt ? source : null;
}

/** Relabels one page of a feed's nights; schedules the next page until done. */
async function relabelSourceRows(ctx: MutationCtx, sourceId: Id<'icalSources'>, platform: OtaPlatform, cursor: string | null) {
  const page = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', sourceId)).paginate({ numItems: SOURCE_ROW_BATCH, cursor });
  for (const row of page.page) if (row.source !== platform) await ctx.db.patch(row._id, { source: platform });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.ical.continueRelabelSource, { sourceId, platform, cursor: page.continueCursor });
}

export const continueRelabelSource = internalMutation({
  args: { sourceId: v.id('icalSources'), platform: platformValidator, cursor: v.string() },
  handler: async (ctx, args) => {
    // A newer platform change schedules its own relabel.
    if ((await liveSource(ctx, args.sourceId))?.platform !== args.platform) return null;
    await relabelSourceRows(ctx, args.sourceId, args.platform, args.cursor);
    return null;
  },
});

export const updateSource = mutation({
  args: { sourceId: v.id('icalSources'), platform: platformValidator, icalUrl: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const source = await liveSource(ctx, args.sourceId);
    if (!source) throw new Error('Calendar not found');
    const icalUrl = assertSafeIcalUrl(args.icalUrl);
    await ctx.db.patch(args.sourceId, {
      platform: args.platform,
      icalUrl,
      // A new URL invalidates any sync already fetching (ticket) and any prune still running (generation).
      ...(icalUrl !== source.icalUrl
        ? {
            lastSyncedAt: undefined,
            lastSyncError: undefined,
            syncTicket: (source.syncTicket ?? 0) + 1,
            syncGeneration: (source.syncGeneration ?? 0) + 1,
          }
        : {}),
    });
    if (args.platform !== source.platform) await relabelSourceRows(ctx, args.sourceId, args.platform, null);
  },
});

/** Deletes one batch of a removed feed's nights; the feed row goes once none are left. */
async function purgeSourceBatch(ctx: MutationCtx, sourceId: Id<'icalSources'>) {
  const rows = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', sourceId)).take(SOURCE_ROW_BATCH);
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length === SOURCE_ROW_BATCH) await ctx.scheduler.runAfter(0, internal.ical.continueRemoveSource, { sourceId });
  else await ctx.db.delete(sourceId);
}

export const continueRemoveSource = internalMutation({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (source?.deletingAt) await purgeSourceBatch(ctx, args.sourceId);
    return null;
  },
});

/** Hides the feed at once (syncs skip it), then removes its nights in batches and finally the feed. */
export const removeSource = mutation({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const source = await ctx.db.get(args.sourceId);
    if (!source) return;
    if (!source.deletingAt) await ctx.db.patch(args.sourceId, { deletingAt: Date.now(), syncTicket: (source.syncTicket ?? 0) + 1 });
    await purgeSourceBatch(ctx, args.sourceId);
  },
});

export const rotateExportToken = mutation({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!await ctx.db.get(args.propertyId)) throw new Error('Property not found');
    const token = crypto.randomUUID();
    await ctx.db.patch(args.propertyId, { icalExportToken: token });
    return token;
  },
});

export const getExportToken = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return (await ctx.db.get(args.propertyId))?.icalExportToken ?? null;
  },
});

/** Bookings and host blocks a year ahead; refuses (throws) rather than export a partial calendar. */
const EXPORT_ROW_LIMIT = 5000;

export const getExport = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.query('properties').withIndex('by_icalExportToken', q => q.eq('icalExportToken', args.token)).unique();
    if (!property) return null;
    const from = todayIso();
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 366 * DAY_MS).toISOString().slice(0, 10);
    const bookings: Array<{ id: Id<'bookings'>; start: string; end: string }> = [];
    const blocks: Array<{ id: Id<'availability'>; date: string }> = [];
    const budget = readBudget(ctx);
    let read = 0;
    const count = (doc: unknown) => {
      if (++read > EXPORT_ROW_LIMIT || !budget.document(doc)) throw new Error('Too many records to export this calendar');
    };
    for await (const b of ctx.db.query('bookings').withIndex('by_property_checkOut', q => q.eq('propertyId', property._id).gte('checkOut', from))) {
      count(b);
      if ((b.status === 'confirmed' || b.status === 'completed') && b.checkIn < to) bookings.push({ id: b._id, start: b.checkIn, end: b.checkOut });
    }
    for await (const b of ctx.db.query('availability').withIndex('by_property_date', q => q.eq('propertyId', property._id).gte('date', from).lt('date', to))) {
      count(b);
      if (b.source === 'manual' && b.status !== 'available') blocks.push({ id: b._id, date: b.date });
    }
    return { propertyName: property.name, bookings, blocks };
  },
});

export const pageSources = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => await ctx.db.query('icalSources').paginate(args.paginationOpts),
});

/** Deletes one page of a feed's rows for nights no longer in its feed; schedules the next page. */
async function pruneSourceRows(ctx: MutationCtx, sourceId: Id<'icalSources'>, generation: number, dates: string[], cursor: string | null) {
  const wanted = new Set(dates);
  const page = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', sourceId)).paginate({ numItems: SOURCE_ROW_BATCH, cursor });
  for (const row of page.page) if (!wanted.has(row.date)) await ctx.db.delete(row._id);
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.ical.continuePruneSource, { sourceId, generation, dates, cursor: page.continueCursor });
}

export const continuePruneSource = internalMutation({
  args: { sourceId: v.id('icalSources'), generation: v.number(), dates: v.array(v.string()), cursor: v.string() },
  handler: async (ctx, args) => {
    // A newer sync, a URL change or a removal supersedes this prune.
    const source = await liveSource(ctx, args.sourceId);
    if (!source || source.syncGeneration !== args.generation) return null;
    await pruneSourceRows(ctx, args.sourceId, args.generation, args.dates, args.cursor);
    return null;
  },
});

/**
 * Starts one sync: allocates a ticket before the feed is fetched. Only the newest ticket may
 * apply its result or record its error; a newer sync, a URL change or a removal invalidates it,
 * so a slow fetch of an old URL (even one changed back since) can never write.
 */
export const beginSync = internalMutation({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args) => {
    const source = await liveSource(ctx, args.sourceId);
    if (!source) return null;
    const ticket = (source.syncTicket ?? 0) + 1;
    await ctx.db.patch(args.sourceId, { syncTicket: ticket });
    return { ticket, icalUrl: source.icalUrl };
  },
});

async function sourceForTicket(ctx: MutationCtx, sourceId: Id<'icalSources'>, ticket: number) {
  const source = await liveSource(ctx, sourceId);
  return source && source.syncTicket === ticket ? source : null;
}

export const applySource = internalMutation({
  args: { sourceId: v.id('icalSources'), ticket: v.number(), dates: v.array(v.string()) },
  handler: async (ctx, args) => {
    const source = await sourceForTicket(ctx, args.sourceId, args.ticket);
    if (!source) return null;
    const wanted = [...new Set(args.dates)].sort();
    if (wanted.length > MAX_FEED_NIGHTS) throw new Error(`A calendar feed can block at most ${MAX_FEED_NIGHTS} nights`);
    for (const date of wanted) assertValidIsoDate(date, 'Feed date');
    const platform = source.platform as OtaPlatform;
    let conflicts = 0;
    for (const date of wanted) {
      // A night can have several rows: other feeds, a host block, a booking.
      let own = false;
      let taken = false;
      let free: Doc<'availability'> | null = null;
      for (const row of await nightRows(ctx, source.propertyId, date)) {
        if (row.icalSourceId === args.sourceId) own = true;
        else if (row.status === 'available') free ??= row;
        else if (!row.icalSourceId) taken = true;
      }
      if (own) continue;
      if (taken) { conflicts++; continue; }
      if (free) await ctx.db.patch(free._id, { status: 'blocked', source: platform, icalSourceId: args.sourceId });
      else await ctx.db.insert('availability', { propertyId: source.propertyId, date, status: 'blocked', source: platform, icalSourceId: args.sourceId });
    }
    const generation = (source.syncGeneration ?? 0) + 1;
    await ctx.db.patch(args.sourceId, { lastSyncedAt: Date.now(), lastSyncError: conflicts ? `${conflicts} date(s) overlap another source or booking` : undefined, syncGeneration: generation });
    await pruneSourceRows(ctx, args.sourceId, generation, wanted, null);
    return { blockedNights: wanted.length, conflicts };
  },
});

/** Records a failed sync, unless a newer sync, URL change or removal has superseded it. */
export const recordSyncError = internalMutation({
  args: { sourceId: v.id('icalSources'), ticket: v.number(), message: v.string() },
  handler: async (ctx, args) => {
    if (await sourceForTicket(ctx, args.sourceId, args.ticket)) {
      await ctx.db.patch(args.sourceId, { lastSyncError: args.message.slice(0, 200) });
    }
  },
});

type SyncResult = { ok: true; blockedNights: number; conflicts: number } | { ok: false; error: string };

const SUPERSEDED_ERROR = 'This calendar changed while syncing. Sync it again.';

async function syncSourceFeed(ctx: ActionCtx, sourceId: Id<'icalSources'>): Promise<SyncResult> {
  const started: { ticket: number; icalUrl: string } | null = await ctx.runMutation(internal.ical.beginSync, { sourceId });
  if (!started) return { ok: false, error: 'Calendar not found' };
  try {
    const response = await fetch(assertSafeIcalUrl(started.icalUrl), { redirect: 'error', headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_FEED_BYTES) throw new Error(`Feed returned ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_FEED_BYTES || !text.includes('BEGIN:VCALENDAR')) throw new Error('Invalid or oversized calendar');
    const from = todayIso();
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 366 * DAY_MS).toISOString().slice(0, 10);
    const dates = blockedDatesFromIcal(text, from, to);
    const applied: { blockedNights: number; conflicts: number } | null = await ctx.runMutation(internal.ical.applySource, { sourceId, ticket: started.ticket, dates });
    if (!applied) return { ok: false, error: SUPERSEDED_ERROR };
    return { ok: true, blockedNights: applied.blockedNights, conflicts: applied.conflicts };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Calendar sync failed';
    await ctx.runMutation(internal.ical.recordSyncError, { sourceId, ticket: started.ticket, message });
    return { ok: false, error: message };
  }
}

/** Admin "Sync now" for one feed. */
export const syncSource = action({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args): Promise<SyncResult> => {
    await requireAdmin(ctx);
    const result = await syncSourceFeed(ctx, args.sourceId);
    if (!result.ok && result.error === 'Calendar not found') throw new Error('Calendar not found');
    return result;
  },
});

export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    do {
      const page: { page: Doc<'icalSources'>[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.ical.pageSources, { paginationOpts: { numItems: 20, cursor } });
      for (const source of page.page) if (!source.deletingAt) await syncSourceFeed(ctx, source._id);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
  },
});
