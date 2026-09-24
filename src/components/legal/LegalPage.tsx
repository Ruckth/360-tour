import Link from 'next/link';
import { resort } from '@/lib/data/resort-config';
import { AnalyticsChoice } from './AnalyticsChoice';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return <main className="mx-auto max-w-3xl px-5 py-20 text-foreground">
    <h1 className="font-serif text-4xl font-semibold">{privacy ? 'Privacy policy' : 'Terms of use and booking'}</h1>
    <p className="mt-4 text-sm text-muted-foreground">Last updated 24 September 2026</p>
    <div className="mt-8 space-y-7 leading-relaxed text-muted-foreground">
      {privacy ? <>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Information we collect</h2><p>When you use this site, we may receive your name, email address, phone number, stay dates, guest count, booking details, and messages you send through chat or connected messaging services. Technical information such as browser details and page context may accompany chat messages.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">How we use it</h2><p>We use this information to answer inquiries, manage bookings and availability, send booking messages, prevent abuse, and support the service. AI services may process chat messages to produce replies. Payment card details are entered on Stripe Checkout and are not stored by this site. If you opt in, PostHog receives page views; the site does not enable session recording.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Who receives it</h2><p>Booking and chat records are stored with Convex. Clerk handles administrator sign-in, Stripe handles payments, Resend sends transactional email, and connected messaging platforms process messages sent through their channels. Sentry may receive technical error details. Hosting and operational providers may also process information needed to deliver the site.</p></section>
        <section><h2 className="mb-2 text-xl font-semibold text-foreground">Your choices</h2><p>Contact us to request access, correction, or deletion of your personal information. We will review requests in light of applicable law and records needed for bookings or payments. Please avoid sending payment card details in chat.</p><AnalyticsChoice /></section>
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
