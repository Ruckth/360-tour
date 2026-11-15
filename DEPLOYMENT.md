# Production Deployment

This project deploys as a Next.js App Router app on Vercel with Convex for backend data and functions. Clerk configuration is required by the app and protects the admin area, AI chat uses Convex environment variables, and live checkout uses Stripe when the Convex payment secrets are configured. Missing backend/auth configuration fails clearly; the old demo checkout was removed in Phase 3d.

## Current Production Shape

- Public resort pages, localized routes, villa detail pages, room galleries, pricing, reviews, and 360 tour entry points.
- Booking funnel with Convex-backed live inventory when production Convex is configured and seeded.
- Live Convex bookings start pending. Stripe Checkout creates a hosted payment session; only the signed Stripe webhook confirms a paid booking. Unpaid requests expire after 24 hours.
- Concierge chat uses Convex. If AI env vars are present, responses use the configured xAI/OpenAI-compatible endpoint; otherwise the app falls back to static localized replies.
- Admin chat dashboard uses Clerk plus Convex JWT validation and `ADMIN_EMAILS` allowlisting.

## Vercel Project Settings

Use these settings in the Vercel project:

| Setting | Value |
| --- | --- |
| Framework preset | `Next.js` |
| Install command | `pnpm install` |
| Build command | `pnpm vercel-build` |
| Output directory | Leave unset |

`pnpm vercel-build` runs the guarded [Phase 3f build workflow](docs/architecture/phase3f-operations.md). Preview claims/reuses the project-scoped branch backend, captures its URL without building, deploys Convex, verifies the authorized branch target, seeds only an empty database, then builds Next with that URL. A populated Preview is retained on every push/rebuild. Production retains the existing `convex deploy --cmd 'pnpm build'` path with an explicit production-key guard and never seeds.

Ordering matters: installed Convex 1.34.1 runs `--cmd` **before** its backend push, and `--preview-run` afterward. The previous combined command could cache an empty catalog on a fresh Preview; simply adding `--preview-run` does not fix that order. Root owns Preview key/default configuration and actual live acceptance.

## Environment Variables

Verify every variable in the actual Vercel and Convex deployments before launch. This repository does not contain production secret values.

### Vercel Environment Variables

Set these in Vercel Production and Preview. Social ingress signatures and verification tokens are configured in Convex. The website config-status screen still reports website-side presence flags; those flags do not prove Convex ingress or provider readiness.

| Name | Required | Notes |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Yes | Required by `pnpm vercel-build`. Use the correct Convex deploy key for each Vercel environment. |
| `MESSAGING_IMAGE_SECRET` | For social card images | Dedicated image-conversion signing key, shared with Convex. It does not authenticate webhook functions. |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Injected by `convex deploy`; use an actual deployment URL. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Optional | Convex HTTP origin for the OTA export URL shown in admin. If omitted, the app derives it from `NEXT_PUBLIC_CONVEX_URL`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Required Clerk UI/provider configuration for the application. |
| `LINE_CHANNEL_SECRET` | Website config-status mirror only | LINE Developers Console -> Messaging API channel -> Basic settings -> Channel secret. |
| `LINE_CHANNEL_ACCESS_TOKEN` | For website staff replies | LINE Developers Console -> Messaging API channel -> Messaging API -> Channel access token. |
| `FACEBOOK_ACCESS_TOKEN` | For website staff replies | Meta Developers -> Messenger API settings -> Generate access tokens -> Page access token. |
| `FACEBOOK_PAGE_ID` | No, provider setup reference | Meta Developers -> Messenger API settings -> connected Page ID. |
| `FACEBOOK_VERIFY_TOKEN` | Website config-status mirror only | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `FACEBOOK_APP_SECRET` or `META_APP_SECRET` | Website config-status mirror only | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `FACEBOOK_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `WHATSAPP_ACCESS_TOKEN` | For website staff replies | Meta WhatsApp Cloud API token. |
| `WHATSAPP_PHONE_NUMBER_ID` | For website staff replies | The WhatsApp Business phone number ID. |
| `WHATSAPP_VERIFY_TOKEN` | Website config-status mirror only | Custom token matching the Meta webhook subscription. |
| `INSTAGRAM_ACCESS_TOKEN` | For website staff replies | Instagram Messaging API access token with permission to send messages. |
| `INSTAGRAM_VERIFY_TOKEN` | Website config-status mirror only | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `INSTAGRAM_APP_SECRET` or `META_APP_SECRET` | Website config-status mirror only | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `INSTAGRAM_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `INSTAGRAM_APP_ID` | No for v1 webhook handling | Configured for Meta app reference; not used by the webhook route yet. |

