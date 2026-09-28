// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; } }
const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it('keeps OTA sources separate and preserves other blocked dates when one is removed', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(async ctx => await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  const airbnb = await admin.mutation(api.ical.addSource, { propertyId, platform: 'airbnb', icalUrl: 'https://example.com/airbnb.ics' });
  const booking = await admin.mutation(api.ical.addSource, { propertyId, platform: 'booking_com', icalUrl: 'https://example.com/booking.ics' });
  await t.mutation(internal.ical.applySource, { sourceId: airbnb, dates: ['2030-01-01', '2030-01-02'] });
  await t.mutation(internal.ical.applySource, { sourceId: booking, dates: ['2030-01-02', '2030-01-03'] });
  expect(await t.query(api.availability.getBlockedDates, { propertyId, startDate: '2030-01-01', endDate: '2030-01-03' })).toContain('2030-01-02');
  await admin.mutation(api.ical.removeSource, { sourceId: airbnb });
  const remaining = await t.run(async ctx => await ctx.db.query('availability').collect());
  expect(remaining.map(row => row.date).sort()).toEqual(['2030-01-02', '2030-01-03']);
  expect(remaining.every(row => row.icalSourceId === booking)).toBe(true);
});

it('exports future bookings even when more than 500 past bookings exist', async () => {
  const t = convexTest(schema, modules);
  const futureCheckIn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const futureCheckOut = new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
  const { futureId } = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active', icalExportToken: 'export-token' });
    const base = { propertyId, guestName: 'Guest', guestPhone: '123', guests: 2, nights: 2, subtotal: 200, discountAmount: 0, total: 200, currency: 'THB', paymentStatus: 'paid' as const, status: 'confirmed' as const, createdAt: Date.now() };
    for (let i = 0; i < 501; i++) await ctx.db.insert('bookings', { ...base, checkIn: '2020-01-01', checkOut: '2020-01-03' });
    const futureId = await ctx.db.insert('bookings', { ...base, checkIn: futureCheckIn, checkOut: futureCheckOut });
    return { futureId };
  });
  const exported = await t.query(internal.ical.getExport, { token: 'export-token' });
  expect(exported?.bookings).toEqual([{ id: futureId, start: futureCheckIn, end: futureCheckOut }]);
});

async function sourceSetup() {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(async ctx => await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  const sourceId = await admin.mutation(api.ical.addSource, { propertyId, platform: 'airbnb', icalUrl: 'https://example.com/airbnb.ics' });
  return { t, admin, sourceId };
}

it('edits a source and relabels its imported nights', async () => {
  const { t, admin, sourceId } = await sourceSetup();
  await t.mutation(internal.ical.applySource, { sourceId, dates: ['2030-01-01'] });
  await admin.mutation(api.ical.updateSource, { sourceId, platform: 'agoda', icalUrl: 'https://example.com/agoda.ics' });
  const source = await t.run(async ctx => await ctx.db.get(sourceId));
  expect(source).toMatchObject({ platform: 'agoda', icalUrl: 'https://example.com/agoda.ics' });
  expect(source?.lastSyncedAt).toBeUndefined();
  expect((await t.run(async ctx => await ctx.db.query('availability').collect())).map(row => row.source)).toEqual(['agoda']);
  await expect(admin.mutation(api.ical.updateSource, { sourceId, platform: 'agoda', icalUrl: 'http://127.0.0.1/x.ics' })).rejects.toThrow();
  await expect(t.mutation(api.ical.updateSource, { sourceId, platform: 'airbnb', icalUrl: 'https://example.com/a.ics' })).rejects.toThrow();
});

it('syncs one source on demand and reports the result', async () => {
  const { t, admin, sourceId } = await sourceSetup();
  const start = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  const end = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  const feed = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(feed, { status: 200 })));
  expect(await admin.action(api.ical.syncSource, { sourceId })).toEqual({ ok: true, blockedNights: 2, conflicts: 0 });
  expect(await t.run(async ctx => (await ctx.db.query('availability').collect()).length)).toBe(2);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
  expect(await admin.action(api.ical.syncSource, { sourceId })).toEqual({ ok: false, error: 'Feed returned 500' });
  expect((await t.run(async ctx => await ctx.db.get(sourceId)))?.lastSyncError).toBe('Feed returned 500');
  await expect(t.action(api.ical.syncSource, { sourceId })).rejects.toThrow();
  vi.unstubAllGlobals();
});
