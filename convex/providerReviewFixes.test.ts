// @vitest-environment edge-runtime
// Regressions for the provider/POS review findings on PR #34 (Sol C1, Kiro C1–C4). Every case runs
// the production mutations; only pre-itemisation (legacy) money is seeded directly, because no
// current code path can write it.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 1, 5);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  // Two nights at 100: total 200.
  const { bookingId, accessToken } = await t.mutation(api.bookings.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), checkOut: new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10), guests: 2 });
  const read = async () => (await t.run(ctx => ctx.db.get(bookingId)))!;
  const setTotal = (total: number) => t.run(ctx => ctx.db.patch(bookingId, { total }));
  const start = async (sessionId: string) => {
    const { request } = await t.mutation(internal.bookings.payments.stripe.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
    if (!request) throw new Error('No checkout request');
    await t.mutation(internal.bookings.payments.stripe.saveCheckoutSession, { bookingId, accessToken, sessionId, url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
    return request;
  };
  const complete = (sessionId: string, paymentIntentId: string, amountTotal: number) =>
    t.mutation(internal.bookings.payments.stripe.completeCheckout, { bookingId, sessionId, paymentIntentId, amountTotal, currency: 'thb' });
  const refund = (paymentIntentId: string, chargeId: string, amount: number, amountRefunded: number, eventId = `evt_${chargeId.slice(3)}_${amountRefunded}`) =>
    t.mutation(internal.bookings.payments.stripe.recordRefund, { paymentIntentId, chargeId, eventId, eventCreated: now / 1000 - 60, currency: 'thb', amount, amountRefunded, refunds: [] });
  /** Use actual provider writes so refund/replay tests exercise complete ledger evidence. */
  const seedStripePayment = async (total: number, amountPaid: number) => {
    await start('cs_legacy');
    await complete('cs_legacy', 'pi_legacy', amountPaid);
    await setTotal(total);
  };
  const settleAtPos = async (due: number, idempotencyKey: string) => {
    const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    const view = (await admin.query(api.pos.orders.getOrder, { orderId }))!;
    expect(view.totals.due).toBe(due);
    await admin.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, idempotencyKey, expectedRevision: view.order.revision!, expectedDue: due, tenders: [{ method: 'cash', amount: due }] });
    return orderId;
  };
  const payments = () => t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).take(20));
  const balance = async () => (await admin.query(api.pos.orders.ordersForBooking, { bookingId }))!.balance;
  const heldNights = () => t.run(async ctx => (await ctx.db.query('availability').take(50)).filter(r => r.bookingId === bookingId && r.status === 'booked').length);
  /** Every row a provider or POS correction could write. */
  const snapshot = () => t.run(async ctx => ({
    booking: await ctx.db.get(bookingId),
    payments: await ctx.db.query('bookingPayments').take(50),
    refunds: await ctx.db.query('bookingRefunds').take(50),
    charges: await ctx.db.query('stripeRefundCharges').take(50),
    history: await ctx.db.query('recordChanges').take(200),
    orders: await ctx.db.query('orders').take(50),
    corrections: await ctx.db.query('orderCorrections').take(50),
    audit: await ctx.db.query('orderAudit').take(200),
    availability: await ctx.db.query('availability').take(50)
  }));
  return { t, admin, bookingId, read, setTotal, start, complete, refund, seedStripePayment, settleAtPos, payments, balance, heldNights, snapshot };
}

it.each(['normalized', 'previously written refunded'] as const)(
  'Sol C1: a reserved balance checkout completes once after the original Stripe payment is fully refunded (%s state)',
  async variant => {
    const s = await setup();
    await s.seedStripePayment(30000, 20000);
    expect((await s.start('cs_balance')).total).toBe(10000);
    await s.refund('pi_legacy', 'ch_legacy', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending', amountPaid: 20000, amountRefunded: 20000, providerRefundWaived: 20000 });
    // The state the earlier code wrote for the same refund.
    if (variant === 'previously written refunded') await s.t.run(ctx => ctx.db.patch(s.bookingId, { paymentStatus: 'refunded', refundedAt: now - 60_000 }));

    await s.complete('cs_balance', 'pi_balance', 10000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 30000, amountRefunded: 20000, providerRefundWaived: 20000, stripePaymentIntentId: 'pi_balance' });
    expect(await s.balance()).toMatchObject({ total: 30000, paid: 10000, refunded: 20000, owed: 0 });
    expect(await s.payments()).toMatchObject([{ amount: 20000, refunded: 20000 }, { amount: 10000, origin: 'online', providerPaymentIntentId: 'pi_balance', refunded: 0 }]);
    expect(await s.heldNights()).toBe(2);

    // Redeliveries of both events write nothing.
    const after = await s.snapshot();
    await s.complete('cs_balance', 'pi_balance', 10000);
    await s.refund('pi_legacy', 'ch_legacy', 20000, 20000, 'evt_redelivered');
    expect(await s.snapshot()).toEqual(after);
  }
);