| `WHATSAPP_APP_SECRET` or `META_APP_SECRET` | Website config-status mirror only | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `SITE_URL` | Yes | Canonical public origin, for example `https://tour.helpgueststay.com`; used for links, sitemap, and metadata. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional | Enables consent-based page view analytics. Configure `NEXT_PUBLIC_POSTHOG_HOST` for the project's region. |
| `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` | Optional | Enable server and browser error reporting. |

### Convex Environment Variables

Set these in the Convex production deployment:

| Name | Required | Notes |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes for admin | Required for Convex to validate Clerk tokens. |
| `ADMIN_EMAILS` | Yes for admin | Comma-separated allowlist for `/admin`, for example `owner@example.com,manager@example.com`. |
| `MESSAGING_IMAGE_SECRET` | For social card images | Match the Vercel image-conversion signing key. No public event mutation accepts a shared secret. |
| `AI_API_KEY` | No | Enables live AI concierge responses. |
| `AI_API_BASE_URL` | No | Use `https://api.x.ai/v1` for xAI. |
| `AI_SIMPLE_MODEL` | No | Current expected value is `grok-4.3`. |
| `AI_COMPLEX_MODEL` | No | Current expected value is `grok-4.3`. |
| `RESEND_API_KEY` | Yes for booking and alert email | Resend API key; verify the sending domain before launch. |
| `EMAIL_FROM` | Yes for booking and alert email | Sender address at a verified Resend domain, for example `Auralis Cove <bookings@your-domain.com>`. |
| `STRIPE_SECRET_KEY` | Yes for live payments | Stripe secret API key; keep in Convex, never in a public variable. |
| `STRIPE_WEBHOOK_SECRET` | Yes for live payments | Signing secret for the Convex webhook endpoint. |
| `SITE_URL` | Yes for live payments and staff alerts | Canonical public site origin for Stripe return URLs and admin chat links. |
| `OWNER_NOTIFICATION_EMAIL` | Yes for owner email | Recipient for booking confirmations and guest handoff alerts. |
| `STAFF_LINE_USER_ID` | Optional | Staff LINE user ID for guest handoff alerts; also set `LINE_CHANNEL_ACCESS_TOKEN` in Convex to enable delivery. |
| `LINE_CHANNEL_ACCESS_TOKEN` | If using staff LINE alerts | Messaging API token used to push alerts to `STAFF_LINE_USER_ID`. |

Convex environment variables can be managed in the Convex dashboard or with:

```sh
npx convex env set --prod NAME value
```

Without `--prod`, the command changes the deployment this checkout is linked to (usually dev).

## Payment Mode

- Live bookings hold dates during card checkout. The signed `checkout.session.completed` event confirms the booking only when Stripe reports `paid` and the session, amount, and currency match. Expired checkouts release their holds; full Stripe refunds cancel and release the booking.
- Set a Stripe webhook destination to `https://YOUR-CONVEX-DEPLOYMENT.convex.site/stripe/webhook` and subscribe to `checkout.session.completed`, `checkout.session.expired`, and `charge.refunded`. Use the destination's signing secret in Convex.
- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `SITE_URL` in the production Convex deployment. Do not activate live payment for demonstration inventory.
- `RESEND_API_KEY`, `EMAIL_FROM`, and `OWNER_NOTIFICATION_EMAIL` enable guest and owner notices after confirmation. A missing email setting is logged; it does not mark a payment failed.

