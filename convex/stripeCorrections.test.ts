// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { stayPaymentReversalPatch } from './lib/stayCorrections';
const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 1, 5);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup(deposit = 0) {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  const { bookingId, accessToken } = await t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), checkOut: new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10), guests: 2 });
  if (deposit) await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: deposit, paymentStatus: 'paid' }));
  const begin = () => t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
  const start = async () => {
    const { request } = await begin();
    if (!request) throw new Error('No request');
    await t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken, sessionId: 'cs_checkout', url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
    return request;
  };
  const complete = (amountTotal = (200 - deposit) * 100) => t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_checkout', paymentIntentId: 'pi_checkout', amountTotal, currency: 'thb' });
  const read = () => t.run(ctx => ctx.db.get(bookingId));
  const refund = (amountRefunded: number, eventId = `evt_${amountRefunded}`) => t.mutation(internal.payments.recordRefund, { paymentIntentId: 'pi_checkout', chargeId: 'ch_checkout', eventId, eventCreated: now / 1000 - 60, currency: 'thb', amount: (200 - deposit) * 100, amountRefunded, refunds: [] });
  return { t, admin, bookingId, accessToken, begin, start, complete, read, refund };
}
it.each([0,50,150])('charges and records only actual remaining provider money with prior deposit %s, with safe replay', async deposit => {
  const { t, start, complete, read, bookingId } = await setup(deposit);
  expect((await start()).total).toBe(200 - deposit);
  await expect(complete(20001)).rejects.toThrow('amount mismatch');
  await complete();
  const revision = (await read())!.revision;
  await complete();
  expect((await read())!.revision).toBe(revision);
  expect(await read()).toMatchObject({ amountPaid: 200, paymentStatus: 'paid', status: 'confirmed' });
  const payments = await t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).take(10));
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ amount: 200 - deposit, providerPaymentIntentId: 'pi_checkout' });
});
it('keeps provider refunds waived and charges only a later stay extension at POS with a real deposit', async () => {
  const { t, admin, bookingId, start, complete, refund, read } = await setup(50);
  await start(); await complete(); await refund(10000);
  expect((await admin.query(api.pos.ordersForBooking, { bookingId }))!.balance).toMatchObject({ total: 200, paid: 100, refunded: 100, owed: 0 });
  await t.run(ctx => ctx.db.patch(bookingId, { total: 250 }));
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
  const view = (await admin.query(api.pos.getOrder, { orderId }))!;
  expect(view.totals).toMatchObject({ total: 150, deposit: 100, due: 50 });
  await admin.mutation(api.pos.settleOrder, { orderId, idempotencyKey: 'extension-after-refund', expectedRevision: view.order.revision!, expectedDue: 50, tenders: [{ method: 'cash', amount: 50 }] });
  expect(await read()).toMatchObject({ amountPaid: 250, amountRefunded: 100, providerRefundWaived: 100 });
  expect((await admin.query(api.pos.ordersForBooking, { bookingId }))!.balance).toMatchObject({ paid: 150, refunded: 100, owed: 0 });
});

