# Vercel Demo Deployment

This project is prepared for a demo launch on Vercel. It uses SvelteKit with the Vercel adapter, Convex for backend data/functions, optional Clerk auth, optional AI chat, and an explicitly demo-only checkout.

## What Ships

- Resort marketing pages with villa cards, media hero, amenities, reviews, and contact details.
- Villa detail pages with image galleries, pricing comparisons, direct-booking benefits, trust badges, recent booking proof, and 360 tour entry points.
- 360 room tour with sphere imagery, room navigation hotspots, and story overlays.
- Booking funnel with villa/date/guest/details/review steps, Convex-backed availability when seeded, and demo fallback inventory when live data is unavailable.
- Demo payment flow with fake card entry, booking confirmation, and downloadable invoice/receipt PDFs.
- Concierge chat backed by Convex, with AI responses when configured and static fallback responses when no AI key is present.
- Optional Clerk sign-in/sign-up screens. Keep Clerk disabled for demo launch unless production auth is configured.

## Vercel Project Settings

Use these settings in the Vercel project:

- Framework preset: `SvelteKit`
- Install command: `pnpm install`
- Build command: `pnpm vercel-build`
- Output directory: leave unset

`pnpm vercel-build` runs:

```sh
npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd 'pnpm build'
```

This deploys Convex functions first, injects the Convex deployment URL into `PUBLIC_CONVEX_URL`, and then builds the SvelteKit frontend against that backend.

## Environment Variables

Set these in Vercel:

| Name | Environment | Required | Notes |
| --- | --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Production, Preview | Yes | Generate from the Convex dashboard. Use a production key for production and a preview key for preview deployments. |
| `PUBLIC_CONVEX_URL` | Production, Preview | Yes | Usually injected by `convex deploy`; keep a placeholder only if Vercel requires the key to exist before first deploy. |
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | Production, Preview | Yes | Use `placeholder` to keep auth disabled for demo launch. |
| `AI_API_KEY` | Convex deployment | No | Enables live AI concierge responses. Without it, the app uses fallback responses. |
| `AI_API_BASE_URL` | Convex deployment | No | Defaults to `https://api.openai.com/v1`. |
| `AI_SIMPLE_MODEL` | Convex deployment | No | Defaults to `gpt-4o-mini`. |
| `AI_COMPLEX_MODEL` | Convex deployment | No | Defaults to `gpt-4o`. |
| `RESEND_API_KEY` | Convex deployment | No | Reserved for transactional email actions. |
| `OWNER_NOTIFICATION_EMAIL` | Convex deployment | No | Used with Resend owner notification actions. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex deployment | No | Required only if enabling Clerk auth. |

Convex environment variables are managed in the Convex dashboard or with `npx convex env set NAME value`.

## Seeding Data

After the first production deployment, seed the production Convex deployment once:

```sh
pnpm seed
```

For preview deployments that should get fresh demo data automatically, change the Vercel build command to:

```sh
npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd 'pnpm build' --preview-run seed:seedAll
```

`seed:seedAll` is idempotent: it exits with `already_seeded` if properties already exist.

## Demo Boundaries

- Checkout is demo-only. No real card is processed, and the payment screen says this clearly.
- Stripe variables in `.env.example` are future production-checkout placeholders only.
- Booking confirmations happen in-app via the success page and PDF downloads. Email actions are optional and not required for this demo launch.
- Global SSR remains disabled for this release to avoid reopening browser-only 360 viewer and client SDK boundaries.

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
- Booking creates a pending Convex booking.
- Demo payment confirms the booking.
- Success page downloads invoice and receipt PDFs.
- Mobile layout has no visible overlap in hero, booking, chat, or 360 tour views.
