# Production Deployment

This project deploys as a Next.js App Router app on Vercel with Convex for backend data and functions. Clerk is used for the admin area when configured, AI chat uses Convex environment variables, and checkout is currently no-card/demo only. Stripe is not active in the current runtime.

## Current Production Shape

- Public resort pages, localized routes, villa detail pages, room galleries, pricing, reviews, and 360 tour entry points.
- Booking funnel with Convex-backed live inventory when production Convex is configured and seeded.
- Demo checkout fallback at `bookingId=demo`; this confirms locally and does not charge a card.
- Live Convex bookings are created as pending bookings with secure access tokens. Public live payment confirmation is not wired to a real payment provider.
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

Most production environment variables are already in place. The only item still called out for follow-up is owner/admin notification email configuration.

### Vercel Environment Variables

Set these in Vercel Production and Preview:

| Name | Required | Notes |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Yes | Required by `pnpm vercel-build`. Use the correct Convex deploy key for each Vercel environment. |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Usually injected by `convex deploy`; keep a placeholder only if Vercel requires the key before first deploy. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes for admin | Enables Clerk UI and admin sign-in. Do not use `placeholder` in production if admin should work. |
| `LINE_CHANNEL_SECRET` | Yes for LINE auto-replies | LINE Developers Console -> Messaging API channel -> Basic settings -> Channel secret. |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes for LINE auto-replies | LINE Developers Console -> Messaging API channel -> Messaging API -> Channel access token. |
| `FACEBOOK_ACCESS_TOKEN` | Yes for Facebook Messenger auto-replies | Meta Developers -> Messenger API settings -> Generate access tokens -> Page access token. |
| `FACEBOOK_PAGE_ID` | Yes for Facebook Messenger setup | Meta Developers -> Messenger API settings -> connected Page ID. |
| `FACEBOOK_VERIFY_TOKEN` | Yes for Facebook Messenger webhook verification | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `FACEBOOK_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `INSTAGRAM_ACCESS_TOKEN` | Yes for Instagram auto-replies | Instagram Messaging API access token with permission to send messages. |
| `INSTAGRAM_VERIFY_TOKEN` | Yes for Instagram webhook verification | Custom secret you create; must exactly match the Meta webhook Verify token field. |
| `INSTAGRAM_GRAPH_API_VERSION` | No | Defaults to `v25.0`; set only when intentionally pinning another supported Graph API version. |
| `INSTAGRAM_APP_ID` | No for v1 webhook handling | Configured for Meta app reference; not used by the webhook route yet. |
| `INSTAGRAM_APP_SECRET` | No for v1 webhook handling | Configured for Meta app reference; not used by the webhook route yet. |
| `SITE_URL` | Yes for LINE auto-replies | Use `https://tour.helpgueststay.com` in production so LINE replies include production links. |

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
| `RESEND_API_KEY` | No | Required only for email actions. |
| `OWNER_NOTIFICATION_EMAIL` | Follow-up | Needed for owner/admin notification emails. The email action exists, but automatic booking notification is not currently wired into the booking flow. |

Convex environment variables can be managed in the Convex dashboard or with:

```sh
npx convex env set NAME value
```

There is currently no `ALLOW_DEMO_PAYMENTS` environment variable in the codebase. Do not add it in Vercel or Convex expecting it to change checkout behavior.

## Payment Mode

Production does not process real card payments right now.

- `bookingId=demo` checkout confirms locally and is safe for no-card demos.
- Live Convex bookings can be created and viewed with their access token, but the pay page disables public confirmation for non-demo booking IDs.
- `markPaidFromTrustedWebhook` exists as an internal Convex mutation for a future trusted webhook or admin path.
- Stripe variables in `.env.example` are placeholders for future production checkout only.

If the production goal is a full no-card confirmation for live Convex bookings, that needs a code change. No existing env var enables it today.

## Production Data

After the first production deployment, seed the production Convex deployment once:

```sh
pnpm seed
```

`seed:seedAll` is idempotent and exits with `already_seeded` if properties already exist.

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
- Live Convex booking creates a pending booking with a secure token.
- `/admin` requires Clerk sign-in and only allowlisted admin emails can load chat sessions.
- Chat opens and returns either AI or fallback content.
- Mobile layout has no visible overlap in hero, booking, chat, or 360 tour views.
