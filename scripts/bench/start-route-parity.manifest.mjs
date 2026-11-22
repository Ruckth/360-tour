/**
 * Authoritative Phase 2 route parity manifest for 360-tour.
 *
 * Covers:
 * - All 32 `src/app/**\/page.tsx` routes of the archived Next entry (10 localized public, 18 admin, 4 other)
 * - All 3 archived `src/app/api/**\/route.ts` HTTP handlers (GET + HEAD read-only probes)
 * - Special routes: robots.txt, sitemap.xml, legacy redirect, static asset headers,
 *   image optimization (permitted local + disallowed remote host), admin redirects &
 *   unknown sections, unknown locales, localized room/404/service/pay routes, and
 *   unknown marketing slug fallthrough.
 * - Explicit ledger of state-changing HTTP contracts preserved via safe unit/E2E tests.
 * - Explicit ledger of separate room perf report fields (honestly unavailable here).
 *
 * The retired Next tree is read from git at the accepted dual-entry checkpoint (scripts/dual-entry-checkpoint.mjs).
 */
import { readFileSync } from "node:fs";
import { archivedNextAppFiles } from "../dual-entry-checkpoint.mjs";
import path from "node:path";

export const LOCALES = /** @type {const} */ ([
  "en",
  "th",
  "zh-CN",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "it",
  "hi",
]);

export const PLACEHOLDER = "phase2-contract-placeholder";
export const EXPECTED_PAGE_COUNT = 32;
export const EXPECTED_HANDLER_COUNT = 3;

export const ROBOTS_EXPECTED_DIRECTIVES = /** @type {const} */ ([
  ["User-Agent", "*"],
  ["Allow", "/"],
  ["Disallow", "/admin"],
  ["Disallow", "/api"],
  ["Disallow", "/booking/pay"],
  ["Disallow", "/booking/success"],
  ["Disallow", "/chat"],
  ["Disallow", "/*/booking/pay"],
  ["Disallow", "/*/booking/success"],
  ["Disallow", "/*/chat"],
  ["Disallow", "/sign-in"],
  ["Disallow", "/sign-up"],
  ["Disallow", "/display"],
  ["Sitemap", "/sitemap.xml"],
]);

/**
 * Staff-only UI labels that must never appear in anonymous `/admin/*` SSR HTML.
 */
const ANONYMOUS_ADMIN_FORBIDDEN_MARKERS = /** @type {const} */ ([
  "Checkout rules",
  "Record payment",
  "Invite staff",
  "Business facts",
  "Staff bookings",
  "Marketing access",
  "__next_error__",
  "Application error: a server-side exception",
]);

const GENERIC_200_FORBIDDEN_MARKERS = /** @type {const} */ ([
  "Application error: a server-side exception",
  "NEXT_HTTP_ERROR_FALLBACK;404",
  "NEXT_HTTP_ERROR_FALLBACK;500",
]);

/**
 * State-changing HTTP contracts preserved via safe existing tests or loopback fixtures,
 * never mutated against immutable Preview deployments.
 */
