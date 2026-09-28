import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireAdmin } from './lib/adminAuth';
import { assertSafeIcalUrl, blockedDatesFromIcal } from './lib/ical';
import { todayIso } from './lib/dates';
import type { Doc } from './_generated/dataModel';

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
    return await ctx.db.query('icalSources').withIndex('by_property', q => q.eq('propertyId', args.propertyId)).take(50);
  },
});

export const updateSource = mutation({
  args: { sourceId: v.id('icalSources'), platform: platformValidator, icalUrl: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const source = await ctx.db.get(args.sourceId);
    if (!source) throw new Error('Calendar not found');
    const icalUrl = assertSafeIcalUrl(args.icalUrl);
    await ctx.db.patch(args.sourceId, {
      platform: args.platform,
      icalUrl,
      ...(icalUrl !== source.icalUrl ? { lastSyncedAt: undefined, lastSyncError: undefined } : {}),
    });
    if (args.platform !== source.platform) {
      const rows = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', args.sourceId)).take(500);
      for (const row of rows) await ctx.db.patch(row._id, { source: args.platform });
    }
  },
});

export const removeSource = mutation({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', args.sourceId)).take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(args.sourceId);
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

export const getExport = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.query('properties').withIndex('by_icalExportToken', q => q.eq('icalExportToken', args.token)).unique();
    if (!property) return null;
    const from = todayIso();
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 366 * DAY_MS).toISOString().slice(0, 10);
    const bookings = await ctx.db.query('bookings').withIndex('by_property_checkOut', q => q.eq('propertyId', property._id).gte('checkOut', from)).take(500);
    const blocks = await ctx.db.query('availability').withIndex('by_property_date', q => q.eq('propertyId', property._id).gte('date', from).lt('date', to)).take(500);
    return {
      propertyName: property.name,
      bookings: bookings.filter(b => (b.status === 'confirmed' || b.status === 'completed') && b.checkIn < to).map(b => ({ id: b._id, start: b.checkIn, end: b.checkOut })),
      blocks: blocks.filter(b => b.source === 'manual' && b.status !== 'available').map(b => ({ id: b._id, date: b.date })),
    };
  },
});

export const pageSources = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => await ctx.db.query('icalSources').paginate(args.paginationOpts),
});

export const applySource = internalMutation({
  args: { sourceId: v.id('icalSources'), icalUrl: v.string(), dates: v.array(v.string()) },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.icalUrl !== args.icalUrl) return null;
    const old = await ctx.db.query('availability').withIndex('by_icalSourceId', q => q.eq('icalSourceId', args.sourceId)).take(500);
    const wanted = new Set(args.dates);
    for (const row of old) if (!wanted.has(row.date)) await ctx.db.delete(row._id);
    const existingDates = new Set(old.map(row => row.date));
    let conflicts = 0;
    for (const date of wanted) {
      if (existingDates.has(date)) continue;
      const occupied = await ctx.db.query('availability').withIndex('by_property_date', q => q.eq('propertyId', source.propertyId).eq('date', date)).first();
      if (occupied && occupied.status !== 'available' && occupied.icalSourceId) {
        await ctx.db.insert('availability', { propertyId: source.propertyId, date, status: 'blocked', source: source.platform as 'airbnb' | 'booking_com' | 'agoda', icalSourceId: args.sourceId });
        continue;
      }
      if (occupied && occupied.status !== 'available') { conflicts++; continue; }
      if (occupied) await ctx.db.patch(occupied._id, { status: 'blocked', source: source.platform as 'airbnb' | 'booking_com' | 'agoda', icalSourceId: args.sourceId });
      else await ctx.db.insert('availability', { propertyId: source.propertyId, date, status: 'blocked', source: source.platform as 'airbnb' | 'booking_com' | 'agoda', icalSourceId: args.sourceId });
    }
    await ctx.db.patch(args.sourceId, { lastSyncedAt: Date.now(), lastSyncError: conflicts ? `${conflicts} date(s) overlap another source or booking` : undefined });
    return { blockedNights: wanted.size, conflicts };
  },
});

export const recordSyncError = internalMutation({
  args: { sourceId: v.id('icalSources'), message: v.string() },
  handler: async (ctx, args) => { if (await ctx.db.get(args.sourceId)) await ctx.db.patch(args.sourceId, { lastSyncError: args.message.slice(0, 200) }); },
});

export const getSource = internalQuery({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args) => await ctx.db.get(args.sourceId),
});

type SyncResult = { ok: true; blockedNights: number; conflicts: number } | { ok: false; error: string };

async function syncSourceFeed(ctx: ActionCtx, source: Doc<'icalSources'>): Promise<SyncResult> {
  try {
    const response = await fetch(assertSafeIcalUrl(source.icalUrl), { redirect: 'error', headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_FEED_BYTES) throw new Error(`Feed returned ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_FEED_BYTES || !text.includes('BEGIN:VCALENDAR')) throw new Error('Invalid or oversized calendar');
    const from = todayIso();
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 366 * DAY_MS).toISOString().slice(0, 10);
    const dates = blockedDatesFromIcal(text, from, to);
    const applied: { blockedNights: number; conflicts: number } | null = await ctx.runMutation(internal.ical.applySource, { sourceId: source._id, icalUrl: source.icalUrl, dates });
    return { ok: true, blockedNights: applied?.blockedNights ?? 0, conflicts: applied?.conflicts ?? 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Calendar sync failed';
    await ctx.runMutation(internal.ical.recordSyncError, { sourceId: source._id, message });
    return { ok: false, error: message };
  }
}

/** Admin "Sync now" for one feed. */
export const syncSource = action({
  args: { sourceId: v.id('icalSources') },
  handler: async (ctx, args): Promise<SyncResult> => {
    await requireAdmin(ctx);
    const source: Doc<'icalSources'> | null = await ctx.runQuery(internal.ical.getSource, args);
    if (!source) throw new Error('Calendar not found');
    return await syncSourceFeed(ctx, source);
  },
});

export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    do {
      const page: { page: Doc<'icalSources'>[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.ical.pageSources, { paginationOpts: { numItems: 20, cursor } });
      for (const source of page.page) await syncSourceFeed(ctx, source);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
  },
});
