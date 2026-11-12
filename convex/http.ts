import { httpRouter } from 'convex/server';
import { httpAction } from './auth/model';
import { webhook } from './messaging/ingress';
import { internal } from './_generated/api';

const http = httpRouter();
const encoder = new TextEncoder();
// Only known pre-cutover financial orphans are acknowledged; newer captures stay visible as failed deliveries for reconciliation.
function isCutoverReplay(created: number | undefined) {
  const cutoff = Number(process.env.ARCH_MONEY_CUTOVER_AT);
  return Number.isSafeInteger(cutoff) && cutoff > 0 && Number.isSafeInteger(created) && created! > 0 && created! < Math.floor(cutoff / 1000);
}
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
    let event: { id?: string; created?: number; type?: string; data?: { object?: { id?: string; client_reference_id?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string; amount_refunded?: number; amount?: number; refunds?: { data?: Array<{ id?: string; amount?: number; currency?: string; status?: string }> } } } };
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
        const result = await ctx.runMutation(internal.bookings.payments.stripe.completeCheckout, {
          bookingId: session.client_reference_id,
          sessionId: session.id,
          amountTotal: session.amount_total!,
          currency: session.currency,
          paymentIntentId: session.payment_intent,
        });
        if (result?.orphaned && !isCutoverReplay(event.created)) return new Response('Payment requires reconciliation', { status: 500 });
      } catch (error) {
        console.error('Stripe checkout could not confirm booking', error);
        return new Response('Could not confirm booking', { status: 500 });
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data?.object;
      if (!session?.id || !session.client_reference_id) return new Response('Incomplete checkout', { status: 400 });
      try {
        await ctx.runMutation(internal.bookings.payments.stripe.expireCheckout, {
          bookingId: session.client_reference_id,
          sessionId: session.id,
        });
      } catch (error) {
        console.error('Stripe checkout expiry could not be recorded', error);
        return new Response('Could not expire checkout', { status: 500 });
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data?.object;
      if (!event.id || !event.created || !charge?.id || !charge.currency || !charge.payment_intent || !Number.isSafeInteger(charge.amount) || !Number.isSafeInteger(charge.amount_refunded)) {
        return new Response('Incomplete refund', { status: 400 });
      }
      try {
        const result = await ctx.runMutation(internal.bookings.payments.stripe.recordRefund, {
          paymentIntentId: charge.payment_intent, chargeId: charge.id, eventId: event.id, eventCreated: event.created, currency: charge.currency, refunds: (charge.refunds?.data ?? []).flatMap(r => r.id && r.amount !== undefined && r.currency ? [{ id: r.id, amount: r.amount, currency: r.currency, ...(r.status ? { status: r.status } : {}) }] : []),
          amount: charge.amount!,
          amountRefunded: charge.amount_refunded!,
        });
        if (result?.orphaned && !isCutoverReplay(event.created)) return new Response('Refund requires reconciliation', { status: 500 });
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
    const data = await ctx.runQuery(internal.bookings.calendar.ical.getExport, { token });
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

for (const channel of ['line', 'facebook', 'instagram', 'whatsapp'] as const) {
  for (const method of ['GET', 'POST'] as const) http.route({ path: `/${channel}/webhook`, method, handler: webhook(channel) });
}

export default http;
