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
