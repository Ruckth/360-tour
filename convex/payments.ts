import { v } from 'convex/values';
import { action, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { markBookingPaid, queueCancellationEmail } from './bookings';
import { blockBookingDates, releaseBookingDates } from './lib/availabilityWrites';

const CHECKOUT_LIFETIME_SECONDS = 60 * 60;

/** Pending bookings, and confirmed-but-unpaid ones (e.g. host-confirmed, pay later), can be paid online. */
function isPayable(booking: { status: string; paymentStatus: string }) {
  return (booking.status === 'pending' || booking.status === 'confirmed') && booking.paymentStatus === 'pending';
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
    if (booking.status === 'pending' && booking.source !== 'admin' && now - booking.createdAt >= 24 * 60 * 60 * 1000) {
      throw new Error('Booking expired. Please create a new booking.');
    }
    if (booking.stripeCheckoutUrl && (booking.stripeCheckoutExpiresAt ?? 0) > now) {
      return { checkoutUrl: booking.stripeCheckoutUrl, request: null };
    }
    const property = await ctx.db.get(booking.propertyId);
    if (!property) throw new Error('Property not found');
    // Reserve the Stripe request body along with its key. Concurrent clicks and retries
    // use identical parameters; a stale or expired reservation starts a new attempt.
    if (booking.checkoutRequest && booking.checkoutRequest.expiresAt > now + 30 * 60 * 1000 &&
      booking.checkoutRequest.total === booking.total && booking.checkoutRequest.currency === booking.currency &&
      booking.checkoutRequest.checkIn === booking.checkIn && booking.checkoutRequest.checkOut === booking.checkOut &&
      booking.checkoutRequest.propertyName === property.name && booking.checkoutRequest.guestEmail === booking.guestEmail &&
      booking.checkoutRequest.siteUrl === args.siteUrl) {
      return { checkoutUrl: null, request: booking.checkoutRequest };
    }
    const request = {
      attempt: (booking.checkoutAttempt ?? 0) + 1,
      expiresAt: (Math.floor(now / 1000) + CHECKOUT_LIFETIME_SECONDS) * 1000,
      total: booking.total,
      currency: booking.currency,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      propertyName: property.name,
      siteUrl: args.siteUrl,
      guestEmail: booking.guestEmail,
    };
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
      booking.total !== args.total || booking.currency !== args.currency ||
      booking.checkIn !== args.checkIn || booking.checkOut !== args.checkOut) {
      throw new Error('Booking changed during checkout. Please start a new checkout.');
    }
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
      stripeCheckoutSessionId: args.sessionId,
      stripeCheckoutUrl: args.url,
      stripeCheckoutExpiresAt: args.expiresAt,
      checkoutRequest: undefined,
    });
    await ctx.scheduler.runAt(args.expiresAt + 60 * 60 * 1000, internal.payments.expireCheckout, {
      bookingId: args.bookingId,
      sessionId: args.sessionId,
    });
  },
});

export const expireCheckout = internalMutation({
  args: { bookingId: v.id('bookings'), sessionId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.stripeCheckoutSessionId !== args.sessionId || booking.paymentStatus === 'paid' || !isPayable(booking)) return;
    if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) return;
    if (booking.status === 'confirmed' || booking.source === 'admin') {
      await ctx.db.patch(booking._id, {
        stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined,
        checkoutRequest: undefined,
      });
      return;
    }
    await releaseBookingDates(ctx, booking);
    await ctx.db.patch(booking._id, {
      status: 'cancelled', paymentStatus: 'failed',
      stripeCheckoutSessionId: undefined, stripeCheckoutUrl: undefined, stripeCheckoutExpiresAt: undefined,
      checkoutRequest: undefined,
    });
  },
});

export const createCheckout = action({
  args: { bookingId: v.id('bookings'), accessToken: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const key = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
    if (!key || !siteUrl || !/^https:\/\//.test(siteUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(siteUrl)) {
      throw new Error('Payments are not configured');
    }
    const { checkoutUrl, request } = await ctx.runMutation(internal.payments.beginCheckout, { ...args, siteUrl });
    if (checkoutUrl) return { url: checkoutUrl };
    if (!request) throw new Error('Could not start checkout');
    const amount = Math.round(request.total * 100);
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
    await ctx.runMutation(internal.payments.saveCheckoutSession, {
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
    bookingId: v.id('bookings'),
    sessionId: v.string(),
    amountTotal: v.number(),
    currency: v.string(),
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Booking not found');
    if (booking.stripeCheckoutSessionId !== args.sessionId) throw new Error('Checkout session mismatch');
    if (Math.round(booking.total * 100) !== args.amountTotal || booking.currency.toLowerCase() !== args.currency.toLowerCase()) {
      throw new Error('Checkout amount mismatch');
    }
    if (booking.paymentStatus === 'paid') return;
    await markBookingPaid(ctx, booking._id, 'stripe');
    await ctx.db.patch(booking._id, { stripePaymentIntentId: args.paymentIntentId });
  },
});

export const recordRefund = internalMutation({
  args: { paymentIntentId: v.string(), amountRefunded: v.number(), amount: v.number() },
  handler: async (ctx, args) => {
    if (args.amountRefunded !== args.amount) return;
    const booking = await ctx.db.query('bookings').withIndex('by_stripePaymentIntentId', q => q.eq('stripePaymentIntentId', args.paymentIntentId)).unique();
    if (!booking || booking.paymentStatus === 'refunded') return;
    if (booking.paymentStatus !== 'paid') throw new Error('Refunded booking is not marked paid');
    await releaseBookingDates(ctx, booking);
    await ctx.db.patch(booking._id, { paymentStatus: 'refunded', status: 'cancelled', refundedAt: Date.now() });
    await queueCancellationEmail(ctx, booking);
  },
});
