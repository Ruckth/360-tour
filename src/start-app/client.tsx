import { StartClient } from "@tanstack/react-start/client";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

if (import.meta.env.VITE_SENTRY_DSN) {
  void import("@sentry/tanstackstart-react").then(({ init }) => init({
    dsn: import.meta.env.VITE_SENTRY_DSN, tracesSampleRate: 0,
    dataCollection: SENTRY_DATA_COLLECTION, beforeBreadcrumb: scrubBreadcrumb, beforeSend: scrubEvent,
  }));
}

startTransition(() => {
  hydrateRoot(document, <StrictMode><StartClient /></StrictMode>);
});
