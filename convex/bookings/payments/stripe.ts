import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { adminMutation, internalMutation, type MutationCtx, publicAction } from '../../auth/model';
import { blockBookingDates, releaseBookingDates } from '../../lib/availabilityWrites';
import { assertBookingRevision, writeBooking } from '../../lib/bookingMoney';
import { stayMoney } from '../../lib/stayMoney';
import { roundMoney } from '../../lib/orderMath';
import { appendRecordHistory } from '../../settings/model';
import { bookingHoldExpiresAt } from '../../lib/siteSettings';
import { isDocumentedLiveRefund, recordStayPayment } from '../model';

const CHECKOUT_LIFETIME_SECONDS = 60 * 60;

type Booking = import('../../_generated/dataModel').Doc<'bookings'>;

/** Returned provider money is waived, never silently presented for collection again. */
function checkoutBalance(booking: Booking) {
  return Math.max(0, roundMoney(booking.total - stayMoney(booking).net - (booking.providerRefundWaived ?? 0)));
}

/** Pending or confirmed stays may pay their remaining, unwaived balance online. */
function isPayable(booking: Booking) {
  return (booking.status === 'pending' || booking.status === 'confirmed') &&
    (booking.paymentStatus === 'pending' || booking.paymentStatus === 'paid' || isDocumentedLiveRefund(booking)) && checkoutBalance(booking) > 0;
}

export const beginCheckout = internalMutation({
  args: { bookingId: v.id('bookings'), accessToken: v.string(), siteUrl: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || !booking.accessToken || booking.accessToken !== args.accessToken) {
      throw new Error('Booking access denied');
    }
    if (!isPayable(booking)) throw new Error('Booking is no longer payable');
    const now = Date.now();
    if (booking.status === 'pending' && booking.source !== 'admin' && now >= bookingHoldExpiresAt(booking)) {
      throw new Error('Booking expired. Please create a new booking.');
    }
    if (booking.stripeCheckoutUrl && (booking.stripeCheckoutExpiresAt ?? 0) > now) {
      if ((booking.stripeCheckoutAmount ?? booking.total) !== checkoutBalance(booking)) throw new Error('Checkout balance changed. Wait for the current checkout to expire.');
      return { checkoutUrl: booking.stripeCheckoutUrl, request: null };
    }
    const property = await ctx.db.get(booking.propertyId);
    if (!property) throw new Error('Property not found');
    // Reserve the Stripe request body along with its key. Concurrent clicks and retries
    // use identical parameters; a stale or expired reservation starts a new attempt.
    if (booking.checkoutRequest && booking.checkoutRequest.expiresAt > now + 30 * 60 * 1000 &&
      booking.checkoutRequest.total === checkoutBalance(booking) && booking.checkoutRequest.currency === booking.currency &&
      booking.checkoutRequest.checkIn === booking.checkIn && booking.checkoutRequest.checkOut === booking.checkOut &&
      booking.checkoutRequest.propertyName === property.name && booking.checkoutRequest.guestEmail === booking.guestEmail &&
      booking.checkoutRequest.siteUrl === args.siteUrl) {
      return { checkoutUrl: null, request: booking.checkoutRequest };
    }
    const request = {
      attempt: (booking.checkoutAttempt ?? 0) + 1,
      expiresAt: (Math.floor(now / 1000) + CHECKOUT_LIFETIME_SECONDS) * 1000,
      total: checkoutBalance(booking),
      currency: booking.currency,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      propertyName: property.name,
      siteUrl: args.siteUrl,
      guestEmail: booking.guestEmail,
    };
    // Stripe requires at least 30 minutes. Starting checkout extends the hold to this
    // one-hour session expiry, including an in-flight request whose response is lost.
    await ctx.scheduler.runAt(request.expiresAt, internal.crons.expireBookingHold, { bookingId: booking._id, expectedRevision: booking.revision ?? 0 });
    await ctx.db.patch(booking._id, {
      checkoutAttempt: request.attempt,
      checkoutRequest: request,
      stripeCheckoutSessionId: undefined,
      stripeCheckoutUrl: undefined,
      stripeCheckoutExpiresAt: undefined,
    });
    return { checkoutUrl: null, request };
  },
});

