# Production Deployment

This project deploys as a Next.js App Router app on Vercel with Convex for backend data and functions. Clerk is used for the admin area when configured, AI chat uses Convex environment variables, and live checkout uses Stripe when the Convex payment secrets are configured. The standalone `bookingId=demo` route remains a no-card UI demonstration.

## Current Production Shape

- Public resort pages, localized routes, villa detail pages, room galleries, pricing, reviews, and 360 tour entry points.
- Booking funnel with Convex-backed live inventory when production Convex is configured and seeded.
- Demo checkout fallback at `bookingId=demo`; this confirms locally and does not charge a card.
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

`pnpm vercel-build` runs:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build'
```

That command deploys Convex functions first, injects the Convex deployment URL into `NEXT_PUBLIC_CONVEX_URL`, then builds the Next.js frontend against that backend.

## Environment Variables

Verify every variable in the actual Vercel and Convex deployments before launch. This repository does not contain production secret values.

Vercel name audit on 24 September 2026: Production and Preview both list `INSTAGRAM_APP_SECRET`, but neither lists `FACEBOOK_APP_SECRET`, `WHATSAPP_APP_SECRET`, or `META_APP_SECRET`. Facebook and WhatsApp POST webhooks will return 500 until the matching Meta app secret is added to those environments and redeployed. This audit checked variable names, not secret values or live webhook delivery.

Convex production name audit on the same date: `RESEND_API_KEY` is present, while `EMAIL_FROM`, `OWNER_NOTIFICATION_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `SITE_URL` are absent. Booking emails and live Stripe Checkout remain disabled there until those values are configured. Secret contents were not read.

### Vercel Environment Variables

Set these in Vercel Production and Preview:

| Name | Required | Notes |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Yes | Required by `pnpm vercel-build`. Use the correct Convex deploy key for each Vercel environment. |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Usually injected by `convex deploy`; keep a placeholder only if Vercel requires the key before first deploy. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Optional | Convex HTTP origin for the OTA export URL shown in admin. If omitted, the app derives it from `NEXT_PUBLIC_CONVEX_URL`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes for admin | Enables Clerk UI and admin sign-in. Do not use `placeholder` in production if admin should work. |
| `LINE_CHANNEL_SECRET` | Yes for LINE auto-replies | LINE Developers Console -> Messaging API channel -> Basic settings -> Channel secret. |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes for LINE auto-replies | LINE Developers Console -> Messaging API channel -> Messaging API -> Channel access token. |
| `FACEBOOK_ACCESS_TOKEN` | Yes for Facebook Messenger auto-replies | Meta Developers -> Messenger API settings -> Generate access tokens -> Page access token. |
| `FACEBOOK_PAGE_ID` | Yes for Facebook Messenger setup | Meta Developers -> Messenger API settings -> connected Page ID. |
| `FACEBOOK_VERIFY_TOKEN` | Yes for Facebook Messenger webhook verification | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `FACEBOOK_APP_SECRET` or `META_APP_SECRET` | Yes for Facebook Messenger POST events | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `FACEBOOK_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `WHATSAPP_ACCESS_TOKEN` | Yes for WhatsApp replies | Meta WhatsApp Cloud API token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes for WhatsApp replies | The WhatsApp Business phone number ID. |
| `WHATSAPP_VERIFY_TOKEN` | Yes for WhatsApp webhook verification | Custom token matching the Meta webhook subscription. |
| `INSTAGRAM_ACCESS_TOKEN` | Yes for Instagram auto-replies | Instagram Messaging API access token with permission to send messages. |
| `INSTAGRAM_VERIFY_TOKEN` | Yes for Instagram webhook verification | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `INSTAGRAM_APP_SECRET` or `META_APP_SECRET` | Yes for Instagram POST events | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `INSTAGRAM_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `INSTAGRAM_APP_ID` | No for v1 webhook handling | Configured for Meta app reference; not used by the webhook route yet. |