export const STATE_CHANGING_CONTRACTS = /** @type {const} */ ([
  {
    id: "contract:api-admin-chat-reply-post",
    method: "POST",
    path: "/api/admin/chat/reply",
    source: "src/app/api/admin/chat/reply/route.ts",
    contract: "401 without Bearer; 400 on invalid UUID/body; 503 without Convex URL; 200 claim+deliver+complete; 409 duplicate; 403 unauthorized; 502 delivery failure",
    verifiedBy: ["tests/unit/admin-reply-route.test.ts", "tests/unit/admin-reply-composer.test.ts"],
    livePreviewPolicy: "Read-only GET/HEAD 405 probed on Preview; optional 401/400 validation only on isolated loopback fixture.",
  },
  {
    id: "contract:api-messaging-image-signed",
    method: "GET",
    path: "/api/messaging/image?src=...&sig=...",
    source: "src/app/api/messaging/image/route.ts",
    contract: "403 unsigned/tampered; never signs private/loopback hosts; 422 unsupported content-type or >8 MiB; 200 image/jpeg <=960x640 with public max-age=3600 s-maxage=86400 and nosniff",
    verifiedBy: ["tests/unit/messaging-images.test.ts"],
    livePreviewPolicy: "Read-only unsigned 403 probed on Preview; signed conversion verified via unit tests.",
  },
  {
    id: "contract:marketing-short-link-redirect",
    method: "GET",
    path: "/r/<slug> | /<slug>",
    source: "src/proxy.ts",
    contract: "302 redirect to internal path with Cache-Control: no-store, bot classification, and post-response waitUntil recordOpen; unknown slug falls through to 404",
    verifiedBy: [
      "tests/unit/marketing-proxy.test.ts",
      "tests/unit/marketing-bot.test.ts",
      "tests/unit/marketing-slugs.test.ts",
    ],
    livePreviewPolicy: "Unknown slug fallthrough (404) probed read-only on Preview; active recordOpen write preserved via unit tests.",
  },
  {
    id: "contract:authenticated-staff-and-checkout-mutations",
    method: "BROWSER+CONVEX",
    path: "/admin/checkout, /admin/settings?tab=team, /booking",
    source: "src/components/admin/AdminShell.tsx",
    contract: "Owner/cashier/nonstaff role isolation, manager-only limits, local cash receipt persistence across reload, guest booking & chat",
    verifiedBy: [
      "tests/e2e/clerk-auth.spec.ts",
      "tests/e2e/booking.spec.ts",
      "tests/e2e/public-chat.spec.ts",
      "tests/unit/staff-admin-access.test.ts",
    ],
    livePreviewPolicy: "Never mutates shared Preview; run via optional Clerk Playwright fixture inside scripts/local-integration.mjs.",
  },
]);

/**
 * Metrics intentionally owned by the separate room performance and cache report.
 * Always reported honestly as unavailable inside the route parity report.
 */
export const SEPARATE_PERF_EVIDENCE = /** @type {const} */ ({
  controlledCacheHitMiss: {
    status: "unavailable",
    reason: "Uncontrolled single-probe Preview requests cannot isolate cache hits from misses.",
    requiredProtocol: "100 verified hits + 100 verified misses per build in the same region with explicit eviction/namespace rotation.",
    ownedBy: "Separate room performance & cache report",
  },
  pairedTtfbP95Gate: {
    status: "unavailable",
    reason: "Single wire TTFB samples per route are descriptive only and not a paired cadence gate.",
    requiredProtocol: "100 matched direct requests per build at the same cadence; candidate p95 within +5% of baseline.",
    ownedBy: "Separate room performance & cache report",
  },
  naturalCacheHitRatio: {
    status: "unavailable",
    reason: "Natural hit ratio requires replaying an identical request sequence over the 60 s TTL window.",
    requiredProtocol: "Matched request replay with <= 2 percentage point cache-hit loss.",
    ownedBy: "Separate room performance & cache report",
  },
  previewOutageRecovery: {
    status: "unavailable",
    reason: "Outage recovery requires a controlled failure of live backend reads after the 60 s cache entry expires.",
    requiredProtocol: "Verify warm last-good fallback, 30 s retry backoff, cold retriable error, archive 404, and reactivation refresh.",
    ownedBy: "Separate room performance & cache report + tests/unit/villa-server.test.ts",
  },
  browserBundleAndTourPerf: {
    status: "unavailable",
    reason: "Client bundle budgets and mobile 360 tour drag-to-frame latency are measured by browser/manifest benchmarks.",
    requiredProtocol: "Route JS size manifest reporter (Brotli + gzip budgets) and paired mobile 360 tour-entry runs.",
    ownedBy: "docs/plans/benchmarks/tour-entry.md & scripts/bench/start-route-js-size.mjs",
  },
});

const ADMIN_PAGES = /** @type {const} */ ([
  "chats",
  "checkout",
  "checkout/preview",
  "hotel",
  "leads",
  "marketing/access",
  "marketing/affiliates",
  "marketing/campaigns",
  "marketing/coupons/[id]",
  "marketing/coupons",
  "marketing/dashboard",
  "marketing/links",
  "properties/[id]",
  "properties",
  "questions",
  "receipt/[orderId]",
  "settings",
  "staff/[tab]",
]);

