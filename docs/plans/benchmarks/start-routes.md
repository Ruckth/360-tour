# Phase 2 Route Parity Report (Next.js vs TanStack Start)

Scope: **full** · Mode: **paired** · Overall verdict: **pass**

This report tracks URL-by-URL HTTP, metadata, redirect, header, and JS-disabled HTML parity across all 32 tracked page routes, 3 frontend HTTP handlers, and special routes. See the [controlled room timings](room-preview-corrected-timing.md), [natural cache replay](room-preview-corrected-natural.md), [cache outage study](start-villa-cache-study.md), [mobile interaction measurements](tour-entry-start.md) and [authenticated Preview workflows](start-room-preview.md) for the corresponding tests.

## Target metadata

| Side | Status | Framework | Deployment | Commit | Tree | Collected (UTC) | Method |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | collected | next | `dpl_8EZ5F1F2PEMVBPT1pvWwETKBPVc3` | `c70af789` | `ee1d5cfd16fe36283fba76ff7cdc13024ac08a58` | 2026-11-22T02:59:20.122Z | verified-local-reference (preview-control/routes.json) + vercel-curl (read-only) |
| Candidate | collected | start | `dpl_266U2Se7MvYbTFQSp9VZkSEV4wbQ` | `1c1938b2` | `c0e7ac61b19df66f84f9770148a781682ea6ce75` | 2026-11-22T06:40:50.991Z | vercel-curl (read-only) |

### Collection caveats