## OTA calendars

- An allowlisted admin adds each Airbnb, Booking.com, or Agoda HTTPS iCal URL in **Admin → Hotel bookings → OTA calendars**. The Convex cron imports all-day date events every 30 minutes and records `lastSyncedAt` or `lastSyncError` on each source.
- Generate the export URL for each villa in the same admin dialog, then provide it to the OTA. Treat the token in the URL as a secret and rotate it if disclosed.
- Check source errors and cross-channel conflicts after initial import. OTA polling is delayed; verify availability before accepting an offline or manual payment.

## Production Data

Seed scenarios are for a deliberately fresh, isolated deployment. They are **not** an upgrade or repair step for a nonempty production, development or Preview database. `maintenance/seed:seedAll` checks every application table and throws `Seed requires an empty database; <table> is not empty` if any contains a record, including when the requested scenario is `empty`. It never clears data or returns `already_seeded`.

After explicitly selecting a new empty local backend, choose `empty`, `demo-resort` (the default) or `busy-weekend`:

```sh
pnpm exec convex run maintenance/seed:seedAll '{"scenario":"demo-resort"}'
```

`pnpm seed` uses this same canonical internal function with the default scenario. There is no `seed:seedStaffServices` endpoint; do not try to add fixtures to an existing deployment. Preview initialization may use the following **only for a fresh empty Preview**; running it again against populated data refuses rather than upgrading it:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build' --preview-run maintenance/seed:seedAll
```

Current local/CI integration and guarded per-PR Preview initialization use the unchanged atomic `maintenance/seed:seedAll` only on their explicitly isolated backend. Its all-table nonempty refusal must never turn into an automatic reset. Current eval/demo scripts use `maintenance/chatEval:*`; fixture administration uses `maintenance/aiEval:seed`, `maintenance/aiEval:cancelTestBookings` and `maintenance/aiEval:cleanup` (the last requires `{"confirm":"AI-EVAL"}`). These are operator-only internal functions, and evaluation tools can still perform business writes.

Before retiring the old operator CLI namespaces, root must stop/drain actual seed/eval producers and inspect relevant stored and inflight jobs, preserving their arguments, tool/payment state and delivery uncertainty. Never replay an ambiguous eval/tool turn or destructive seed. This ownership change does not establish live queue emptiness or model delivery, and introduces no global app traffic gate: public/frontend, HTTP and scheduler names remain stable. See [the maintenance closure record](docs/architecture/phase3b-maintenance-implementation.md) for the complete mapping and operator handoff.

## Admin Setup

To enable `/admin`:

1. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Vercel.
2. Configure the Clerk `convex` JWT template.
3. Set `CLERK_JWT_ISSUER_DOMAIN` in Convex.
4. Set `ADMIN_EMAILS` in Convex with the exact Clerk account email addresses allowed to access the dashboard.

Missing Clerk or Convex configuration refuses app initialization. Configure a matching Clerk issuer and `convex` JWT template with audience `convex`; a signed-in user without a staff grant must still be refused protected operations.

## Social webhook ingress (Phase 2)

The four Next webhook routes are removed. Configure callbacks on the **Convex HTTP site**, not the website. Root owns provider-console migration and secrets. With the parent-verified production mapping, the new URLs are:

| Channel | Production callback |
| --- | --- |
| LINE | `https://wary-toad-189.convex.site/line/webhook` |
| Facebook | `https://wary-toad-189.convex.site/facebook/webhook` |
| Instagram | `https://wary-toad-189.convex.site/instagram/webhook` |
| WhatsApp | `https://wary-toad-189.convex.site/whatsapp/webhook` |