| `WHATSAPP_APP_SECRET` or `META_APP_SECRET` | Yes for WhatsApp POST events | Meta app secret used to verify the `X-Hub-Signature-256` header. |
| `SITE_URL` | Yes | Canonical public origin, for example `https://tour.helpgueststay.com`; used for links, sitemap, and metadata. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional | Enables consent-based page view analytics. Configure `NEXT_PUBLIC_POSTHOG_HOST` for the project's region. |
| `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` | Optional | Enable server and browser error reporting. |

### Convex Environment Variables

Set these in the Convex production deployment:

| Name | Required | Notes |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes for admin | Required for Convex to validate Clerk tokens. |
| `ADMIN_EMAILS` | Yes for admin | Comma-separated allowlist for `/admin`, for example `owner@example.com,manager@example.com`. |
| `AI_API_KEY` | No | Enables live AI concierge responses. |
| `AI_API_BASE_URL` | No | Use `https://api.x.ai/v1` for xAI. |
| `AI_SIMPLE_MODEL` | No | Current expected value is `grok-4.3`. |
| `AI_COMPLEX_MODEL` | No | Current expected value is `grok-4.3`. |
| `RESEND_API_KEY` | Yes for booking email | Resend API key; verify the sending domain before launch. |
| `EMAIL_FROM` | Yes for booking email | Sender address at a verified Resend domain, for example `Auralis Cove <bookings@your-domain.com>`. |
| `STRIPE_SECRET_KEY` | Yes for live payments | Stripe secret API key; keep in Convex, never in a public variable. |
| `STRIPE_WEBHOOK_SECRET` | Yes for live payments | Signing secret for the Convex webhook endpoint. |
| `SITE_URL` | Yes for live payments | Canonical public site origin for Stripe return URLs. |
| `OWNER_NOTIFICATION_EMAIL` | Yes for owner email | Recipient for automatic notifications after booking confirmation. |

Convex environment variables can be managed in the Convex dashboard or with:

```sh
npx convex env set NAME value
```

## Payment Mode

- The standalone `bookingId=demo` UI does not create a booking or charge a card.
- Live bookings hold dates during card checkout. The signed `checkout.session.completed` event confirms the booking only when Stripe reports `paid` and the session, amount, and currency match. Expired checkouts release their holds; full Stripe refunds cancel and release the booking.
- Set a Stripe webhook destination to `https://YOUR-CONVEX-DEPLOYMENT.convex.site/stripe/webhook` and subscribe to `checkout.session.completed`, `checkout.session.expired`, and `charge.refunded`. Use the destination's signing secret in Convex.
- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `SITE_URL` in the production Convex deployment. Do not activate live payment for demonstration inventory.
- `RESEND_API_KEY`, `EMAIL_FROM`, and `OWNER_NOTIFICATION_EMAIL` enable guest and owner notices after confirmation. A missing email setting is logged; it does not mark a payment failed.

## OTA calendars

- An allowlisted admin adds each Airbnb, Booking.com, or Agoda HTTPS iCal URL in **Admin → Hotel bookings → OTA calendars**. The Convex cron imports all-day date events every 30 minutes and records `lastSyncedAt` or `lastSyncError` on each source.
- Generate the export URL for each villa in the same admin dialog, then provide it to the OTA. Treat the token in the URL as a secret and rotate it if disclosed.
- Check source errors and cross-channel conflicts after initial import. OTA polling is delayed; verify availability before accepting an offline or manual payment.

## Production Data

After the first production deployment, seed the production Convex deployment once:

```sh
pnpm seed
```

`seed:seedAll` is idempotent and exits with `already_seeded` if properties already exist.

To add the demo staff, services and sample appointments to a deployment that was seeded earlier, run `npx convex run seed:seedStaffServices` (internal, also idempotent).

