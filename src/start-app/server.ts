import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { init, wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

if (process.env.SENTRY_DSN) {
  init({
    dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, dataCollection: SENTRY_DATA_COLLECTION,
    beforeBreadcrumb: scrubBreadcrumb, beforeSend: scrubEvent,
  });
}
export default createServerEntry(process.env.SENTRY_DSN ? wrapFetchWithSentry(handler) : handler);
