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