it('rejects stale saved balance, changed completion balance, bad currency/nonfinite amounts and a superseded session', async () => {
  const { t, bookingId, start, complete, read } = await setup(50);
  await start();
  await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 75 }));
  await expect(complete()).rejects.toThrow('amount mismatch');
  await expect(t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_old', paymentIntentId: 'pi_old', amountTotal: 15000, currency: 'thb' })).rejects.toThrow('session mismatch');
  await expect(t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_checkout', paymentIntentId: 'pi_checkout', amountTotal: NaN, currency: 'thb' })).rejects.toThrow('amount mismatch');
  await expect(t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_checkout', paymentIntentId: 'pi_checkout', amountTotal: 12500, currency: 'usd' })).rejects.toThrow('amount mismatch');
  expect((await read())!.amountPaid).toBe(75);
});
it('handles partial/full cumulative refunds and duplicate/out-of-order events atomically without cancelling the real stay', async () => {
  const { t, bookingId, start, complete, refund, read } = await setup();
  await start(); await complete();
  await refund(5000);
  expect(await read()).toMatchObject({ amountPaid: 200, amountRefunded: 50, providerRefundWaived: 50, status: 'confirmed', paymentStatus: 'paid' });
  const revision = (await read())!.revision;
  await refund(5000, 'evt_duplicate'); await refund(2500, 'evt_old');
  expect((await read())!.revision).toBe(revision);
  await refund(20000);
  // A live stay keeps an ordinary money state after a full provider refund (nothing held: pending),
  // so it stays editable and chargeable; only a cancelled stay becomes `refunded`.
  expect(await read()).toMatchObject({ amountPaid: 200, amountRefunded: 200, providerRefundWaived: 200, paymentStatus: 'pending', status: 'confirmed' });
  expect((await read())!.refundedAt).toBeUndefined();
  const rows = await t.run(ctx => ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).take(10));
  expect(rows.map(r => r.amount)).toEqual([50,150]);
  expect(rows[0]).toMatchObject({ providerEventId: 'evt_5000', providerChargeId: 'ch_checkout', recordedBy: 'system:stripe', recordedAt: now });
  const history = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'booking').eq('entityId', bookingId)).take(20));
  expect(history.filter(r => r.kind === 'provider_refund')).toHaveLength(2);
  expect(JSON.stringify(history)).not.toContain((await read())!.accessToken);
});
it.each([NaN,Infinity,-1,20001,1.2])('rejects invalid provider refund minor units %s atomically', async amount => {
  const { t, start, complete, refund, read } = await setup(); await start(); await complete();
  const before = await read(); await expect(refund(amount)).rejects.toThrow();
  expect(await read()).toEqual(before);
  expect(await t.run(ctx => ctx.db.query('bookingRefunds').take(10))).toHaveLength(0);
});
it('requires explicit provider evidence for manual Stripe refunds and reconciles those once', async () => {
  const { t, admin, bookingId, start, complete, refund, read } = await setup(); await start(); await complete();
  await t.run(ctx => ctx.db.patch(bookingId, { status: 'cancelled' }));
  const revision = (await read())!.revision!;
  const { refundId } = await admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: revision, amount: 50, currency: 'THB', method: 'stripe', reason: 'Refunded in dashboard', idempotencyKey: 'manual-stripe-refund' });
  await expect(refund(5000)).rejects.toThrow('Link manually recorded');
  expect((await read())!.amountRefunded).toBe(50);
  const link = { bookingId, refundId, expectedRevision: (await read())!.revision!, chargeId: 'ch_checkout', providerRefundId: 're_actual' };
  await expect(t.mutation(api.payments.linkRecordedStripeRefund, link)).rejects.toThrow('authenticated');
  await expect(admin.mutation(api.payments.linkRecordedStripeRefund, { ...link, expectedRevision: revision })).rejects.toThrow('changed');
  await admin.mutation(api.payments.linkRecordedStripeRefund, link);
  // A lost response can retry the same evidence with its original reviewed revision.
  const afterLink = await t.run(ctx => ctx.db.get(bookingId));
  await admin.mutation(api.payments.linkRecordedStripeRefund, link);
  expect((await t.run(ctx => ctx.db.get(bookingId)))?.revision).toBe(afterLink?.revision);
  await expect(refund(5000)).rejects.toThrow('lacks the linked');
  await expect(t.mutation(internal.payments.recordRefund, { paymentIntentId: 'pi_checkout', chargeId: 'ch_checkout', eventId: 'evt_wrong_evidence', eventCreated: now / 1000, currency: 'thb', amount: 20000, amountRefunded: 5000, refunds: [{ id: 're_actual', amount: 2500, currency: 'thb', status: 'succeeded' }] })).rejects.toThrow('differs from actual');
  await t.mutation(internal.payments.recordRefund, { paymentIntentId: 'pi_checkout', chargeId: 'ch_checkout', eventId: 'evt_actual', eventCreated: now / 1000, currency: 'thb', amount: 20000, amountRefunded: 5000, refunds: [{ id: 're_actual', amount: 5000, currency: 'thb', status: 'succeeded' }] });
  expect((await read())!.amountRefunded).toBe(50);
  await refund(10000);
  expect((await read())!.amountRefunded).toBe(100);
  expect(await t.run(ctx => ctx.db.query('bookingRefunds').take(10))).toHaveLength(2);
});
it('expires checkout and pending bookings with revision/history, protecting live holds and retaining confirmed occupancy', async () => {
  const { t, bookingId, start, read } = await setup(); const request = await start();
  vi.setSystemTime(request.expiresAt + 1);
  const revision = (await read())!.revision ?? 0;
  await t.mutation(internal.payments.expireCheckout, { bookingId, sessionId: 'cs_old' });
  expect((await read())!.revision ?? 0).toBe(revision);
  await t.mutation(internal.payments.expireCheckout, { bookingId, sessionId: 'cs_checkout' });
  expect(await read()).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', revision: revision + 1 });
  const history = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'booking').eq('entityId', bookingId)).take(20));
  expect(history.some(r => r.kind === 'checkout_expired')).toBe(true);
});
it('accepts an actual signed charge.refunded snapshot through the HTTP handler', async () => {
  const { t, start, complete, read } = await setup(); await start(); await complete();
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'local-test-secret');
  const body = JSON.stringify({ id: 'evt_http', created: now / 1000, type: 'charge.refunded', data: { object: { id: 'ch_checkout', object: 'charge', payment_intent: 'pi_checkout', amount: 20000, amount_refunded: 5000, currency: 'thb', refunds: { data: [{ id: 're_http', amount: 5000, currency: 'thb', status: 'succeeded' }] } } } });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode('local-test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${now / 1000}.${body}`)))).map(n => n.toString(16).padStart(2, '0')).join('');
  const response = await t.fetch('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${now / 1000},v1=${signature}` }, body });
  expect(response.status).toBe(200);
  expect((await read())!.amountRefunded).toBe(50);
  expect((await t.fetch('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${now / 1000},v1=${signature}` }, body })).status).toBe(200);
  expect((await read())!.amountRefunded).toBe(50);
});
it('preserves a non-provider deposit after a full provider refund and refuses later hand-entered duplicate Stripe refunds', async () => {
  const { admin, bookingId, start, complete, refund, read } = await setup(50);
  await start(); await complete(); await refund(15000);
  expect(await read()).toMatchObject({ amountPaid: 200, amountRefunded: 150, providerRefundWaived: 150, paymentStatus: 'paid', status: 'confirmed' });
  await expect(admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: (await read())!.revision!, amount: 1, currency: 'THB', method: 'stripe', reason: 'Duplicate dashboard refund', idempotencyKey: 'duplicate-stripe-001' })).rejects.toThrow('reconciled automatically');
});
it('retains actual fully-refunded legacy money without inventing an original payment entry', async () => {
  const { t, bookingId, read, refund } = await setup();
  await t.run(ctx => ctx.db.patch(bookingId, { paymentStatus: 'refunded', status: 'cancelled', paymentMethod: 'stripe', stripePaymentIntentId: 'pi_checkout', amountPaid: 200, refundedAt: now - 5000 }));
  await refund(20000);
  expect(await read()).toMatchObject({ amountPaid: 200, amountRefunded: 200, refundedAt: now - 5000 });
  expect(await t.run(ctx => ctx.db.query('bookingPayments').take(10))).toHaveLength(0);
  expect((await t.run(ctx => ctx.db.query('bookingRefunds').take(10)))[0]).toMatchObject({ amount: 200, netBefore: 0, netAfter: 0 });
});
it('expires pending bookings with an atomic system history and revision', async () => {
  const { t, bookingId, read } = await setup();
  await t.run(ctx => ctx.db.patch(bookingId, { createdAt: now - 2 * 86_400_000, unpaidHoldExpiresAt: now - 1 }));
  expect(await t.mutation(internal.crons.expirePending, {})).toBe(1);
  expect(await read()).toMatchObject({ status: 'cancelled', cancelledBy: 'system:expiry', revision: 1 });
  expect((await t.run(ctx => ctx.db.query('recordChanges').take(10))).some(r => r.kind === 'pending_expired')).toBe(true);
});

it('supplies the real refund date when a cancelled stay becomes fully refunded after reversing a mistaken entry', async () => {
  const { t, admin, bookingId, start, complete, read } = await setup(); await start(); await complete();
  await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 300, status: 'cancelled' }));
  // Known itemised money must name its source; the 100 above it is older unitemised money.
  const paymentId = (await t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).first()))!._id;
  await admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: (await read())!.revision!, amount: 200, currency: 'THB', method: 'cash', reason: 'Actual returned money', effectiveAt: now - 10000, paymentId, idempotencyKey: 'refund-before-reversal' });
  const patch = await t.run(async ctx => stayPaymentReversalPatch(ctx, (await ctx.db.get(bookingId))!, 200));
  expect(patch).toMatchObject({ amountPaid: 200, paymentStatus: 'refunded', refundedAt: now - 10000 });
  expect(patch).not.toHaveProperty('status');
});
it('reconciles a single older itemised Stripe payment with its existing booking PaymentIntent without fabricating a payment', async () => {
  const { t, bookingId, start, complete, refund, read } = await setup(); await start(); await complete();
  await t.run(async ctx => {
    const payment = (await ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).first())!;
    await ctx.db.patch(payment._id, { providerPaymentIntentId: undefined });
  });
  await refund(5000);
  expect((await read())!.amountRefunded).toBe(50);
  const payments = await t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).take(10));
  expect(payments).toHaveLength(1); expect(payments[0]).toMatchObject({ providerPaymentIntentId: 'pi_checkout', refunded: 50 });
});
