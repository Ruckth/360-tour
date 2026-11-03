import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

/**
 * Sentry 11 removed `sendDefaultPii`; the old `sendDefaultPii: false` was silently ignored and the
 * new defaults collect user info, cookies, headers, bodies and local variables. Guest messages and
 * contact details travel in request bodies, so every category is disabled explicitly.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** A customer-display pairing secret (`/display#pair=…`, or `pair=` anywhere in a URL), which must never reach Sentry. */
const PAIR_SECRET = /([#?&]pair=)[^&#\s"']*/g;

export function redactPairing(text: string) {
  return text.replace(PAIR_SECRET, "$1[redacted]");
}

type Crumb = { message?: string; data?: { [key: string]: unknown } };
type ReportedEvent = { request?: { url?: string }; transaction?: string; breadcrumbs?: Crumb[] };

/** Navigation `from`/`to`, fetch and XHR `url`, and the message: every place a breadcrumb carries a URL. */
export function scrubBreadcrumb<T extends Crumb>(crumb: T): T {
  if (crumb.message) crumb.message = redactPairing(crumb.message);
  for (const key of ["from", "to", "url"]) {
    const value = crumb.data?.[key];
    if (typeof value === "string") crumb.data![key] = redactPairing(value);
  }
  return crumb;
}

/** The event's own URL and name, plus its breadcrumbs (for any recorded before this filter ran). */
export function scrubEvent<T extends ReportedEvent>(event: T): T {
  if (event.request?.url) event.request.url = redactPairing(event.request.url);
  if (event.transaction) event.transaction = redactPairing(event.transaction);
  event.breadcrumbs?.forEach(scrubBreadcrumb);
  return event;
}