export const saveCheckoutSession = internalMutation({
  args: {
    bookingId: v.id('bookings'),
    accessToken: v.string(),
    sessionId: v.string(),
    url: v.string(),
    expiresAt: v.number(),
    attempt: v.number(),
    total: v.number(),
    currency: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.accessToken !== args.accessToken || !isPayable(booking)) {
      throw new Error('Booking is no longer payable');
    }
    if (booking.checkoutAttempt !== args.attempt ||
      checkoutBalance(booking) !== args.total || booking.currency !== args.currency ||
      booking.checkIn !== args.checkIn || booking.checkOut !== args.checkOut) {
      throw new Error('Booking changed during checkout. Please start a new checkout.');
    }
    if (!Number.isSafeInteger(args.total) || args.total <= 0 || !Number.isSafeInteger(args.expiresAt) || args.expiresAt <= Date.now()) throw new Error('Invalid checkout amount or expiry');
    if (booking.stripeCheckoutSessionId === args.sessionId) return;
    if (booking.checkoutRequest?.attempt !== args.attempt ||
      booking.checkoutRequest.total !== args.total || booking.checkoutRequest.currency !== args.currency ||
      booking.checkoutRequest.checkIn !== args.checkIn || booking.checkoutRequest.checkOut !== args.checkOut) {
      throw new Error('Booking changed during checkout. Please start a new checkout.');
    }
    if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== args.sessionId) {
      throw new Error('A different checkout already exists');
    }
    if (!booking.stripeCheckoutSessionId) await blockBookingDates(ctx, booking, booking._id);
    await ctx.db.patch(args.bookingId, {
      stripeCheckoutAmount: args.total,
      stripeCheckoutSessionId: args.sessionId,
      stripeCheckoutUrl: args.url,
      stripeCheckoutExpiresAt: args.expiresAt,
      checkoutRequest: undefined,
    });
    await ctx.scheduler.runAt(args.expiresAt, internal.bookings.payments.stripe.expireCheckout, {
      bookingId: args.bookingId,
      sessionId: args.sessionId,
    });
  },
});

export const expireCheckout = internalMutation({
  args: { bookingId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const bookingId = ctx.db.normalizeId('bookings', args.bookingId);
    const booking = bookingId ? await ctx.db.get(bookingId) : null;
    if (!booking) { await recordOrphan(ctx, `expiry:${args.sessionId}`, { bookingId: args.bookingId, type: 'expiry' }); return; }
    if (!booking || booking.stripeCheckoutSessionId !== args.sessionId || !isPayable(booking)) return;
    if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) return;
    if (booking.status === 'confirmed' || booking.source === 'admin') {
      // Unconfirmed admin stays only hold nights while checkout is active.
      if (booking.status === 'pending') await releaseBookingDates(ctx, booking);
      await writeBooking(ctx, booking, {
        stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined, stripeCheckoutAmount: undefined,
        checkoutRequest: undefined,
      }, { actor: 'system:stripe', kind: 'checkout_expired', details: { sessionId: args.sessionId } });
      return;
    }
    if (bookingHoldExpiresAt(booking) > Date.now()) return;
    await releaseBookingDates(ctx, booking);
    await writeBooking(ctx, booking, {
      status: 'cancelled', paymentStatus: stayMoney(booking).gross > 0 ? booking.paymentStatus : 'failed', cancelledAt: Date.now(), cancelledBy: 'system:stripe',
      stripeCheckoutUrl: undefined, checkoutRequest: undefined,
    }, { actor: 'system:stripe', kind: 'checkout_expired', details: { sessionId: args.sessionId } });
  },
});

export const createCheckout = publicAction({
  reason: "Booking access-token capability; internal beginCheckout validates the specific payable booking.",
  args: { bookingId: v.id('bookings'), accessToken: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const key = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
    if (!key || !siteUrl || !/^https:\/\//.test(siteUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(siteUrl)) {
      throw new Error('Payments are not configured');
    }
    const { checkoutUrl, request } = await ctx.runMutation(internal.bookings.payments.stripe.beginCheckout, { ...args, siteUrl });
    if (checkoutUrl) return { url: checkoutUrl };
    if (!request) throw new Error('Could not start checkout');
    const amount = request.total;
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid booking amount');
    const currency = request.currency.toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error('Invalid booking currency');
    const successUrl = new URL('/booking/success', request.siteUrl);
    successUrl.searchParams.set('bookingId', args.bookingId);
    successUrl.searchParams.set('token', args.accessToken);
    const cancelUrl = new URL('/booking/pay', request.siteUrl);
    cancelUrl.searchParams.set('bookingId', args.bookingId);
    cancelUrl.searchParams.set('token', args.accessToken);
    const body = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      client_reference_id: args.bookingId,
      'metadata[bookingId]': args.bookingId,
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': `${request.propertyName} · ${request.checkIn}–${request.checkOut}`,
      'line_items[0][quantity]': '1',
      expires_at: String(request.expiresAt / 1000),
    });
    if (request.guestEmail) body.set('customer_email', request.guestEmail);
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `booking-${args.bookingId}-${request.attempt}`,
      },
      body,
    });
    const session = await response.json() as { id?: string; url?: string; expires_at?: number; error?: { message?: string } };
    if (!response.ok || !session.id || !session.url || !session.expires_at) {
      throw new Error(session.error?.message ?? 'Could not start checkout');
    }
    await ctx.runMutation(internal.bookings.payments.stripe.saveCheckoutSession, {
      ...args,
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at * 1000,
      attempt: request.attempt,
      total: request.total,
      currency: request.currency,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
    });
    return { url: session.url };
  },
});