Shared development uses the corresponding `optimistic-turtle-573.convex.site` host. Do not change either deployment from an implementation checkout. Isolated local HTTP actions use the local site's port, separate from the Next website port.

Put `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, each provider's `*_APP_SECRET` (or `META_APP_SECRET`), `*_VERIFY_TOKEN`, `*_ACCESS_TOKEN`, and graph versions in **Convex**. Set Convex `SITE_URL` to the public website origin so confirmation/payment/catalogue links work. WhatsApp stores the signed payload's phone-number ID, with `WHATSAPP_PHONE_NUMBER_ID` as a fallback. `MESSAGING_RICH_CARDS=line,whatsapp` enables cards; `MESSAGING_IMAGE_SECRET` in Convex and Vercel enables JPEG conversion. Existing staff replies still use the authenticated Next admin route, so retain its provider access tokens/graph versions in Vercel until that route moves.

Meta GET verification preserves `hub.mode=subscribe`, `hub.verify_token` and plain `hub.challenge`. Facebook and Instagram subscribe to `messages` and `messaging_postbacks`; WhatsApp subscribes to messages. LINE GET reports endpoint health; signed POST verifies actual durable acceptance. Keep client-certificate webhook attachment disabled unless certificate validation is separately implemented.

Ingress checks the signature against the raw request bytes, then awaits one transaction that deduplicates, records the event/user message and schedules work before returning 200. A failed transaction returns 503 for provider retry. No provider send or AI call runs inside ingress. Stripe and `/ical/export` retain their existing Convex paths and Phase 1 cutoff behavior.

Read [the Phase 2 cutover runbook](docs/architecture/phase2-cutover-runbook.md) before enabling traffic. An uncertain send requires owner reconciliation; replaying the provider webhook cannot cause an automatic duplicate send. LINE push requires explicit reply-token expiry rejection, never local age, a generic invalid/used token, a timeout or a crashed action.

## Deployment

Deploy with the Vercel Git integration or with:

```sh
vercel deploy --prod
```

If Vercel fails with `Vercel build environment detected but no Convex deployment configuration found`, add or refresh `CONVEX_DEPLOY_KEY` for that Vercel environment and redeploy.

## Verification

Run before shipping:

```sh
pnpm verify:integration
pnpm knip
pnpm arch:score --phase 2  # clean committed tree
```

This uses a fresh local Convex and real run-owned Clerk test users. Supply only the three dedicated test fields in ignored mode-600 `.env.e2e.local` or CI; see [ARCHITECTURE.md](ARCHITECTURE.md). Without configuration, offline checks (`pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm test:unit`, scorecard and explicit-base schema comparison) do not invent backend placeholders. Run `pnpm verify` only with actual app configuration. Phase 3f local orchestration, test projects and guarded Preview/retention tooling are implemented; root-owned live Preview acceptance remains pending. See the [operations runbook](docs/architecture/phase3f-operations.md).

After an authorized deployment, root owns live acceptance. Coordinate any external message, payment/refund, seed or reset separately; local integration disables those business providers. Review these flows against the explicitly selected environment:

- Home page loads and hero media plays.
- Localized routes load.
- Villa pages open and galleries render.
- 360 viewer opens, shows a non-blank sphere, and closes cleanly.
- Booking funnel validates dates, guests, and guest details.
- Missing/invalid booking credentials refuse access; removed demo checkout cannot report success.
- Live Convex booking redirects to Stripe Checkout; a signed test webhook marks it paid and queues both emails.
- Invalid Stripe and Meta webhook signatures are rejected.
- OTA imports block dates and the export feed includes confirmed bookings.
- `/admin` requires Clerk sign-in and only allowlisted admin emails can load chat sessions.
- Chat opens and returns either AI or fallback content.
- Mobile layout has no visible overlap in hero, booking, chat, or 360 tour views.
