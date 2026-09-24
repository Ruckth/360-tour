import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const http = httpRouter();
const encoder = new TextEncoder();
const compactDate = (date: string) => date.replace(/-/g, '');

async function validStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2)));
  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const signatures = header.split(',').filter((part) => part.trim().startsWith('v1=')).map((part) => part.trim().slice(3));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const signature of signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/../g)!.map((hex) => parseInt(hex, 16)));
    if (await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${payload}`))) return true;
  }
  return false;
}

http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return new Response('Webhook not configured', { status: 503 });
    const body = await request.text();
    if (!(await validStripeSignature(body, request.headers.get('stripe-signature'), secret))) {
      return new Response('Invalid signature', { status: 400 });
    }
    let event: { type?: string; data?: { object?: { id?: string; client_reference_id?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string; amount_refunded?: number; amount?: number } } };
    try {
      event = JSON.parse(body);
    } catch {
      return new Response('Invalid payload', { status: 400 });
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object;
      if (session?.payment_status !== 'paid' || !session.id || !session.client_reference_id || !Number.isSafeInteger(session.amount_total) || !session.currency || !session.payment_intent) {
        return new Response('Incomplete checkout', { status: 400 });
      }
      try {
        await ctx.runMutation(internal.payments.completeCheckout, {
          bookingId: session.client_reference_id as Id<'bookings'>,
          sessionId: session.id,
          amountTotal: session.amount_total!,
          currency: session.currency,
          paymentIntentId: session.payment_intent,
        });
      } catch (error) {
        console.error('Stripe checkout could not confirm booking', error);
        return new Response('Could not confirm booking', { status: 500 });
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data?.object;
      if (!session?.id || !session.client_reference_id) return new Response('Incomplete checkout', { status: 400 });
      await ctx.runMutation(internal.payments.expireCheckout, {
        bookingId: session.client_reference_id as Id<'bookings'>,
        sessionId: session.id,
      });
    } else if (event.type === 'charge.refunded') {
      const charge = event.data?.object;
      if (!charge?.payment_intent || !Number.isSafeInteger(charge.amount) || !Number.isSafeInteger(charge.amount_refunded)) {
        return new Response('Incomplete refund', { status: 400 });
      }
      try {
        await ctx.runMutation(internal.payments.recordRefund, {
          paymentIntentId: charge.payment_intent,
          amount: charge.amount!,
          amountRefunded: charge.amount_refunded!,
        });
      } catch (error) {
        console.error('Stripe refund could not update booking', error);
        return new Response('Could not reconcile refund', { status: 500 });
      }
    }
    return new Response('ok');
  }),
});

http.route({
  path: '/ical/export',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return new Response('Not found', { status: 404 });
    const data = await ctx.runQuery(internal.ical.getExport, { token });
    if (!data) return new Response('Not found', { status: 404 });
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spin and Stay//Booking Calendar//EN', 'CALSCALE:GREGORIAN'];
    for (const booking of data.bookings) {
      lines.push('BEGIN:VEVENT', `UID:booking-${booking.id}@spinandstay.com`, `DTSTART;VALUE=DATE:${compactDate(booking.start)}`, `DTEND;VALUE=DATE:${compactDate(booking.end)}`, 'SUMMARY:Reserved', 'END:VEVENT');
    }
    for (const block of data.blocks) {
      const next = new Date(Date.parse(`${block.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      lines.push('BEGIN:VEVENT', `UID:block-${block.id}@spinandstay.com`, `DTSTART;VALUE=DATE:${compactDate(block.date)}`, `DTEND;VALUE=DATE:${compactDate(next)}`, 'SUMMARY:Unavailable', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return new Response(lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
  }),
});

export default http;