- Anonymous app requests with Vercel protection access, using curl default Accept.
- A separate text/html Accept probe triggered Clerk 307 handshake on app paths. It was never followed.
- Redirects are not followed. Locations and link targets retain only public paths.
- One descriptive wire TTFB per request. Cache is uncontrolled.
- HTML visibility is inferred from markup before scripts and CSS execute.
- Anonymous read-only GET/HEAD requests with default Accept (*/*).
- Redirects are never followed. Location and Link targets retain sanitized public paths only.
- Single descriptive wire TTFB per request; cache state is uncontrolled (see separate room perf report).
- JS-disabled HTML visibility is inferred from SSR markup before scripts or external CSS execute.
- The candidate at 1c1938b2 contains the release application, build configuration and frozen lock. Subsequent changes cover local install recovery, benchmark and QA tooling, and evidence.

## Summary

| Metric | Count |
| --- | ---: |
| Manifest rows in scope | 61 |
| Page routes (32 expected in full scope) | 32 |
| HTTP handlers (3 expected; 6 GET/HEAD probes) | 3 |
| Special routes (SEO, redirects, static headers, images, locales, 404s) | 23 |
| Control pass / fail / unavailable | 61 / 0 / 0 |
| Candidate pass / fail / unavailable | 61 / 0 / 0 |
| Parity match / improved / drift / fail / pending | 59 / 2 / 0 / 0 / 0 |

## JS-disabled HTML visibility (room slice)

| Route | Control no-JS state | Control headings | Control loading fallback | Candidate no-JS state |
| --- | --- | --- | --- | --- |
| `/rooms/pool-villa?tour=1` | `suspense-fallback-with-hidden-content` | "Tideglass Pool Residence" (hiddenAncestor) | "Loading villa..." (visible) | `visible-content` |
| `/th/rooms/pool-villa?tour=1` | `suspense-fallback-with-hidden-content` | "Tideglass Pool Residence" (hiddenAncestor) | "กำลังโหลดวิลล่า..." (visible) | `visible-content` |

## URL-by-URL parity table

### Localized public pages (10)

| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | GET | `src/app/[locale]/(home)/page.tsx` | `pass` 200 (MISS, 692.4 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu" | `pass` 200 (MISS, 2648.9 ms) | `match` |
| `/booking` | GET | `src/app/[locale]/booking/page.tsx` | `pass` 200 (MISS, 698 ms) | lang=en; title="Book Direct - Auralis Cove Retreat" | `pass` 200 (MISS, 438.3 ms) | `match` |
| `/booking/pay` | GET | `src/app/[locale]/booking/pay/page.tsx` | `pass` 200 (MISS, 719 ms) | lang=en; title="Secure Checkout - Auralis Cove Retreat" | `pass` 200 (MISS, 431.2 ms) | `match` |
| `/booking/success` | GET | `src/app/[locale]/booking/success/page.tsx` | `pass` 200 (MISS, 672.6 ms) | lang=en; title="Booking Confirmation - Auralis Cove Retreat" | `pass` 200 (MISS, 704.9 ms) | `match` |
| `/chat` | GET | `src/app/[locale]/chat/page.tsx` | `pass` 200 (MISS, 714.1 ms) | lang=en; title="Auralis concierge - Koh Samui, Thailand" | `pass` 200 (MISS, 459.3 ms) | `match` |
| `/experiences` | GET | `src/app/[locale]/experiences/page.tsx` | `pass` 200 (MISS, 716.7 ms) | lang=en; title="Experiences - Auralis Cove Retreat" | `pass` 200 (MISS, 777.3 ms) | `match` |
| `/privacy` | GET | `src/app/[locale]/privacy/page.tsx` | `pass` 200 (MISS, 708 ms) | lang=en; title="Privacy policy" | `pass` 200 (MISS, 662.8 ms) | `match` |
| `/rooms/pool-villa?tour=1` | GET | `src/app/[locale]/rooms/[id]/page.tsx` | `pass` 200 (MISS, 693.4 ms) | lang=en; title="Tideglass Pool Residence — Auralis Cove Retreat"; no-js=suspense-fallback-with-hidden-content; h1="Tideglass Pool Residence"(hidden); fallback="Loading villa..."(visible) | `pass` 200 (MISS, 450.2 ms) | `improved` |
| `/services` | GET | `src/app/[locale]/services/page.tsx` | `pass` 200 (MISS, 739.4 ms) | lang=en; title="Explore our services" | `pass` 200 (MISS, 457.6 ms) | `match` |
| `/terms` | GET | `src/app/[locale]/terms/page.tsx` | `pass` 200 (MISS, 670.6 ms) | lang=en; title="Terms of use and booking" | `pass` 200 (MISS, 695 ms) | `match` |

### Admin pages — anonymous SSR gate (18)

| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin/chats` | GET | `src/app/admin/chats/page.tsx` | `pass` 200 (MISS, 745.8 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 530.6 ms) | `match` |
| `/admin/checkout` | GET | `src/app/admin/checkout/page.tsx` | `pass` 200 (MISS, 718 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 471 ms) | `match` |
| `/admin/checkout/preview` | GET | `src/app/admin/checkout/preview/page.tsx` | `pass` 200 (MISS, 684 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 432.9 ms) | `match` |
| `/admin/hotel` | GET | `src/app/admin/hotel/page.tsx` | `pass` 200 (MISS, 718 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 520.9 ms) | `match` |
| `/admin/leads` | GET | `src/app/admin/leads/page.tsx` | `pass` 200 (MISS, 674.1 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 406.6 ms) | `match` |
| `/admin/marketing/access` | GET | `src/app/admin/marketing/access/page.tsx` | `pass` 200 (MISS, 677.9 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 423.5 ms) | `match` |
| `/admin/marketing/affiliates` | GET | `src/app/admin/marketing/affiliates/page.tsx` | `pass` 200 (MISS, 707 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 458.8 ms) | `match` |
| `/admin/marketing/campaigns` | GET | `src/app/admin/marketing/campaigns/page.tsx` | `pass` 200 (MISS, 664.3 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 437.4 ms) | `match` |
| `/admin/marketing/coupons/phase2-contract-placeholder` | GET | `src/app/admin/marketing/coupons/[id]/page.tsx` | `pass` 200 (MISS, 668.7 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 395.1 ms) | `match` |
| `/admin/marketing/coupons` | GET | `src/app/admin/marketing/coupons/page.tsx` | `pass` 200 (MISS, 672.1 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 409.4 ms) | `match` |
| `/admin/marketing/dashboard` | GET | `src/app/admin/marketing/dashboard/page.tsx` | `pass` 200 (MISS, 669.6 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 409.5 ms) | `match` |
| `/admin/marketing/links` | GET | `src/app/admin/marketing/links/page.tsx` | `pass` 200 (MISS, 691.7 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 402.4 ms) | `match` |
| `/admin/properties/phase2-contract-placeholder` | GET | `src/app/admin/properties/[id]/page.tsx` | `pass` 200 (MISS, 669.9 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 417.6 ms) | `match` |
| `/admin/properties` | GET | `src/app/admin/properties/page.tsx` | `pass` 200 (MISS, 696.7 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 395.6 ms) | `match` |
| `/admin/questions` | GET | `src/app/admin/questions/page.tsx` | `pass` 200 (MISS, 663.3 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 403.8 ms) | `match` |
| `/admin/receipt/phase2-contract-placeholder` | GET | `src/app/admin/receipt/[orderId]/page.tsx` | `pass` 200 (MISS, 668.5 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 401.4 ms) | `match` |
| `/admin/settings` | GET | `src/app/admin/settings/page.tsx` | `pass` 200 (MISS, 650.1 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 408.4 ms) | `match` |
| `/admin/staff/calendar` | GET | `src/app/admin/staff/[tab]/page.tsx` | `pass` 200 (MISS, 667.1 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 427.7 ms) | `match` |

### Other pages (4)

| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |
| --- | --- | --- | --- | --- | --- | --- |
| `/dev/checkout-preview` | GET | `src/app/dev/checkout-preview/page.tsx` | `pass` 404 (MISS, 675.2 ms) | title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; robots=noindex; no-js=error-page | `pass` 404 (MISS, 402.2 ms) | `match` |
| `/display` | GET | `src/app/display/page.tsx` | `pass` 200 (MISS, 686.8 ms) | lang=en; title="Customer display"; robots=noindex, nofollow | `pass` 200 (MISS, 398.9 ms) | `match` |
| `/sign-in` | GET | `src/app/sign-in/page.tsx` | `pass` 200 (MISS, 683.5 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 408.1 ms) | `match` |
| `/sign-up` | GET | `src/app/sign-up/page.tsx` | `pass` 200 (MISS, 671.1 ms) | lang=en; title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; no-js=shell-or-client-gated | `pass` 200 (MISS, 390.9 ms) | `match` |

### Frontend HTTP handlers — read-only probes (3 handlers × GET/HEAD)

| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/admin/chat/reply` | GET | `src/app/api/admin/chat/reply/route.ts` | `pass` 405 (MISS, 1516.1 ms) | cc=public, max-age=0, must-revalidate | `pass` 405 (MISS, 407.5 ms) | `match` |
| `/api/admin/chat/reply` | HEAD | `src/app/api/admin/chat/reply/route.ts` | `pass` 405 (MISS, 844.4 ms) | cc=public, max-age=0, must-revalidate | `pass` 405 (MISS, 397.8 ms) | `match` |
| `/api/admin/config-status` | GET | `src/app/api/admin/config-status/route.ts` | `pass` 401 (MISS, 654.4 ms) | application/json; cc=public, max-age=0, must-revalidate | `pass` 401 (MISS, 409.4 ms) | `match` |
| `/api/admin/config-status` | HEAD | `src/app/api/admin/config-status/route.ts` | `pass` 401 (MISS, 664 ms) | application/json; cc=public, max-age=0, must-revalidate | `pass` 401 (MISS, 393.3 ms) | `match` |
| `/api/messaging/image` | GET | `src/app/api/messaging/image/route.ts` | `pass` 403 (MISS, 694.2 ms) | text/plain;charset=UTF-8; cc=public, max-age=0, must-revalidate | `pass` 403 (MISS, 449.6 ms) | `match` |
| `/api/messaging/image` | HEAD | `src/app/api/messaging/image/route.ts` | `pass` 403 (MISS, 691.2 ms) | text/plain;charset=UTF-8; cc=public, max-age=0, must-revalidate | `pass` 403 (MISS, 392.8 ms) | `match` |

### Special routes — SEO, redirects, headers, images, locales, 404s

| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |
| --- | --- | --- | --- | --- | --- | --- |
| `/robots.txt` | GET | `src/app/robots.ts` | `pass` 200 (HIT, 125.8 ms) | robots.txt (14 directives) | `pass` 200 (MISS, 429.1 ms) | `match` |
| `/sitemap.xml` | GET | `src/app/sitemap.ts` | `pass` 200 (HIT, 132.9 ms) | sitemap (79 URLs, 10 locales) | `pass` 200 (MISS, 422.2 ms) | `match` |
| `/garden-image.jpg` | GET | `next.config.ts` | `pass` 308 -> `/garden-image.webp` (n/a, 125.9 ms) | text/plain; cc=public, max-age=31536000, immutable | `pass` 308 -> `/garden-image.webp` (n/a, 139.3 ms) | `match` |
| `/garden-image.webp` | GET | `next.config.ts` | `pass` 200 (HIT, 219.4 ms) | image/webp; cc=public, max-age=31536000, immutable | `pass` 200 (MISS, 1050.7 ms) | `match` |
| `/_next/image?url=%2Fgarden-image.webp&w=640&q=75` | GET | `next.config.ts` | `pass` 200 (HIT, 190.3 ms) | image/jpeg; cc=public, max-age=31536000, immutable | `pass` 200 (HIT, 143.6 ms) | `match` |
| `/_next/image?url=https%3A%2F%2Fdisallowed.invalid%2Fphoto.jpg&w=640&q=75` | GET | `next.config.ts` | `pass` 400 (n/a, 195 ms) | text/plain; charset=utf-8; cc=public, max-age=0, must-revalidate | `pass` 400 (n/a, 120.2 ms) | `match` |
| `/admin` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/chats` (n/a, 467.2 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/chats` (MISS, 406.2 ms) | `match` |
| `/admin/staff` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/staff/calendar` (n/a, 375.2 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/staff/calendar` (MISS, 427.3 ms) | `match` |
| `/admin/marketing` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/marketing/dashboard` (n/a, 421.8 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/marketing/dashboard` (MISS, 378.8 ms) | `match` |
| `/admin/staff/phase2-contract-placeholder` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/chats` (n/a, 370.8 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/chats` (MISS, 398.4 ms) | `match` |
| `/admin/marketing/phase2-contract-placeholder` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/chats` (n/a, 1045.3 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/chats` (MISS, 406.8 ms) | `match` |
| `/admin/phase2-contract-placeholder` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/chats` (n/a, 394.1 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/chats` (MISS, 389.2 ms) | `match` |
| `/admin/receipt` | GET | `src/proxy.ts` | `pass` 307 -> `/admin/chats` (n/a, 476 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/admin/chats` (MISS, 381.9 ms) | `match` |
| `/rooms/phase2-contract-placeholder` | GET | `src/app/[locale]/rooms/[id]/page.tsx` | `pass` 404 (MISS, 716 ms) | title="Auralis Cove Retreat - Luxury Villas in Koh Samu"; robots=noindex; no-js=error-page | `pass` 404 (MISS, 448.1 ms) | `match` |
| `/th/rooms/phase2-contract-placeholder` | GET | `src/app/[locale]/rooms/[id]/page.tsx` | `pass` 404 (MISS, 671.8 ms) | title="Auralis Cove Retreat - วิลล่าหรูใน Koh Samui, Th"; robots=noindex; no-js=error-page | `pass` 404 (MISS, 421.3 ms) | `match` |
| `/xx/rooms/pool-villa` | GET | `src/app/[locale]/layout.tsx` | `pass` 404 (MISS, 1894.1 ms) | lang=en; title="404: This page could not be found."; no-js=error-page; h1="404"(visible) | `pass` 404 (MISS, 410.8 ms) | `match` |
| `/xx/services` | GET | `src/app/[locale]/layout.tsx` | `pass` 404 (MISS, 733.9 ms) | lang=en; title="404: This page could not be found."; no-js=error-page; h1="404"(visible) | `pass` 404 (MISS, 434 ms) | `match` |
| `/th/rooms/pool-villa?tour=1` | GET | `src/app/[locale]/rooms/[id]/page.tsx` | `pass` 200 (MISS, 677.5 ms) | lang=th; title="Tideglass Pool Residence — Auralis Cove Retreat"; no-js=suspense-fallback-with-hidden-content; h1="Tideglass Pool Residence"(hidden); fallback="กำลังโหลดวิลล่า..."(visible) | `pass` 200 (MISS, 433.3 ms) | `improved` |
| `/en/rooms/pool-villa?tour=1` | GET | `src/proxy.ts` | `pass` 307 -> `/rooms/pool-villa` (n/a, 370.1 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/rooms/pool-villa` (MISS, 409.5 ms) | `match` |
| `/zh-CN/services` | GET | `src/app/[locale]/services/page.tsx` | `pass` 200 (MISS, 741.5 ms) | lang=zh-CN; title="探索我们的服务" | `pass` 200 (MISS, 418.8 ms) | `match` |
| `/services` (Accept-Language: `th`) | GET | `src/proxy.ts` | `pass` 307 -> `/th/services` (n/a, 386.7 ms) | text/plain; cc=public, max-age=0, must-revalidate | `pass` 307 -> `/th/services` (MISS, 413.6 ms) | `match` |
| `/th/booking/pay` | GET | `src/app/[locale]/booking/pay/page.tsx` | `pass` 200 (MISS, 692 ms) | lang=th; title="ชำระเงินปลอดภัย - Auralis Cove Retreat" | `pass` 200 (MISS, 427.3 ms) | `match` |
| `/r/phase2-contract-placeholder` | GET | `src/proxy.ts` | `pass` 404 (MISS, 729.2 ms) | lang=en; title="404: This page could not be found."; no-js=error-page; h1="404"(visible) | `pass` 404 (MISS, 560.7 ms) | `match` |

## Authenticated staff & anonymous integration fixture

Status: **unavailable**

> Optional Clerk Playwright authenticated fixture not run (requires isolated local integration or Clerk test-tenant run-owned sessions).

## State-changing HTTP contracts (preserved without mutating Preview)

| Contract | Method | Path | Verified by | Live Preview policy |
| --- | --- | --- | --- | --- |
| `contract:api-admin-chat-reply-post` | POST | `/api/admin/chat/reply` | `tests/unit/admin-reply-route.test.ts`, `tests/unit/admin-reply-composer.test.ts` | Read-only GET/HEAD 405 probed on Preview; optional 401/400 validation only on isolated loopback fixture. |
| `contract:api-messaging-image-signed` | GET | `/api/messaging/image?src=...&sig=...` | `tests/unit/messaging-images.test.ts` | Read-only unsigned 403 probed on Preview; signed conversion verified via unit tests. |
| `contract:marketing-short-link-redirect` | GET | `/r/<slug> \| /<slug>` | `tests/unit/marketing-proxy.test.ts`, `tests/unit/marketing-bot.test.ts`, `tests/unit/marketing-slugs.test.ts` | Unknown slug fallthrough (404) probed read-only on Preview; active recordOpen write preserved via unit tests. |
| `contract:authenticated-staff-and-checkout-mutations` | BROWSER+CONVEX | `/admin/checkout, /admin/settings?tab=team, /booking` | `tests/e2e/clerk-auth.spec.ts`, `tests/e2e/booking.spec.ts`, `tests/e2e/public-chat.spec.ts`, `tests/unit/staff-admin-access.test.ts` | Never mutates shared Preview; run via optional Clerk Playwright fixture inside scripts/local-integration.mjs. |

## Measurements collected separately

| Field | Status | Why unavailable here | Required protocol | Owner |
| --- | --- | --- | --- | --- |
| `controlledCacheHitMiss` | `unavailable` | Uncontrolled single-probe Preview requests cannot isolate cache hits from misses. | 100 verified hits + 100 verified misses per build in the same region with explicit eviction/namespace rotation. | Separate room performance & cache report |
| `pairedTtfbP95Gate` | `unavailable` | Single wire TTFB samples per route are descriptive only and not a paired cadence gate. | 100 matched direct requests per build at the same cadence; candidate p95 within +5% of baseline. | Separate room performance & cache report |
| `naturalCacheHitRatio` | `unavailable` | Natural hit ratio requires replaying an identical request sequence over the 60 s TTL window. | Matched request replay with <= 2 percentage point cache-hit loss. | Separate room performance & cache report |
| `previewOutageRecovery` | `unavailable` | Outage recovery requires a controlled failure of live backend reads after the 60 s cache entry expires. | Verify warm last-good fallback, 30 s retry backoff, cold retriable error, archive 404, and reactivation refresh. | Separate room performance & cache report + tests/unit/villa-server.test.ts |
| `browserBundleAndTourPerf` | `unavailable` | Client bundle budgets and mobile 360 tour drag-to-frame latency are measured by browser/manifest benchmarks. | Route JS size manifest reporter (Brotli + gzip budgets) and paired mobile 360 tour-entry runs. | docs/plans/benchmarks/tour-entry.md & scripts/bench/route-js-size.mjs |

## Reproduce

```sh
# 1. Re-render pre-change report from verified local reference control JSON
node scripts/bench/start-route-parity.mjs \
  --control-input <path/to/preview-control/routes.json> \
  --json docs/plans/benchmarks/start-routes.json \
  --md docs/plans/benchmarks/start-routes.md

# 2. Run read-only room-slice parity against immutable Next & Start Preview deployments
node scripts/bench/start-route-parity.mjs \
  --scope room-slice \
  --control-deployment <next-dpl-id> --control-scope <vercel-scope> \
  --candidate-deployment <start-dpl-id> --candidate-scope <vercel-scope> \
  --strict --json output/start-routes-room.json --md output/start-routes-room.md

# 3. Run full 32-page + 3-handler + special-route parity against Start Preview
node scripts/bench/start-route-parity.mjs \
  --scope full \
  --control-input docs/plans/benchmarks/start-routes.json \
  --candidate-deployment <start-dpl-id> --candidate-scope <vercel-scope> \
  --strict --json docs/plans/benchmarks/start-routes.json --md docs/plans/benchmarks/start-routes.md

# 4. Optional authenticated Clerk Playwright integration fixture (isolated local backend)
export VITEST_MAX_WORKERS=2
node scripts/heavy.mjs node scripts/local-integration.mjs -- \
  node scripts/bench/start-route-parity.mjs --scope full --control-url "$E2E_BASE_URL" --auth-fixture \
  --include-safe-post-validation --json output/start-routes-local-auth.json --md output/start-routes-local-auth.md
```