it('Kiro C1: a POS unreceived reversal is refused atomically while the guest has a Stripe checkout open', async () => {
  const s = await setup();
  const orderId = await s.settleAtPos(20000, 'pos-full-0001');
  await s.setTotal(25000);
  expect((await s.start('cs_extension')).total).toBe(5000);

  const before = await s.snapshot();
  await expect(s.admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-under-checkout', reason: 'Card never went through' })).rejects.toThrow('Stripe checkout open');
  expect(await s.snapshot()).toEqual(before);

  // The guest's payment still records against the balance it was opened for.
  await s.complete('cs_extension', 'pi_extension', 5000);
  expect(await s.read()).toMatchObject({ paymentStatus: 'paid', amountPaid: 25000 });
  expect(await s.balance()).toMatchObject({ paid: 25000, owed: 0 });
});

it('Kiro C1: the same reversal goes ahead once the checkout has expired', async () => {
  const s = await setup();
  const orderId = await s.settleAtPos(20000, 'pos-full-0002');
  await s.setTotal(25000);
  const request = await s.start('cs_extension');
  vi.setSystemTime(request.expiresAt + 1);
  await s.admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-after-expiry', reason: 'Card never went through' });
  expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending' });
  expect(await s.balance()).toMatchObject({ paid: 0, owed: 25000 });
});

it.each(['normalized', 'previously written refunded'] as const)(
  'Kiro C2: a fully provider-refunded live stay can be extended and collects only the extension at POS (%s state)',
  async variant => {
    const s = await setup();
    await s.start('cs_checkout');
    await s.complete('cs_checkout', 'pi_checkout', 20000);
    await s.refund('pi_checkout', 'ch_checkout', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending', amountRefunded: 20000, providerRefundWaived: 20000 });
    if (variant === 'previously written refunded') await s.t.run(ctx => ctx.db.patch(s.bookingId, { paymentStatus: 'refunded', refundedAt: now - 60_000 }));
    expect(await s.balance()).toMatchObject({ paid: 0, refunded: 20000, owed: 0 });

    await s.setTotal(25000);
    await s.settleAtPos(5000, 'pos-extension-0001');
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 25000, amountRefunded: 20000, providerRefundWaived: 20000 });
    expect(await s.balance()).toMatchObject({ paid: 5000, refunded: 20000, owed: 0 });
    expect(await s.payments()).toMatchObject([
      { origin: 'online', amount: 20000, refunded: 20000 },
      { origin: 'pos', amount: 5000, refunded: 0 }
    ]);
    expect(await s.heldNights()).toBe(2);
  }
);

it.each(['pos', 'online'] as const)(
  'Kiro C3: an earlier Stripe payment refunded after a %s extension reconciles through its ledger entry',
  async via => {
    const s = await setup();
    await s.seedStripePayment(20000, 20000);
    await s.setTotal(25000);
    if (via === 'pos') await s.settleAtPos(5000, 'pos-extension-0002');
    else {
      expect((await s.start('cs_extension')).total).toBe(5000);
      await s.complete('cs_extension', 'pi_extension', 5000);
    }
    expect(await s.read()).toMatchObject({ amountPaid: 25000, stripePaymentIntentId: via === 'pos' ? 'pi_legacy' : 'pi_extension' });

    // A charge that doesn't match the preserved amount is refused.
    await expect(s.refund('pi_legacy', 'ch_other', 15000, 15000)).rejects.toThrow('does not match');

    await s.refund('pi_legacy', 'ch_legacy', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 25000, amountRefunded: 20000, providerRefundWaived: 20000 });
    expect(await s.balance()).toMatchObject({ paid: 5000, refunded: 20000, owed: 0 });
    // The extension's own entry keeps all its money; the legacy refund names no itemised payment.
    expect(await s.payments()).toMatchObject([{ amount: 20000, refunded: 20000 }, { amount: 5000, refunded: 0 }]);
    const refunds = await s.t.run(ctx => ctx.db.query('bookingRefunds').take(10));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 20000, providerChargeId: 'ch_legacy' });
    expect(refunds[0].paymentId).toBe((await s.payments())[0]._id);
  }
);
