import { v } from 'convex/values';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { markBookingPaid, queueCancellationEmail } from './bookings';
import { blockBookingDates, releaseBookingDates } from './lib/availabilityWrites';

const CHECKOUT_LIFETIME_SECONDS = 31 * 60;

export const getCheckoutBooking = internalQuery({
  args: { bookingId: v.id('bookings'), accessToken: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || !booking.accessToken || booking.accessToken !== args.accessToken) {
      throw new Error('Booking access denied');
    }
    const property = await ctx.db.get(booking.propertyId);
    if (!property) throw new Error('Property not found');
    return {
      id: booking._id,
      createdAt: booking.createdAt,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      guestEmail: booking.guestEmail,
      total: booking.total,
      currency: booking.currency,
      propertyName: property.name,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      checkoutUrl: booking.stripeCheckoutUrl,
      checkoutExpiresAt: booking.stripeCheckoutExpiresAt,
    };
  },
});

export const saveCheckoutSession = internalMutation({
  args: {
    bookingId: v.id('bookings'),
    accessToken: v.string(),
    sessionId: v.string(),
    url: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.accessToken !== args.accessToken || booking.status !== 'pending' || booking.paymentStatus !== 'pending') {
      throw new Error('Booking is no longer payable');
    }
    if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== args.sessionId) {
      throw new Error('A different checkout already exists');
    }
    if (!booking.stripeCheckoutSessionId) await blockBookingDates(ctx, booking, booking._id);
    await ctx.db.patch(args.bookingId, {
      stripeCheckoutSessionId: args.sessionId,
      stripeCheckoutUrl: args.url,
      stripeCheckoutExpiresAt: args.expiresAt,
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
    if (!booking || booking.stripeCheckoutSessionId !== args.sessionId || booking.paymentStatus === 'paid' || booking.status !== 'pending') return;
    if ((booking.stripeCheckoutExpiresAt ?? 0) > Date.now()) return;
    await releaseBookingDates(ctx, booking);
    await ctx.db.patch(booking._id, { status: 'cancelled', paymentStatus: 'failed' });
  },
});

export const createCheckout = action({
  args: { bookingId: v.id('bookings'), accessToken: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const booking = await ctx.runQuery(internal.payments.getCheckoutBooking, args);
    if (booking.status !== 'pending' || booking.paymentStatus !== 'pending') {
      throw new Error('Booking is no longer payable');
    }
    if (Date.now() - booking.createdAt >= 24 * 60 * 60 * 1000) {
      throw new Error('Booking expired. Please create a new booking.');
    }
    if (booking.checkoutUrl) {
      if ((booking.checkoutExpiresAt ?? 0) <= Date.now()) throw new Error('Checkout expired. Please create a new booking.');
      return { url: booking.checkoutUrl };
    }
    const key = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
    if (!key || !siteUrl || !/^https:\/\//.test(siteUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(siteUrl)) {
      throw new Error('Payments are not configured');
    }
    const amount = Math.round(booking.total * 100);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid booking amount');
    const currency = booking.currency.toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error('Invalid booking currency');
    const successUrl = new URL('/booking/success', siteUrl);
    successUrl.searchParams.set('bookingId', args.bookingId);
    successUrl.searchParams.set('token', args.accessToken);
    const cancelUrl = new URL('/booking/pay', siteUrl);
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
      'line_items[0][price_data][product_data][name]': `${booking.propertyName} · ${booking.checkIn}–${booking.checkOut}`,
      'line_items[0][quantity]': '1',
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_LIFETIME_SECONDS),
    });
    if (booking.guestEmail) body.set('customer_email', booking.guestEmail);
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `booking-${args.bookingId}`,
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
    const blocks = await ctx.db.query('availability').withIndex('by_property_date', q =>
      q.eq('propertyId', booking.propertyId).gte('date', booking.checkIn).lt('date', booking.checkOut)
    ).take(366);
    for (const block of blocks) if (block.bookingId === booking._id) await ctx.db.delete(block._id);
    await ctx.db.patch(booking._id, { paymentStatus: 'refunded', status: 'cancelled' });
    await queueCancellationEmail(ctx, booking);
  },
});
