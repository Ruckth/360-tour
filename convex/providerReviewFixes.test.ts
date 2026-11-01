// @vitest-environment edge-runtime
// Regressions for the provider/POS review findings on PR #34 (Sol C1, Kiro C1–C4). Every case runs
// the production mutations; only pre-itemisation (legacy) money is seeded directly, because no
// current code path can write it.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { blockBookingDates } from './lib/availabilityWrites';

const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 1, 5);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
  // Two nights at 100: total 200.
  const { bookingId, accessToken } = await t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66123456789', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 2 });
  const read = async () => (await t.run(ctx => ctx.db.get(bookingId)))!;
  const setTotal = (total: number) => t.run(ctx => ctx.db.patch(bookingId, { total }));
  const start = async (sessionId: string) => {
    const { request } = await t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
    if (!request) throw new Error('No checkout request');
    await t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken, sessionId, url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
    return request;
  };
  const complete = (sessionId: string, paymentIntentId: string, amountTotal: number) =>
    t.mutation(internal.payments.completeCheckout, { bookingId, sessionId, paymentIntentId, amountTotal, currency: 'thb' });
  const refund = (paymentIntentId: string, chargeId: string, amount: number, amountRefunded: number, eventId = `evt_${chargeId.slice(3)}_${amountRefunded}`) =>
    t.mutation(internal.payments.recordRefund, { paymentIntentId, chargeId, eventId, eventCreated: now / 1000 - 60, currency: 'thb', amount, amountRefunded, refunds: [] });
  /** A stay paid by Stripe before payments were itemised: no bookingPayments row, nights held. */
  const seedLegacyStripe = (total: number, amountPaid: number) => t.run(async ctx => {
    await ctx.db.patch(bookingId, { total, amountPaid, paymentStatus: 'paid', status: 'confirmed', paymentMethod: 'stripe', stripePaymentIntentId: 'pi_legacy', stripeCheckoutSessionId: 'cs_legacy', paidAt: now - 86_400_000 });
    await blockBookingDates(ctx, (await ctx.db.get(bookingId))!, bookingId);
  });
  const settleAtPos = async (due: number, idempotencyKey: string) => {
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    const view = (await admin.query(api.pos.getOrder, { orderId }))!;
    expect(view.totals.due).toBe(due);
    await admin.mutation(api.pos.settleOrder, { orderId, idempotencyKey, expectedRevision: view.order.revision!, expectedDue: due, tenders: [{ method: 'cash', amount: due }] });
    return orderId;
  };
  const payments = () => t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', bookingId)).take(20));
  const balance = async () => (await admin.query(api.pos.ordersForBooking, { bookingId }))!.balance;
  const heldNights = () => t.run(async ctx => (await ctx.db.query('availability').take(50)).filter(r => r.bookingId === bookingId && r.status === 'booked').length);
  /** Every row a provider or POS correction could write. */
  const snapshot = () => t.run(async ctx => ({
    booking: await ctx.db.get(bookingId),
    payments: await ctx.db.query('bookingPayments').take(50),
    refunds: await ctx.db.query('bookingRefunds').take(50),
    charges: await ctx.db.query('stripeRefundCharges').take(50),
    history: await ctx.db.query('recordChanges').take(200),
    bills: await ctx.db.query('bills').take(50),
    corrections: await ctx.db.query('billCorrections').take(50),
    audit: await ctx.db.query('billAudit').take(200),
    availability: await ctx.db.query('availability').take(50)
  }));
  return { t, admin, bookingId, read, setTotal, start, complete, refund, seedLegacyStripe, settleAtPos, payments, balance, heldNights, snapshot };
}

