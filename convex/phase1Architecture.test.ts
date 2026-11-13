// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { createHarness } from './testing/harness';
import { percentageOf, roundRatio, bahtToSatang } from './shared/money';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('seeds the demo-resort scenario from empty', async () => {
  const t = createHarness(convexTest);
  const empty = await t.mutation(internal.seed.seedAll, { scenario: 'empty' });
  expect(Object.values(empty.counts).every(count => count === 0)).toBe(true);
  const demo = await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  expect(demo.counts).toMatchObject({ properties: 3, tourScenes: 5, reviews: 7, reviewStats: 3, staff: 5, services: 6, appointments: 4, bookings: 2, bookingPayments: 1, orders: 3, orderLines: 1, conversations: 1, messages: 1, siteSettings: 1, cashierRules: 1, businessFacts: 1 });
  const stay = await t.run(ctx => ctx.db.get(demo.bookings[0].bookingId));
  expect(stay).toMatchObject({ amountPaid: 1445000, amountRefunded: 0, paymentStatus: 'paid', guestEmailsOff: true });
  expect(await t.query(api.messaging.chat.getMessages, { ...demo.conversation! })).toMatchObject([{ role: 'user' }]);
  await expect(t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' })).rejects.toThrow('empty database');
  const busy = await createHarness(convexTest).mutation(internal.seed.seedAll, { scenario: 'busy-weekend' });
  expect(busy.counts.bookings).toBe(6);
  expect(busy.counts.availability).toBe(12);
});

it('charges Stripe the stored satang amount', async () => {
  const t = createHarness(convexTest);
  const seed = await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  const stay = seed.bookings[1];
  const booking = (await t.run(ctx => ctx.db.get(stay.bookingId)))!;
  vi.stubEnv('STRIPE_SECRET_KEY', 'test-only'); vi.stubEnv('SITE_URL', 'https://example.test');
  const call = vi.fn(async (_url: string, init?: RequestInit) => {
    const form = init!.body as URLSearchParams;
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe(String(booking.total));
    expect(booking.total).toBe(765000);
    return new Response(JSON.stringify({ id: 'cs_satang', url: 'https://checkout.stripe.com/satang', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  });
  vi.stubGlobal('fetch', call);
  await t.action(api.bookings.payments.stripe.createCheckout, stay);
  expect(call).toHaveBeenCalledTimes(1);
  const args = { bookingId: stay.bookingId, sessionId: 'cs_satang', amountTotal: booking.total, currency: 'thb', paymentIntentId: 'pi_satang' };
  await t.mutation(internal.bookings.payments.stripe.completeCheckout, args);
  await t.mutation(internal.bookings.payments.stripe.completeCheckout, args);
  expect(await t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', stay.bookingId)).take(10))).toMatchObject([{ amount: booking.total }]);
});

it('acknowledges Stripe events for deleted bookings', async () => {
  const t = createHarness(convexTest);
  const demo = await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  const bookingId = demo.bookings[1].bookingId;
  await t.run(ctx => ctx.db.delete(bookingId));
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_only');
  vi.stubEnv('ARCH_MONEY_CUTOVER_AT', String(Date.now()));
  const created = Math.floor(Date.now() / 1000) - 1;
  const event = { id: 'evt_deleted', created, type: 'checkout.session.completed', data: { object: { id: 'cs_deleted', client_reference_id: bookingId, payment_status: 'paid', amount_total: 765000, currency: 'thb', payment_intent: 'pi_deleted' } } };
  async function deliver(body: unknown) {
    const payload = JSON.stringify(body), encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode('whsec_test_only'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${created}.${payload}`))), b => b.toString(16).padStart(2, '0')).join('');
    return t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${created},v1=${signature}` } });
  }
  expect((await deliver(event)).status).toBe(200);
  expect((await deliver(event)).status).toBe(200);
  expect((await deliver({ id: 'evt_refund_deleted', created, type: 'charge.refunded', data: { object: { id: 'ch_deleted', payment_intent: 'pi_deleted', amount: 765000, amount_refunded: 100, currency: 'thb' } } })).status).toBe(200);
  const orphans = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', 'stripe_orphan')).take(10));
  expect(orphans).toHaveLength(2);
  expect(orphans.every(row => row.kind === 'orphaned')).toBe(true);
});

it('uses exact signed half rounding and rejects fractional persisted money', () => {
  expect(percentageOf(1005, 1000)).toBe(101);
  expect(roundRatio(-201, 2)).toBe(-101);
  expect(bahtToSatang(1.005)).toBe(101);
  expect(() => percentageOf(1.5, 1000)).toThrow('integer satang');
  expect(() => percentageOf(10000, 10001)).toThrow('basis points');
});

it('deduplicates channel event keys within their channel only', async () => {
  const t = createHarness(convexTest);
  for (const channel of ['line', 'facebook', 'instagram', 'whatsapp'] as const) {
    const args = { channel, events: [{ eventKey: 'same-provider-key', eventType: 'unsupported' as const }] };
    expect(await t.mutation(internal.messaging.ingress.accept, args)).toEqual({ accepted: 1 });
    expect(await t.mutation(internal.messaging.ingress.accept, args)).toEqual({ accepted: 0 });
  }
  const events = await t.run(ctx => ctx.db.query('channelEvents').collect());
  expect(events.map(event => event.channel).sort()).toEqual(['facebook', 'instagram', 'line', 'whatsapp']);
});

async function signedStripeDelivery(t: ReturnType<typeof createHarness>, event: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(event), encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode('whsec_cutover_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } });
}

it('acknowledges pre-cutover malformed and foreign Stripe booking references without losing later completion evidence', async () => {
  const t = createHarness(convexTest);
  await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  const foreign = (await t.run(ctx => ctx.db.query('properties').first()))!._id;
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_cutover_test');
  vi.stubEnv('ARCH_MONEY_CUTOVER_AT', String(Date.now()));
  const created = Math.floor(Date.now() / 1000) - 1;
  for (const [i, bookingId] of ['not-a-convex-id', foreign].entries()) {
    // An expiry and a captured payment can refer to the same session; both must survive deduplication.
    for (const type of ['checkout.session.expired', 'checkout.session.completed']) {
      const event = { id: `evt_${i}_${type}`, created, type, data: { object: { id: `cs_invalid_${i}`, client_reference_id: bookingId, payment_status: 'paid', amount_total: 10050, currency: 'thb', payment_intent: `pi_invalid_${i}` } } };
      expect((await signedStripeDelivery(t, event)).status).toBe(200);
      expect((await signedStripeDelivery(t, event)).status).toBe(200);
    }
  }
  const orphans = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', 'stripe_orphan')).take(10));
  expect(orphans).toHaveLength(4);
  expect(orphans.filter(row => row.after?.type === 'checkout')).toHaveLength(2);
});

it('keeps post-cutover orphaned money visible as failed Stripe deliveries for reconciliation', async () => {
  const t = createHarness(convexTest);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_cutover_test');
  vi.stubEnv('ARCH_MONEY_CUTOVER_AT', String(Date.now() - 60_000));
  const event = { id: 'evt_late_payment', created: Math.floor(Date.now() / 1000), type: 'checkout.session.completed', data: { object: { id: 'cs_late_payment', client_reference_id: 'missing-after-reset', payment_status: 'paid', amount_total: 10050, currency: 'thb', payment_intent: 'pi_late_payment' } } };
  expect((await signedStripeDelivery(t, event)).status).toBe(500);
  expect((await signedStripeDelivery(t, event)).status).toBe(500);
  const orphans = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', 'stripe_orphan')).take(10));
  expect(orphans).toHaveLength(1);
  expect(orphans[0].after).toMatchObject({ type: 'checkout', amount: 10050, currency: 'thb', paymentIntentId: 'pi_late_payment' });
});
