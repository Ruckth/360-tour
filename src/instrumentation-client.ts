import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from '@/lib/sentry-privacy';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    dataCollection: SENTRY_DATA_COLLECTION,
    // The customer display's pairing secret rides in the URL fragment; it never leaves the browser.
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}