it.each(['normalized', 'previously written refunded'] as const)(
  'Sol C1: a reserved balance checkout completes once after the original Stripe payment is fully refunded (%s state)',
  async variant => {
    const s = await setup();
    await s.seedLegacyStripe(300, 200);
    expect((await s.start('cs_balance')).total).toBe(100);
    await s.refund('pi_legacy', 'ch_legacy', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending', amountPaid: 200, amountRefunded: 200, providerRefundWaived: 200 });
    // The state the earlier code wrote for the same refund.
    if (variant === 'previously written refunded') await s.t.run(ctx => ctx.db.patch(s.bookingId, { paymentStatus: 'refunded', refundedAt: now - 60_000 }));

    await s.complete('cs_balance', 'pi_balance', 10000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 300, amountRefunded: 200, providerRefundWaived: 200, stripePaymentIntentId: 'pi_balance', legacyStripePaymentIntentId: 'pi_legacy', legacyStripeGross: 200 });
    expect(await s.balance()).toMatchObject({ total: 300, paid: 100, refunded: 200, owed: 0 });
    expect(await s.payments()).toMatchObject([{ amount: 100, origin: 'online', providerPaymentIntentId: 'pi_balance', refunded: 0 }]);
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
  const orderId = await s.settleAtPos(200, 'pos-full-0001');
  await s.setTotal(250);
  expect((await s.start('cs_extension')).total).toBe(50);

  const before = await s.snapshot();
  await expect(s.admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-under-checkout', reason: 'Card never went through' })).rejects.toThrow('Stripe checkout open');
  expect(await s.snapshot()).toEqual(before);

  // The guest's payment still records against the balance it was opened for.
  await s.complete('cs_extension', 'pi_extension', 5000);
  expect(await s.read()).toMatchObject({ paymentStatus: 'paid', amountPaid: 250 });
  expect(await s.balance()).toMatchObject({ paid: 250, owed: 0 });
});

it('Kiro C1: the same reversal goes ahead once the checkout has expired', async () => {
  const s = await setup();
  const orderId = await s.settleAtPos(200, 'pos-full-0002');
  await s.setTotal(250);
  const request = await s.start('cs_extension');
  vi.setSystemTime(request.expiresAt + 1);
  await s.admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-after-expiry', reason: 'Card never went through' });
  expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending' });
  expect(await s.balance()).toMatchObject({ paid: 0, owed: 250 });
});

it.each(['normalized', 'previously written refunded'] as const)(
  'Kiro C2: a fully provider-refunded live stay can be extended and collects only the extension at POS (%s state)',
  async variant => {
    const s = await setup();
    await s.start('cs_checkout');
    await s.complete('cs_checkout', 'pi_checkout', 20000);
    await s.refund('pi_checkout', 'ch_checkout', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'pending', amountRefunded: 200, providerRefundWaived: 200 });
    if (variant === 'previously written refunded') await s.t.run(ctx => ctx.db.patch(s.bookingId, { paymentStatus: 'refunded', refundedAt: now - 60_000 }));
    expect(await s.balance()).toMatchObject({ paid: 0, refunded: 200, owed: 0 });

    await s.setTotal(250);
    await s.settleAtPos(50, 'pos-extension-0001');
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 250, amountRefunded: 200, providerRefundWaived: 200 });
    expect(await s.balance()).toMatchObject({ paid: 50, refunded: 200, owed: 0 });
    expect(await s.payments()).toMatchObject([
      { origin: 'online', amount: 200, refunded: 200 },
      { origin: 'pos', amount: 50, refunded: 0 }
    ]);
    expect(await s.heldNights()).toBe(2);
  }
);

it('Kiro C2: a legacy refunded flag without refund amounts still needs a reopen, and POS says why', async () => {
  const s = await setup();
  await s.t.run(ctx => ctx.db.patch(s.bookingId, { status: 'confirmed', paymentStatus: 'refunded', amountPaid: 200 }));
  await expect(s.admin.mutation(api.pos.openOrderFor, { bookingId: s.bookingId })).rejects.toThrow('marked refunded without refund amounts');
});