export const completeCheckout = internalMutation({
  args: {
    bookingId: v.string(),
    sessionId: v.string(),
    amountTotal: v.number(),
    currency: v.string(),
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const bookingId = ctx.db.normalizeId('bookings', args.bookingId);
    let booking = bookingId ? await ctx.db.get(bookingId) : null;
    if (!booking) {
      if (!Number.isSafeInteger(args.amountTotal) || args.amountTotal <= 0) throw new Error('Checkout amount mismatch');
      await recordOrphan(ctx, `checkout:${args.sessionId}`, { bookingId: args.bookingId, type: 'checkout', amount: args.amountTotal, currency: args.currency, paymentIntentId: args.paymentIntentId });
      return { orphaned: true as const };
    }
    if (!Number.isSafeInteger(args.amountTotal) || args.amountTotal <= 0 || booking.currency.toLowerCase() !== args.currency.toLowerCase()) throw new Error('Checkout amount mismatch');
    const key = `stripe-checkout:${args.sessionId}`;
    const replay = await ctx.db.query('bookingPayments').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique();
    if (replay) {
      if (replay.bookingId !== booking._id || replay.amount !== args.amountTotal || replay.providerPaymentIntentId !== args.paymentIntentId) throw new Error('Checkout replay mismatch');
      return;
    }
    // A PaymentIntent is recorded at most once, whichever session delivers it.
    if (await ctx.db.query('bookingPayments').withIndex('by_providerPaymentIntentId', q => q.eq('providerPaymentIntentId', args.paymentIntentId)).first()) throw new Error('Checkout replay mismatch');
    if (booking.stripeCheckoutSessionId !== args.sessionId) throw new Error('Checkout session mismatch');
    // An expiry can win the race with a delayed signed completion. Recover only an
    // automatically expired stay, with the original session and amount. The payment
    // writer rechecks occupancy atomically; a sold night fails for host reconciliation.
    if (booking.status === 'cancelled' && (booking.cancelledBy === 'system:expiry' || booking.cancelledBy === 'system:stripe') &&
      (booking.stripeCheckoutAmount ?? booking.total) === args.amountTotal &&
      checkoutBalance(booking) === args.amountTotal) {
      booking = await writeBooking(ctx, booking, { status: 'pending', paymentStatus: 'pending', cancelledAt: undefined, cancelledBy: undefined },
        { actor: 'system:stripe', kind: 'checkout_recovered' }, { deferCouponSync: true });
    }
    // checkoutBalance > 0 means no credit, so it equals stayMoney().owed, which recordStayPayment checks again.
    if (!isPayable(booking) || (booking.stripeCheckoutAmount ?? booking.total) !== args.amountTotal || checkoutBalance(booking) !== args.amountTotal) throw new Error('Checkout amount mismatch');
    const { paymentId } = await recordStayPayment(ctx, booking._id, { origin: 'online', method: 'stripe', actor: 'system:stripe', paymentLabel: 'stripe', expectedAmount: args.amountTotal, idempotencyKey: key });
    if (!paymentId) throw new Error('No checkout balance remaining');
    await ctx.db.patch(paymentId, { providerPaymentIntentId: args.paymentIntentId });
    await ctx.db.patch(booking._id, { stripePaymentIntentId: args.paymentIntentId, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined, checkoutRequest: undefined });
  },
});

