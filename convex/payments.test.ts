// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; } }
const modules = import.meta.glob('./**/*.ts');

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('requires the booking token before creating a Stripe session', async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' });
  });
  const { bookingId, accessToken } = await t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2 });
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_test');
  vi.stubEnv('SITE_URL', 'https://example.com');
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('20000');
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/test', expires_at: Math.floor(Date.now() / 1000) + 1800 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(t.action(api.payments.createCheckout, { bookingId, accessToken: 'wrong' })).rejects.toThrow('Booking access denied');
  expect(fetchMock).not.toHaveBeenCalled();
  const result = await t.action(api.payments.createCheckout, { bookingId, accessToken });
  expect(result.url).toBe('https://checkout.stripe.com/pay/test');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.run(async ctx => (await ctx.db.query('availability').collect()).length)).toBe(2);
  expect(await t.action(api.payments.createCheckout, { bookingId, accessToken })).toEqual(result);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await t.run(async ctx => await ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() - 1 }));
  await t.mutation(internal.payments.expireCheckout, { bookingId, sessionId: 'cs_test_123' });
  expect(await t.run(async ctx => (await ctx.db.query('availability').collect()).length)).toBe(0);
  expect(await t.run(async ctx => (await ctx.db.get(bookingId))?.status)).toBe('cancelled');
});