it.each(['pos', 'online'] as const)(
  'Kiro C3: a legacy Stripe payment refunded after a %s extension reconciles through its preserved evidence',
  async via => {
    const s = await setup();
    await s.seedLegacyStripe(200, 200);
    await s.setTotal(250);
    if (via === 'pos') await s.settleAtPos(50, 'pos-extension-0002');
    else {
      expect((await s.start('cs_extension')).total).toBe(50);
      await s.complete('cs_extension', 'pi_extension', 5000);
    }
    expect(await s.read()).toMatchObject({ amountPaid: 250, legacyStripePaymentIntentId: 'pi_legacy', legacyStripeGross: 200, stripePaymentIntentId: via === 'pos' ? 'pi_legacy' : 'pi_extension' });

    // A charge that doesn't match the preserved amount is refused.
    await expect(s.refund('pi_legacy', 'ch_other', 15000, 15000)).rejects.toThrow('does not match');

    await s.refund('pi_legacy', 'ch_legacy', 20000, 20000);
    expect(await s.read()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 250, amountRefunded: 200, providerRefundWaived: 200 });
    expect(await s.balance()).toMatchObject({ paid: 50, refunded: 200, owed: 0 });
    // The extension's own entry keeps all its money; the legacy refund names no itemised payment.
    expect(await s.payments()).toMatchObject([{ amount: 50, refunded: 0 }]);
    const refunds = await s.t.run(ctx => ctx.db.query('bookingRefunds').take(10));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 200, providerChargeId: 'ch_legacy' });
    expect(refunds[0].paymentId).toBeUndefined();
  }
);

it.each([
  ['an itemised POS payment written before evidence was captured', 'pi_legacy', 'does not match'],
  ['a replaced PaymentIntent with no preserved evidence', 'pi_extension', 'not reconciled']
] as const)('Kiro C3: an original Stripe refund with ambiguous evidence (%s) is refused, writing nothing', async (_label, currentIntent, error) => {
  const s = await setup();
  await s.seedLegacyStripe(250, 250);
  // What the earlier code left: an itemised 50 beside the unitemised Stripe money, no legacy fields.
  await s.t.run(async ctx => {
    await ctx.db.insert('bookingPayments', currentIntent === 'pi_legacy'
      ? { bookingId: s.bookingId, origin: 'pos', amount: 50, currency: 'THB', method: 'cash', effectiveAt: now - 3_600_000, recordedAt: now - 3_600_000, recordedBy: 'admin@example.com', refunded: 0, status: 'recorded' }
      : { bookingId: s.bookingId, origin: 'online', amount: 50, currency: 'THB', method: 'stripe', providerPaymentIntentId: 'pi_extension', effectiveAt: now - 3_600_000, recordedAt: now - 3_600_000, recordedBy: 'system:stripe', refunded: 0, status: 'recorded' });
    await ctx.db.patch(s.bookingId, { stripePaymentIntentId: currentIntent });
  });
  const before = await s.snapshot();
  await expect(s.refund('pi_legacy', 'ch_legacy', 20000, 20000)).rejects.toThrow(error);
  expect(await s.snapshot()).toEqual(before);
});

it('Kiro C4: an exact legacy completion redelivery is a no-op and a mismatch is refused, also after later sessions', async () => {
  const s = await setup();
  await s.seedLegacyStripe(200, 200);
  const legacy = (amountTotal: number, paymentIntentId = 'pi_legacy') => s.complete('cs_legacy', paymentIntentId, amountTotal);

  let before = await s.snapshot();
  await legacy(20000);
  expect(await s.snapshot()).toEqual(before);
  await expect(legacy(15000)).rejects.toThrow('replay mismatch');
  await expect(legacy(20000, 'pi_forged')).rejects.toThrow('amount mismatch');
  expect(await s.snapshot()).toEqual(before);

  // A later extension checkout replaces the stored session and PaymentIntent.
  await s.setTotal(250);
  expect((await s.start('cs_extension')).total).toBe(50);
  await s.complete('cs_extension', 'pi_extension', 5000);
  expect(await s.read()).toMatchObject({ amountPaid: 250, stripeCheckoutSessionId: 'cs_extension', stripePaymentIntentId: 'pi_extension', legacyStripePaymentIntentId: 'pi_legacy', legacyStripeGross: 200 });

  before = await s.snapshot();
  await legacy(20000);
  await s.complete('cs_extension', 'pi_extension', 5000);
  expect(await s.snapshot()).toEqual(before);
  await expect(legacy(15000)).rejects.toThrow('replay mismatch');
  await expect(legacy(20000, 'pi_forged')).rejects.toThrow('session mismatch');
  // One PaymentIntent records at most once, whichever session delivers it.
  await expect(s.complete('cs_other', 'pi_extension', 5000)).rejects.toThrow('replay mismatch');
  expect(await s.snapshot()).toEqual(before);
  expect(await s.payments()).toMatchObject([{ amount: 50, providerPaymentIntentId: 'pi_extension' }]);
});