/** Authoritative cumulative charge snapshots. Older/duplicate snapshots never subtract twice. */
export const recordRefund = internalMutation({
  args: {
    paymentIntentId: v.string(), chargeId: v.string(), eventId: v.string(), eventCreated: v.number(),
    amountRefunded: v.number(), amount: v.number(), currency: v.string(),
    refunds: v.array(v.object({ id: v.string(), amount: v.number(), currency: v.string(), status: v.optional(v.string()) }))
  },
  handler: async (ctx, args) => {
    if (!args.chargeId.startsWith('ch_') || !args.eventId.startsWith('evt_') || !Number.isSafeInteger(args.eventCreated * 1000) || args.eventCreated <= 0 || args.eventCreated * 1000 > Date.now() + 5 * 60_000 ||
      !Number.isSafeInteger(args.amount) || args.amount <= 0 || !Number.isSafeInteger(args.amountRefunded) || args.amountRefunded < 0 || args.amountRefunded > args.amount) throw new Error('Invalid provider refund amount or identifiers');
    const source = await ctx.db.query('bookingPayments').withIndex('by_providerPaymentIntentId', q => q.eq('providerPaymentIntentId', args.paymentIntentId)).unique();
    const booking = source ? await ctx.db.get(source.bookingId)
      : await ctx.db.query('bookings').withIndex('by_stripePaymentIntentId', q => q.eq('stripePaymentIntentId', args.paymentIntentId)).unique();
    if (!booking) { await recordOrphan(ctx, args.eventId, { paymentIntentId: args.paymentIntentId, type: 'refund', amount: args.amountRefunded, currency: args.currency }); return { orphaned: true as const }; }
    if (booking.currency.toLowerCase() !== args.currency.toLowerCase()) throw new Error('Refund currency mismatch');
    const checkpoint = await ctx.db.query('stripeRefundCharges').withIndex('by_chargeId', q => q.eq('chargeId', args.chargeId)).unique();
    if (checkpoint && (checkpoint.bookingId !== booking._id || checkpoint.amount !== args.amount || checkpoint.paymentIntentId !== args.paymentIntentId || checkpoint.currency !== args.currency.toLowerCase())) throw new Error('Charge identity mismatch');
    if (checkpoint && checkpoint.cumulative >= args.amountRefunded) return;
    const payments = await ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', booking._id)).take(201);
    const refunds = await ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', booking._id)).take(201);
    if (payments.length > 200 || refunds.length > 200) throw new Error('Financial entries need a complete reconciliation');
    const payment = payments.find(p => p.providerPaymentIntentId === args.paymentIntentId && p.origin === 'online' && p.status === 'recorded');
    const money = stayMoney(booking);
    const providerGross = payment?.amount ?? 0;
    if (providerGross !== args.amount) throw new Error('Provider charge does not match recorded provider money');
    if (payment && !payment.providerPaymentIntentId) await ctx.db.patch(payment._id, { providerPaymentIntentId: args.paymentIntentId });
    // Never guess that a hand-entered refund is this provider refund because the amounts match.
    const manual = refunds.filter(r => r.method === 'stripe' && !r.providerEventId);
    if (manual.some(r => !r.providerChargeId || !r.providerRefundId)) throw new Error('Link manually recorded Stripe refunds to their actual charge/refund IDs before replaying this event');
    const linked = manual.filter(r => r.providerChargeId === args.chargeId);
    if (!checkpoint) for (const recorded of linked) {
      const evidence = args.refunds.find(r => r.id === recorded.providerRefundId);
      if (!evidence) throw new Error('Snapshot lacks the linked manual refund ID; reconcile using a complete later charge snapshot');
      if (!Number.isSafeInteger(evidence.amount) || evidence.amount !== recorded.amount || evidence.currency.toLowerCase() !== recorded.currency.toLowerCase() || (evidence.status && evidence.status !== 'succeeded')) throw new Error('Linked manual refund differs from actual provider refund evidence');
    }
    const linkedAmount = checkpoint ? 0 : linked.reduce((sum, r) => sum + r.amount, 0);
    const deltaMinor = args.amountRefunded - (checkpoint?.cumulative ?? 0) - linkedAmount;
    if (deltaMinor < 0) throw new Error('Provider cumulative amount is less than explicitly linked manual refunds');
    const delta = deltaMinor;

    const applied = delta;
    const linkedSourceAmount = checkpoint || !payment ? 0 : roundMoney(linked.filter(r => r.paymentId !== payment._id).reduce((sum, r) => sum + r.amount, 0));
    if (payment && roundMoney(payment.refunded + applied + linkedSourceAmount) > payment.amount) throw new Error('Provider refund exceeds remaining source payment money');
    if (applied > money.net) throw new Error('Provider refund exceeds remaining recorded money');
    const effectiveAt = args.eventCreated * 1000;
    if (delta > 0) await ctx.db.insert('bookingRefunds', {
      bookingId: booking._id, amount: delta, currency: booking.currency, method: 'stripe',
      reason: 'Refund confirmed by Stripe charge.refunded',
      context: booking.status === 'cancelled' ? 'cancellation' : 'credit', ...(payment ? { paymentId: payment._id } : {}),
      providerChargeId: args.chargeId, providerEventId: args.eventId, providerCumulative: args.amountRefunded,
      effectiveAt, recordedAt: Date.now(), recordedBy: 'system:stripe', idempotencyKey: `stripe:${args.chargeId}:${args.amountRefunded}`,
      netBefore: money.net, netAfter: roundMoney(money.net - applied)
    });
    if (payment && (applied || linkedSourceAmount)) await ctx.db.patch(payment._id, { refunded: roundMoney(payment.refunded + applied + linkedSourceAmount) });
    const netAfter = roundMoney(money.net - applied);
    // A cancelled stay with nothing left becomes refunded. A live stay keeps an ordinary money state
    // (as reopen and payment reversal do: paid while money is held, otherwise pending), so it stays
    // editable and can still collect any unwaived balance, such as a later extension.
    const emptied = netAfter === 0 && money.gross > 0;
    const statusPatch = !emptied ? {}
      : booking.status === 'cancelled' ? { paymentStatus: 'refunded' as const, refundedAt: booking.refundedAt ?? effectiveAt }
      : booking.paymentStatus === 'paid' ? { paymentStatus: 'pending' as const } : {};
    await writeBooking(ctx, booking, {
      amountRefunded: roundMoney(money.refunded + applied),
      providerRefundWaived: roundMoney((booking.providerRefundWaived ?? 0) + delta + linkedAmount),
      ...statusPatch
    }, { actor: 'system:stripe', kind: 'provider_refund', effectiveAt, details: { chargeId: args.chargeId, eventId: args.eventId, cumulativeMinor: args.amountRefunded, amount: delta, applied } });
    const state = { bookingId: booking._id, chargeId: args.chargeId, paymentIntentId: args.paymentIntentId, amount: args.amount, currency: args.currency.toLowerCase(), cumulative: args.amountRefunded, eventId: args.eventId };
    if (checkpoint) await ctx.db.patch(checkpoint._id, state);
    else await ctx.db.insert('stripeRefundCharges', state);
  }
});

