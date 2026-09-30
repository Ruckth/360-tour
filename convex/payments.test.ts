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

it('lets host-confirmed unpaid bookings pay online with an attempt idempotency key', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  await t.run(async ctx => {
    await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' });
  });
  const bookingId = await admin.mutation(api.adminBookings.createBooking, { propertySlug: 'villa', guestName: 'Guest', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2, confirmed: true });
  // Older than the 24h guest expiry: admin bookings stay payable.
  await t.run(async ctx => await ctx.db.patch(bookingId, { createdAt: Date.now() - 2 * 86_400_000 }));
  const accessToken = (await t.run(async ctx => await ctx.db.get(bookingId)))!.accessToken!;
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_test');
  vi.stubEnv('SITE_URL', 'https://example.com');
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(`booking-${bookingId}-1`);
    return new Response(JSON.stringify({ id: 'cs_test_admin', url: 'https://checkout.stripe.com/pay/admin', expires_at: Math.floor(Date.now() / 1000) + 1800 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  expect((await t.action(api.payments.createCheckout, { bookingId, accessToken })).url).toBe('https://checkout.stripe.com/pay/admin');
  const amountTotal = 20000;
  await t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_test_admin', amountTotal, currency: 'thb', paymentIntentId: 'pi_admin' });
  expect(await t.run(async ctx => await ctx.db.get(bookingId))).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 200 });
});

it.each([false, true])('renews an expired checkout for a %s admin booking without changing its quote', async (confirmed) => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_test');
  vi.stubEnv('SITE_URL', 'https://example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  await t.run(async ctx => {
    await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' });
  });
  const bookingId = await admin.mutation(api.adminBookings.createBooking, { propertySlug: 'villa', guestName: 'Guest', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2, confirmed });
  const accessToken = (await t.run(ctx => ctx.db.get(bookingId)))!.accessToken!;
  const requests: Array<{ key: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    requests.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key'], body: String(init?.body) });
    const n = requests.length;
    return new Response(JSON.stringify({ id: `cs_${n}`, url: `https://checkout.stripe.com/${n}`, expires_at: Math.floor(Date.now() / 1000) + 1800 }), { status: 200 });
  }));
  expect((await t.action(api.payments.createCheckout, { bookingId, accessToken })).url).toContain('/1');
  await t.run(ctx => ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() - 1 }));
  await t.mutation(internal.payments.expireCheckout, { bookingId, sessionId: 'cs_1' });
  expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({ status: confirmed ? 'confirmed' : 'pending', paymentStatus: 'pending' });
  expect((await t.action(api.payments.createCheckout, { bookingId, accessToken })).url).toContain('/2');
  expect(requests.map(r => r.key)).toEqual([`booking-${bookingId}-1`, `booking-${bookingId}-2`]);
  expect(new URLSearchParams(requests[0].body).get('line_items[0][price_data][unit_amount]')).toBe('20000');
  expect(new URLSearchParams(requests[1].body).get('line_items[0][price_data][unit_amount]')).toBe('20000');
});

it('refuses to attach a Stripe session after the quote or attempt changes', async () => {
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  const { bookingId, accessToken } = await t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2 });
  const { request } = await t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
  if (!request) throw new Error('Expected checkout request');
  const save = () => t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken, sessionId: 'cs_old', url: 'https://checkout.stripe.com/old', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
  await t.run(ctx => ctx.db.patch(bookingId, { total: 250 }));
  await expect(save()).rejects.toThrow('Booking changed during checkout');
  await t.run(ctx => ctx.db.patch(bookingId, { total: request.total, checkoutRequest: undefined }));
  await t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
  await expect(save()).rejects.toThrow('Booking changed during checkout');
  expect((await t.run(ctx => ctx.db.get(bookingId)))?.stripeCheckoutSessionId).toBeUndefined();
});

it('retries one unfinished attempt with the same Stripe key and request body', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_test');
  vi.stubEnv('SITE_URL', 'https://example.com');
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  const { bookingId, accessToken } = await t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2 });
  const calls: Array<{ key: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ key: (init?.headers as Record<string, string>)['Idempotency-Key'], body: String(init?.body) });
    if (calls.length === 1) throw new Error('Connection lost');
    return new Response(JSON.stringify({ id: 'cs_retry', url: 'https://checkout.stripe.com/retry', expires_at: Math.floor(Date.now() / 1000) + 1800 }), { status: 200 });
  }));
  await expect(t.action(api.payments.createCheckout, { bookingId, accessToken })).rejects.toThrow('Connection lost');
  expect((await t.action(api.payments.createCheckout, { bookingId, accessToken })).url).toContain('/retry');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});
