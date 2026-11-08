import Link from 'next/link';
import { resort } from '@/lib/data/resort-config';
import { AnalyticsChoice } from './AnalyticsChoice';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return <main className="mx-auto max-w-3xl px-5 py-20 text-foreground">
    <h1 className="font-serif text-4xl font-semibold">{privacy ? 'Privacy policy' : 'Terms of use and booking'}</h1>
    <p className="mt-4 text-sm text-muted-foreground">Last updated 8 November 2026</p>
    <div className="mt-8 space-y-7 leading-relaxed text-muted-foreground">
      {privacy ? <>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Information we collect</h2><p>When you use this site, we may receive your name, email address, phone number, stay dates, guest count, booking details, and messages you send through chat or connected messaging services. Technical information such as browser details and page context may accompany chat messages.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">How we use it</h2><p>We use this information to answer inquiries, manage bookings and availability, send booking messages, prevent abuse, and support the service. AI services may process chat messages to produce replies. Payment card details are entered on Stripe Checkout and are not stored by this site.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Visit measurement</h2><p>If you arrive through one of our links or QR codes, this browser tab remembers which one, and its coupon if it has one, until you close the tab. A booking made, or a chat message sent, from that tab records that link. No identifier is stored for this.</p><p className="mt-3">Measurement stays off until you allow it. If you allow it, we count page views and keep a random visitor key in this browser. Each visit records the link or QR code that brought you, the page you landed on and the name of the site that sent you. It does not record your name, email or what you type. A booking made on this site or through web chat records which of our links brought you in the 30 days before it, with the campaign it belongs to. PostHog, if enabled, receives page views without session recording. Nothing is shared with advertisers.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Who receives it</h2><p>Booking and chat records are stored with Convex. Clerk handles administrator sign-in, Stripe handles payments, Resend sends transactional email, and connected messaging platforms process messages sent through their channels. Sentry may receive technical error details. Hosting and operational providers may also process information needed to deliver the site.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Your choices</h2><p>Contact us to request access, correction, or deletion of your personal information. We will review requests in light of applicable law and records needed for bookings or payments. Please avoid sending payment card details in chat.</p><p className="mt-3">You can turn measurement off at any time. This removes the visitor key from this browser and stops page views. Bookings already made keep the link they recorded.</p><AnalyticsChoice /></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Contact</h2><p>Email <a className="underline" href={`mailto:${resort.contactEmail}`}>{resort.contactEmail}</a> with privacy questions.</p></section>
      </> : <>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Current site status</h2><p>This site includes a demonstration resort and example property content. Confirm the identity, availability, price, and booking terms of any real accommodation with the host before paying. A live booking is confirmed only after verified payment or explicit host confirmation.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Bookings and payment</h2><p>A booking request starts as pending and does not reserve dates. Unpaid pending requests expire after 24 hours. If live checkout is available, payment takes place through Stripe. The booking page must show confirmed status before you rely on a reservation.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Changes and cancellation</h2><p>Contact the host about changes, cancellations, refunds, and arrival details. Any property-specific cancellation or refund terms should be provided before a real payment is taken.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Contact</h2><p>Email <a className="underline" href={`mailto:${resort.contactEmail}`}>{resort.contactEmail}</a> with booking questions.</p></section>
      </>}
    </div>
    <p className="mt-10"><Link className="underline" href="/">Return home</Link></p>
  </main>;
}
