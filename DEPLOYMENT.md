# Vercel Demo Deployment

This project now ships as a Next.js App Router app with Convex for backend data/functions, optional Clerk auth, optional AI chat, and an explicitly demo-only checkout fallback. The legacy SvelteKit files remain in the repo as migration reference material, but they are not the active deployment target.

## What Ships

- Resort marketing pages with villa cards, media hero, amenities, reviews, and contact details.
- Villa detail pages with image galleries, pricing comparisons, direct-booking benefits, trust badges, and 360 tour entry points.
- 360 room tour with sphere imagery and room navigation hotspots.
- Booking funnel with villa/date/guest/details/review steps, Convex-backed availability when seeded, secure booking access tokens, and client-only demo mode when live inventory is unavailable.
- Demo payment flow that confirms verified live bookings through Convex or stays local for `bookingId=demo`.
- Concierge chat backed by Convex, with Grok-powered multilingual AI responses when configured and static fallback responses when no AI key is present.
- Optional Clerk sign-in/sign-up screens. Keep Clerk disabled for demo launch unless production auth is configured.

## Vercel Project Settings

Use these settings in the Vercel project:

- Framework preset: `Next.js`
- Install command: `pnpm install`
- Build command: `pnpm vercel-build`
- Output directory: leave unset

`pnpm vercel-build` runs:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build'
```

This deploys Convex functions first, injects the Convex deployment URL into `NEXT_PUBLIC_CONVEX_URL`, and then builds the Next.js frontend against that backend.

## Environment Variables

Set these in Vercel:

| Name | Environment | Required | Notes |
| --- | --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Production, Preview | Yes | Generate from the Convex dashboard. Use a production key for production and a preview key for preview deployments. |
| `NEXT_PUBLIC_CONVEX_URL` | Production, Preview | Yes | Usually injected by `convex deploy`; keep a placeholder only if Vercel requires the key to exist before first deploy. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production, Preview | No | Use `placeholder` or omit to keep auth disabled for demo launch. |
| `AI_API_KEY` | Convex deployment | No | xAI API key. Enables live Grok concierge responses. Without it, the app uses localized fallback responses where available. |
| `AI_API_BASE_URL` | Convex deployment | No | Set to `https://api.x.ai/v1` for xAI. |
| `AI_SIMPLE_MODEL` | Convex deployment | No | Set to `grok-4.3`. |
| `AI_COMPLEX_MODEL` | Convex deployment | No | Set to `grok-4.3`. |
| `RESEND_API_KEY` | Convex deployment | No | Reserved for transactional email actions. |
| `OWNER_NOTIFICATION_EMAIL` | Convex deployment | No | Used with Resend owner notification actions. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex deployment | No | Required only if enabling Clerk auth. |
| `ADMIN_EMAILS` | Convex deployment | No | Comma-separated Clerk account emails allowed to open `/admin/chat`; required for the admin chat dashboard. |

Convex environment variables are managed in the Convex dashboard or with `npx convex env set NAME value`.

For multilingual chat, configure Convex with:

```sh
npx convex env set AI_API_BASE_URL https://api.x.ai/v1
npx convex env set AI_SIMPLE_MODEL grok-4.3
npx convex env set AI_COMPLEX_MODEL grok-4.3
npx convex env set AI_API_KEY <xAI key>
```

Grok detects the visitor's latest message language and replies in that language. Static website and chat UI copy uses `next-intl`; Google Translate is not part of the v1 runtime.

If Vercel fails with `Vercel build environment detected but no Convex deployment configuration found`, add `CONVEX_DEPLOY_KEY` to the Vercel project for the environment being deployed, then redeploy. The build-script warnings from pnpm are not the cause of that failure.

## Seeding Data

After the first production deployment, seed the production Convex deployment once:

```sh
pnpm seed
```

For preview deployments that should get fresh demo data automatically, change the Vercel build command to:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build' --preview-run seed:seedAll
```

`seed:seedAll` is idempotent: it exits with `already_seeded` if properties already exist.

## Demo Boundaries

- Checkout is demo-only when Convex is absent or live inventory cannot load. No real card is processed.
- Live Convex bookings require a booking access token in pay/success URLs before they can be displayed.
- Live payment confirmation must happen through a trusted payment webhook or authenticated admin path, not from the browser checkout page.
- Stripe variables in `.env.example` are future production-checkout placeholders only.
- Booking confirmations happen in-app via the success page. Legacy Svelte PDF download flows are not active in the Next.js app.

## Legacy SvelteKit Files

Legacy SvelteKit routes, components, stores, and config now live under `archive/sveltekit-prototype`. The active app is Next/React only; do not target the archive for new product work unless a separate restoration project explicitly changes that decision.

## Verification

Run before pushing:

```sh
pnpm verify
```

Smoke-test the deployed preview:

- Home page loads and hero media plays.
- Villa pages open and image galleries render.
- 360 viewer opens, shows a non-blank sphere, and closes cleanly.
- Chat opens and either replies with AI or fallback content.
- Booking cannot advance to Pay until dates, guest count, and guest details are valid.
- Live booking creates a pending Convex booking and includes a secure token in the payment URL.
- Demo payment only runs for `bookingId=demo`.
- Success page verifies paid live bookings before displaying confirmation.
- Mobile layout has no visible overlap in hero, booking, chat, or 360 tour views.