/** Staff supply exact provider evidence, never an amount-based match. This moves no money. */
export const linkRecordedStripeRefund = adminMutation({
  args: { bookingId: v.id('bookings'), refundId: v.id('bookingRefunds'), expectedRevision: v.number(), chargeId: v.string(), providerRefundId: v.string() },
  handler: async (ctx, args) => {
    const admin = ctx.admin;
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Booking not found');
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.bookingId !== booking._id || refund.method !== 'stripe' || refund.providerEventId) throw new Error('Choose a manually recorded Stripe refund');
    if (!/^ch_[A-Za-z0-9]+$/.test(args.chargeId) || !/^re_[A-Za-z0-9]+$/.test(args.providerRefundId)) throw new Error('Use actual Stripe charge and refund identifiers');
    if (refund.providerChargeId === args.chargeId && refund.providerRefundId === args.providerRefundId) return;
    assertBookingRevision(booking, args.expectedRevision);
    if (refund.providerRefundId) throw new Error('This refund is already linked');
    if (refund.orderId) throw new Error('This refund references POS money; review its source before linking a Stripe refund');
    if (refund.paymentId) {
      const payment = await ctx.db.get(refund.paymentId);
      if (!payment || payment.origin !== 'online') throw new Error('This refund references a manual or POS payment, not a provider payment');
    }
    if (await ctx.db.query('stripeRefundCharges').withIndex('by_chargeId', q => q.eq('chargeId', args.chargeId)).first()) throw new Error('This charge was already reconciled; ask support to reconcile its manual entries');
    const duplicates = await ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', booking._id)).take(201);
    const duplicateId = await ctx.db.query('bookingRefunds').withIndex('by_providerRefundId', q => q.eq('providerRefundId', args.providerRefundId)).first();
    if (duplicates.length > 200 || duplicateId) throw new Error('Refund identifier already linked or full review required');
    await ctx.db.patch(refund._id, { providerChargeId: args.chargeId, providerRefundId: args.providerRefundId });
    await writeBooking(ctx, booking, {}, { actor: admin.email, kind: 'stripe_refund_linked', details: { refundId: refund._id, chargeId: args.chargeId, providerRefundId: args.providerRefundId } });
  }
});

async function recordOrphan(ctx: MutationCtx, eventId: string, details: Record<string, string | number>) {
 const existing = await ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'stripe_orphan').eq('entityId', eventId)).first();
 if (!existing) await appendRecordHistory(ctx, { entityType: 'stripe_orphan', entityId: eventId, actor: 'system:stripe', kind: 'orphaned', after: details });
}