/**
 * @typedef {{
 *   loadingStrings: string[],
 *   byLocale: Record<string, {
 *     rootTitle: string,
 *     bookingTitle: string,
 *     payTitle: string,
 *     successTitle: string,
 *     experiencesTitle: string,
 *     experiencesHeading: string,
 *     servicesTitle: string,
 *     chatTitle: string,
 *     privacyTitle: string,
 *     termsTitle: string,
 *     loadingVilla: string,
 *     propertyNotFound: string,
 *     backHome: string,
 *     homeHeading: string,
 *   }>,
 *   displayTitle: string,
 * }} LocalizedStrings
 */

/**
 * Load authoritative localized strings from `messages/*.json` and `messages/display/en.json`.
 * @param {string} rootDir
 * @returns {LocalizedStrings}
 */
export function loadLocalizedStrings(rootDir) {
  /** @type {LocalizedStrings["byLocale"]} */
  const byLocale = {};
  /** @type {string[]} */
  const loadingStrings = [];
  for (const locale of LOCALES) {
    const file = path.join(rootDir, "messages", `${locale}.json`);
    const data = JSON.parse(readFileSync(file, "utf8"));
    const loadingVilla = String(data.Villa?.loadingVilla ?? "");
    if (loadingVilla) loadingStrings.push(loadingVilla);
    byLocale[locale] = {
      rootTitle: String(data.SEO?.rootTitle ?? ""),
      bookingTitle: String(data.SEO?.bookingTitle ?? ""),
      payTitle: String(data.SEO?.payTitle ?? ""),
      successTitle: String(data.SEO?.successTitle ?? ""),
      experiencesTitle: String(data.SEO?.experiencesTitle ?? ""),
      experiencesHeading: String(data.Experiences?.title ?? ""),
      servicesTitle: String(data.ServiceCatalog?.title ?? ""),
      chatTitle: `${String(data.Chat?.defaultTitle ?? "")} - ${String(data.Resort?.location ?? "")}`,
      privacyTitle: String(data.Legal?.privacy?.title ?? ""),
      termsTitle: String(data.Legal?.terms?.title ?? ""),
      loadingVilla,
      propertyNotFound: String(data.Villa?.propertyNotFound ?? ""),
      backHome: String(data.Villa?.backHome ?? ""),
      homeHeading: String(data.Home?.sanctuaryTitle ?? ""),
    };
  }
  const displayData = JSON.parse(readFileSync(path.join(rootDir, "messages/display/en.json"), "utf8"));
  return {
    loadingStrings,
    byLocale,
    displayTitle: String(displayData.Display?.title ?? "Customer display"),
  };
}

/**
 * @typedef {{
 *   expectedStatus: number,
 *   expectedLocation?: string,
 *   expectedContentType?: string,
 *   requiredHeaders?: {
 *     cacheControlIncludes?: readonly string[],
 *     referrerPolicy?: string,
 *     xRobotsTagIncludes?: readonly string[],
 *     requireLocaleAlternates?: boolean,
 *   },
 *   expectedHtml?: {
 *     lang?: string | null,
 *     allowMissingLang?: boolean,
 *     titleContains?: string,
 *     robotsIncludes?: readonly string[],
 *     noindexViaMetaOrHeader?: boolean,
 *     expectedMarkers?: readonly string[],
 *     errorMarkers?: readonly string[],
 *     forbiddenMarkers?: readonly string[],
 *     requireAnonymousNoStaffLeak?: boolean,
 *     trackRoomVisibility?: boolean,
 *     roomHeading?: string,
 *     expectedLoadingText?: string,
 *   },
 *   expectedRobotsDirectives?: readonly (readonly [string, string])[],
 *   expectedSitemap?: {
 *     minEntries: number,
 *     requiredPrefixes: readonly string[],
 *     requiredPaths: readonly string[],
 *   },
 * }} RouteContract
 *
 * @typedef {{
 *   id: string,
 *   kind: "page" | "handler" | "special",
 *   group: "public" | "admin" | "other" | "handler" | "seo" | "headers" | "images" | "redirects" | "locale" | "errors" | "marketing",
 *   method: "GET" | "HEAD",
 *   path: string,
 *   canonicalPathKey: string,
 *   source: string,
 *   inRoomSlice: boolean,
 *   acceptLanguage?: string,
 *   note?: string,
 *   contract: RouteContract,
 * }} RouteSpec
 */