For Preview deployments that should get fresh demo data automatically, change the Vercel build command to:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build' --preview-run seed:seedAll
```

## Admin Setup

To enable `/admin`:

1. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Vercel.
2. Configure the Clerk `convex` JWT template.
3. Set `CLERK_JWT_ISSUER_DOMAIN` in Convex.
4. Set `ADMIN_EMAILS` in Convex with the exact Clerk account email addresses allowed to access the dashboard.

If Clerk is missing or set to `placeholder`, `/admin` shows the setup state. If Clerk is enabled but Convex cannot validate the token, the admin dashboard shows the Convex auth setup warning.

## LINE Webhook

After deploying production, set the LINE Developers Console webhook URL to:

```txt
https://tour.helpgueststay.com/api/line/webhook
```

For local testing without LINE Console, send signed `POST` requests to:

```txt
http://localhost:3000/api/line/webhook
```

For LINE Console verification against local development, expose the local app through a tunnel and use:

```txt
https://<your-ngrok-domain>/api/line/webhook
```

For the full LINE automation audit checklist, including LINE OA response settings, token checks, customer link checks, and production smoke tests, see [LINE_AUTOMATION_AUDIT.md](./LINE_AUTOMATION_AUDIT.md).

## Facebook Messenger Webhook

After deploying production, set the Meta Developers Messenger webhook to:

```txt
https://tour.helpgueststay.com/api/facebook/webhook
```

Use the exact Vercel `FACEBOOK_VERIFY_TOKEN` value in Meta's **Verify token** field. Keep **Attach a client certificate to Webhook requests** turned off unless the webhook code is explicitly extended to validate client certificates.

After **Verify and save** succeeds, add subscriptions for:

```txt
messages
messaging_postbacks
```

For a quick production verification, this URL should return plain `hello` when the token matches:

```txt
https://tour.helpgueststay.com/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=<FACEBOOK_VERIFY_TOKEN>&hub.challenge=hello
```

## WhatsApp Webhook

After deploying production, set the Meta Developers WhatsApp webhook to:

```txt
https://tour.helpgueststay.com/api/whatsapp/webhook
```

Use the exact Vercel `WHATSAPP_VERIFY_TOKEN` value in Meta's **Verify token** field. Keep **Attach a client certificate to Webhook requests** turned off unless the webhook code is explicitly extended to validate client certificates.

For a quick production verification, this URL should return plain `hello` when the token matches:

```txt
https://tour.helpgueststay.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=hello
```

## Instagram Webhook

After deploying production, set the Meta Developers Instagram webhook to:

```txt
https://tour.helpgueststay.com/api/instagram/webhook
```

Use the exact Vercel `INSTAGRAM_VERIFY_TOKEN` value in Meta's **Verify token** field. Keep **Attach a client certificate to Webhook requests** turned off unless the webhook code is explicitly extended to validate client certificates.

After **Verify and save** succeeds, add subscriptions for:

```txt
messages
messaging_postbacks
```

For a quick production verification, this URL should return plain `hello` when the token matches:

```txt
https://tour.helpgueststay.com/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=<INSTAGRAM_VERIFY_TOKEN>&hub.challenge=hello
```

## Deployment

Deploy with the Vercel Git integration or with:

```sh
vercel deploy --prod
```

If Vercel fails with `Vercel build environment detected but no Convex deployment configuration found`, add or refresh `CONVEX_DEPLOY_KEY` for that Vercel environment and redeploy.

## Verification

Run before shipping:

```sh
pnpm verify
```

Smoke-test production after deploy:

- Home page loads and hero media plays.
- Localized routes load.
- Villa pages open and galleries render.
- 360 viewer opens, shows a non-blank sphere, and closes cleanly.
- Booking funnel validates dates, guests, and guest details.
- Demo checkout with `bookingId=demo` reaches the success page and does not charge a card.
- Live Convex booking redirects to Stripe Checkout; a signed test webhook marks it paid and queues both emails.
- Invalid Stripe and Meta webhook signatures are rejected.
- OTA imports block dates and the export feed includes confirmed bookings.
- `/admin` requires Clerk sign-in and only allowlisted admin emails can load chat sessions.
- Chat opens and returns either AI or fallback content.
- Mobile layout has no visible overlap in hero, booking, chat, or 360 tour views.
