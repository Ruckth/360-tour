import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from './src/lib/sentry-privacy';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, dataCollection: SENTRY_DATA_COLLECTION });
}