/**
 * Build the complete route parity manifest for a given target framework and scope.
 * @param {{
 *   targetKind?: "next" | "start",
 *   scope?: "full" | "room-slice",
 *   rootDir: string,
 * }} options
 * @returns {RouteSpec[]}
 */
export function buildManifest({ targetKind = "next", scope = "full", rootDir }) {
  const strings = loadLocalizedStrings(rootDir);
  const en = strings.byLocale.en;
  const th = strings.byLocale.th;
  const zh = strings.byLocale["zh-CN"];
  const imageEndpoint = targetKind === "start" ? "/_vercel/image" : "/_next/image";

  /** @type {RouteSpec[]} */
  const all = [
    // --- 10 Localized Public Pages ---
    {
      id: "page:home",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/",
      canonicalPathKey: "/",
      source: "src/app/[locale]/(home)/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.rootTitle,
          expectedMarkers: [en.homeHeading],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:booking",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/booking",
      canonicalPathKey: "/booking",
      source: "src/app/[locale]/booking/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.bookingTitle,
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:booking-pay",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/booking/pay",
      canonicalPathKey: "/booking/pay",
      source: "src/app/[locale]/booking/pay/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.payTitle,
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:booking-success",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/booking/success",
      canonicalPathKey: "/booking/success",
      source: "src/app/[locale]/booking/success/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.successTitle,
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:chat",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/chat",
      canonicalPathKey: "/chat",
      source: "src/app/[locale]/chat/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.chatTitle,
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:experiences",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/experiences",
      canonicalPathKey: "/experiences",
      source: "src/app/[locale]/experiences/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.experiencesTitle,
          expectedMarkers: [en.experiencesHeading],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:privacy",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/privacy",
      canonicalPathKey: "/privacy",
      source: "src/app/[locale]/privacy/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.privacyTitle,
          expectedMarkers: [en.privacyTitle],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:rooms-id",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/rooms/pool-villa?tour=1",
      canonicalPathKey: "/rooms/pool-villa?tour=1",
      source: "src/app/[locale]/rooms/[id]/page.tsx",
      inRoomSlice: true,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: "Tideglass Pool Residence",
          expectedMarkers: ["Tideglass Pool Residence"],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
          trackRoomVisibility: true,
          roomHeading: "Tideglass Pool Residence",
          expectedLoadingText: en.loadingVilla,
        },
      },
    },
    {
      id: "page:services",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/services",
      canonicalPathKey: "/services",
      source: "src/app/[locale]/services/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.servicesTitle,
          expectedMarkers: [en.servicesTitle],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:terms",
      kind: "page",
      group: "public",
      method: "GET",
      path: "/terms",
      canonicalPathKey: "/terms",
      source: "src/app/[locale]/terms/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "en",
          titleContains: en.termsTitle,
          expectedMarkers: [en.termsTitle],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },

    // --- 18 Admin Pages (anonymous read-only probes; staff verified in optional auth fixture) ---
    ...ADMIN_PAGES.map((name) => {
      const actual = name
        .replace("[tab]", "calendar")
        .replace("[orderId]", PLACEHOLDER)
        .replace("[id]", PLACEHOLDER);
      const idSlug = name.replace(/\[|\]/g, "").replace(/\//g, "-");
      /** @type {RouteSpec} */
      const spec = {
        id: `page:admin-${idSlug}`,
        kind: "page",
        group: "admin",
        method: "GET",
        path: `/admin/${actual}`,
        canonicalPathKey: `/admin/${actual}`,
        source: `src/app/admin/${name}/page.tsx`,
        inRoomSlice: false,
        note: "Anonymous SSR gate check; authenticated staff behavior covered by optional Clerk Playwright fixture.",
        contract: {
          expectedStatus: 200,
          expectedContentType: "text/html",
          requiredHeaders: { cacheControlIncludes: ["no-store"] },
          expectedHtml: {
            lang: "en",
            titleContains: "Auralis Cove Retreat",
            forbiddenMarkers: ANONYMOUS_ADMIN_FORBIDDEN_MARKERS,
            requireAnonymousNoStaffLeak: true,
          },
        },
      };
      return spec;
    }),

    // --- 4 Other Pages ---
    {
      id: "page:dev-checkout-preview",
      kind: "page",
      group: "other",
      method: "GET",
      path: "/dev/checkout-preview",
      canonicalPathKey: "/dev/checkout-preview",
      source: "src/app/dev/checkout-preview/page.tsx",
      inRoomSlice: false,
      note: "Dev-only route; must return 404 outside NODE_ENV=development.",
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          robotsIncludes: ["noindex"],
          errorMarkers: ["404", "not found"],
        },
      },
    },
    {
      id: "page:display",
      kind: "page",
      group: "other",
      method: "GET",
      path: "/display",
      canonicalPathKey: "/display",
      source: "src/app/display/page.tsx",
      inRoomSlice: false,
      note: "Customer display: pairing secrets live in URL fragment; requires no-referrer, no-store, and noindex.",
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: {
          referrerPolicy: "no-referrer",
          cacheControlIncludes: ["no-store"],
          xRobotsTagIncludes: ["noindex"],
        },
        expectedHtml: {
          lang: "en",
          titleContains: strings.displayTitle,
          robotsIncludes: ["noindex", "nofollow"],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:sign-in",
      kind: "page",
      group: "other",
      method: "GET",
      path: "/sign-in",
      canonicalPathKey: "/sign-in",
      source: "src/app/sign-in/page.tsx",
      inRoomSlice: false,
      note: "Anonymous shell check; authenticated sign-in return verified via Clerk Playwright fixture.",
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { cacheControlIncludes: ["no-store"] },
        expectedHtml: {
          lang: "en",
          titleContains: "Auralis Cove Retreat",
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "page:sign-up",
      kind: "page",
      group: "other",
      method: "GET",
      path: "/sign-up",
      canonicalPathKey: "/sign-up",
      source: "src/app/sign-up/page.tsx",
      inRoomSlice: false,
      note: "Anonymous shell check; authenticated account flow verified via Clerk Playwright fixture.",
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { cacheControlIncludes: ["no-store"] },
        expectedHtml: {
          lang: "en",
          titleContains: "Auralis Cove Retreat",
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },

    // --- 3 HTTP Handlers (GET + HEAD read-only anonymous probes) ---
    .../** @type {const} */ (["GET", "HEAD"]).map((method) => /** @type {RouteSpec} */ ({
      id: `handler:admin-chat-reply:${method}`,
      kind: "handler",
      group: "handler",
      method,
      path: "/api/admin/chat/reply",
      canonicalPathKey: "/api/admin/chat/reply",
      source: "src/app/api/admin/chat/reply/route.ts",
      inRoomSlice: false,
      note: "Read-only anonymous probe (405). POST state-changing contract verified via tests/unit/admin-reply-route.test.ts.",
      contract: { expectedStatus: 405 },
    })),
    .../** @type {const} */ (["GET", "HEAD"]).map((method) => /** @type {RouteSpec} */ ({
      id: `handler:admin-config-status:${method}`,
      kind: "handler",
      group: "handler",
      method,
      path: "/api/admin/config-status",
      canonicalPathKey: "/api/admin/config-status",
      source: "src/app/api/admin/config-status/route.ts",
      inRoomSlice: false,
      note: "Read-only anonymous probe (401). Authorized owner (200) & cashier/nonstaff (403) verified via Clerk Playwright fixture.",
      contract: { expectedStatus: 401, expectedContentType: "application/json" },
    })),
    .../** @type {const} */ (["GET", "HEAD"]).map((method) => /** @type {RouteSpec} */ ({
      id: `handler:messaging-image:${method}`,
      kind: "handler",
      group: "handler",
      method,
      path: "/api/messaging/image",
      canonicalPathKey: "/api/messaging/image",
      source: "src/app/api/messaging/image/route.ts",
      inRoomSlice: false,
      note: "Read-only unsigned probe (403). Signed conversion & host allowlist verified via tests/unit/messaging-images.test.ts.",
      contract: { expectedStatus: 403, expectedContentType: "text/plain" },
    })),

    // --- Special Routes: SEO, Legacy Redirect, Static Headers, Images, Admin Redirects, Locales & Errors ---
    {
      id: "special:robots",
      kind: "special",
      group: "seo",
      method: "GET",
      path: "/robots.txt",
      canonicalPathKey: "/robots.txt",
      source: "src/app/robots.ts",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/plain",
        expectedRobotsDirectives: ROBOTS_EXPECTED_DIRECTIVES,
      },
    },
    {
      id: "special:sitemap",
      kind: "special",
      group: "seo",
      method: "GET",
      path: "/sitemap.xml",
      canonicalPathKey: "/sitemap.xml",
      source: "src/app/sitemap.ts",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "application/xml",
        expectedSitemap: {
          minEntries: 46,
          requiredPrefixes: LOCALES.filter((l) => l !== "en"),
          requiredPaths: ["/rooms/pool-villa", "/privacy", "/terms"],
        },
      },
    },
    {
      id: "special:legacy-redirect",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: "/garden-image.jpg",
      canonicalPathKey: "/garden-image.jpg",
      source: "next.config.ts",
      inRoomSlice: true,
      contract: {
        expectedStatus: 308,
        expectedLocation: "/garden-image.webp",
      },
    },
    {
      id: "special:static-headers",
      kind: "special",
      group: "headers",
      method: "GET",
      path: "/garden-image.webp",
      canonicalPathKey: "/garden-image.webp",
      source: "next.config.ts",
      inRoomSlice: true,
      note: "Static image asset must retain long-lived immutable cache headers.",
      contract: {
        expectedStatus: 200,
        expectedContentType: "image/webp",
        requiredHeaders: { cacheControlIncludes: ["max-age=31536000", "immutable"] },
      },
    },
    {
      id: "special:image-local",
      kind: "special",
      group: "images",
      method: "GET",
      path: `${imageEndpoint}?url=%2Fgarden-image.webp&w=640&q=75`,
      canonicalPathKey: "image-optimizer:local:/garden-image.webp",
      source: targetKind === "start" ? "src/platform/image-config.ts" : "next.config.ts",
      inRoomSlice: true,
      note: "Permitted local image transform via /_next/image (Next) or /_vercel/image (Start).",
      contract: {
        expectedStatus: 200,
        expectedContentType: "image/",
      },
    },
    {
      id: "special:image-disallowed-host",
      kind: "special",
      group: "images",
      method: "GET",
      path: `${imageEndpoint}?url=https%3A%2F%2Fdisallowed.invalid%2Fphoto.jpg&w=640&q=75`,
      canonicalPathKey: "image-optimizer:disallowed-host",
      source: targetKind === "start" ? "src/platform/image-config.ts" : "next.config.ts",
      inRoomSlice: true,
      note: "Disallowed remote image host must be rejected with HTTP 400.",
      contract: {
        expectedStatus: 400,
      },
    },
    {
      id: "special:admin-root-redirect",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: "/admin",
      canonicalPathKey: "/admin",
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/chats" },
    },
    {
      id: "special:admin-staff-redirect",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: "/admin/staff",
      canonicalPathKey: "/admin/staff",
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/staff/calendar" },
    },
    {
      id: "special:admin-marketing-redirect",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: "/admin/marketing",
      canonicalPathKey: "/admin/marketing",
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/marketing/dashboard" },
    },
    {
      id: "special:admin-staff-unknown",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: `/admin/staff/${PLACEHOLDER}`,
      canonicalPathKey: `/admin/staff/${PLACEHOLDER}`,
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/chats" },
    },
    {
      id: "special:admin-marketing-unknown",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: `/admin/marketing/${PLACEHOLDER}`,
      canonicalPathKey: `/admin/marketing/${PLACEHOLDER}`,
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/chats" },
    },
    {
      id: "special:admin-section-unknown",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: `/admin/${PLACEHOLDER}`,
      canonicalPathKey: `/admin/${PLACEHOLDER}`,
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/chats" },
    },
    {
      id: "special:admin-receipt-root",
      kind: "special",
      group: "redirects",
      method: "GET",
      path: "/admin/receipt",
      canonicalPathKey: "/admin/receipt",
      source: "src/proxy.ts",
      inRoomSlice: false,
      contract: { expectedStatus: 307, expectedLocation: "/admin/chats" },
    },
    {
      id: "special:room-not-found-en",
      kind: "special",
      group: "errors",
      method: "GET",
      path: `/rooms/${PLACEHOLDER}`,
      canonicalPathKey: `/rooms/${PLACEHOLDER}`,
      source: "src/app/[locale]/rooms/[id]/page.tsx",
      inRoomSlice: true,
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          titleContains: en.rootTitle,
          robotsIncludes: ["noindex"],
          errorMarkers: [en.propertyNotFound, "404", "not found"],
        },
      },
    },
    {
      id: "special:room-not-found-th",
      kind: "special",
      group: "errors",
      method: "GET",
      path: `/th/rooms/${PLACEHOLDER}`,
      canonicalPathKey: `/th/rooms/${PLACEHOLDER}`,
      source: "src/app/[locale]/rooms/[id]/page.tsx",
      inRoomSlice: true,
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          titleContains: th.rootTitle,
          robotsIncludes: ["noindex"],
          errorMarkers: [th.propertyNotFound, "404", "not found"],
        },
      },
    },
    {
      id: "special:unknown-locale-room",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/xx/rooms/pool-villa",
      canonicalPathKey: "/xx/rooms/pool-villa",
      source: "src/app/[locale]/layout.tsx",
      inRoomSlice: true,
      note: "Unmatched unknown-locale route renders Next default 404 through RootLayout (X-Robots-Tag: noindex, no meta robots).",
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          noindexViaMetaOrHeader: true,
          errorMarkers: ["404", "could not be found", "not found"],
        },
      },
    },
    {
      id: "special:unknown-locale-services",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/xx/services",
      canonicalPathKey: "/xx/services",
      source: "src/app/[locale]/layout.tsx",
      inRoomSlice: false,
      note: "Unmatched unknown-locale route on non-room path renders Next default 404 through RootLayout (X-Robots-Tag: noindex, no meta robots).",
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          noindexViaMetaOrHeader: true,
          errorMarkers: ["404", "could not be found", "not found"],
        },
      },
    },
    {
      id: "special:room-th",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/th/rooms/pool-villa?tour=1",
      canonicalPathKey: "/th/rooms/pool-villa?tour=1",
      source: "src/app/[locale]/rooms/[id]/page.tsx",
      inRoomSlice: true,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "th",
          titleContains: "Tideglass Pool Residence",
          expectedMarkers: ["Tideglass Pool Residence"],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
          trackRoomVisibility: true,
          roomHeading: "Tideglass Pool Residence",
          expectedLoadingText: th.loadingVilla,
        },
      },
    },
    {
      id: "special:locale-default-strip",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/en/rooms/pool-villa?tour=1",
      canonicalPathKey: "/en/rooms/pool-villa?tour=1",
      source: "src/proxy.ts",
      inRoomSlice: true,
      note: "Default locale prefix `/en/...` redirects to unprefixed path under as-needed routing.",
      contract: { expectedStatus: 307, expectedLocation: "/rooms/pool-villa" },
    },
    {
      id: "special:services-zh",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/zh-CN/services",
      canonicalPathKey: "/zh-CN/services",
      source: "src/app/[locale]/services/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "zh-CN",
          titleContains: zh.servicesTitle,
          expectedMarkers: [zh.servicesTitle],
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "special:locale-negotiate-th",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/services",
      canonicalPathKey: "/services[Accept-Language:th]",
      source: "src/proxy.ts",
      inRoomSlice: false,
      acceptLanguage: "th",
      note: "Accept-Language negotiation redirects unprefixed public path to `/th/services`.",
      contract: { expectedStatus: 307, expectedLocation: "/th/services" },
    },
    {
      id: "special:pay-th",
      kind: "special",
      group: "locale",
      method: "GET",
      path: "/th/booking/pay",
      canonicalPathKey: "/th/booking/pay",
      source: "src/app/[locale]/booking/pay/page.tsx",
      inRoomSlice: false,
      contract: {
        expectedStatus: 200,
        expectedContentType: "text/html",
        requiredHeaders: { requireLocaleAlternates: true },
        expectedHtml: {
          lang: "th",
          titleContains: th.payTitle,
          forbiddenMarkers: GENERIC_200_FORBIDDEN_MARKERS,
        },
      },
    },
    {
      id: "special:marketing-unknown-slug",
      kind: "special",
      group: "marketing",
      method: "GET",
      path: `/r/${PLACEHOLDER}`,
      canonicalPathKey: `/r/${PLACEHOLDER}`,
      source: "src/proxy.ts",
      inRoomSlice: false,
      note: "Unknown marketing short link falls through to Next default 404 through RootLayout (X-Robots-Tag: noindex, no meta robots).",
      contract: {
        expectedStatus: 404,
        expectedContentType: "text/html",
        expectedHtml: {
          allowMissingLang: true,
          noindexViaMetaOrHeader: true,
          errorMarkers: ["404", "could not be found", "not found"],
        },
      },
    },
  ];

  return scope === "room-slice" ? all.filter((row) => row.inRoomSlice) : all;
}

/**
 * Page and handler files of the archived Next app tree (the parity control).
 * @param {string} rootDir
 * @returns {string[]}
 */
function listAppFiles(rootDir) {
  return archivedNextAppFiles(rootDir).filter((file) => file.endsWith("/page.tsx") || file.endsWith("/route.ts"));
}

/**
 * Verify that the full manifest covers 100% of tracked Next.js pages (32) and HTTP handlers (3)
 * with no missing entries, extra entries, or duplicate IDs.
 * @param {string} rootDir
 * @param {readonly RouteSpec[]} fullManifest
 */
export function assertManifestCoversAppTree(rootDir, fullManifest) {
  const ids = new Set();
  for (const row of fullManifest) {
    if (ids.has(row.id)) {
      throw new Error(`Duplicate manifest row id: ${row.id}`);
    }
    ids.add(row.id);
  }

  const appFiles = listAppFiles(rootDir);
  // The opt-in diagnostic rewrite exercises the same room page and closes on ordinary requests.
  const benchmarkPage = "src/app/[locale]/rooms/[id]/villa-benchmark/page.tsx";
  const actualPages = new Set(appFiles.filter((file) => file.endsWith("/page.tsx") && file !== benchmarkPage));
  const actualHandlers = new Set(appFiles.filter((file) => file.endsWith("/route.ts")));

  const manifestPages = new Set(fullManifest.filter((row) => row.kind === "page").map((row) => row.source));
  const manifestHandlers = new Set(fullManifest.filter((row) => row.kind === "handler").map((row) => row.source));

  /** @param {Set<string>} expected @param {Set<string>} actual @param {string} label @param {number} count */
  const verifySet = (expected, actual, label, count) => {
    const missing = [...actual].filter((item) => !expected.has(item));
    const extra = [...expected].filter((item) => !actual.has(item));
    if (missing.length || extra.length || actual.size !== count) {
      throw new Error(
        `Manifest ${label} coverage mismatch (expected ${count}, found ${actual.size}): ` +
          `missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
      );
    }
  };

  verifySet(manifestPages, actualPages, "page.tsx", EXPECTED_PAGE_COUNT);
  verifySet(manifestHandlers, actualHandlers, "route.ts", EXPECTED_HANDLER_COUNT);
}
