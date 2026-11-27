# 360 Tour

Immersive direct-booking site for boutique resort stays, combining villa pages, 360-degree tours, booking flows, concierge chat, and admin operations.

Production: https://tour.helpgueststay.com

## Stack

- TanStack Start (React, Vite, Nitro)
- Convex backend functions and data
- Vercel deployment
- Clerk-powered admin access
- React Three Fiber and Three.js for 360 tour experiences

## Commands

Use Bun 1.4.5 (see `.bun-version`) with Node 22.

```sh
bun install --frozen-lockfile
bun run dev                 # persistent isolated local Convex + Next; configure .env.dev.local
bun run check:fast          # TS 7 types + typed oxlint + cached untyped ESLint
bun check                   # public gate with all three TS 7 projects and both linters
bun run knip
bun run verify:integration  # isolated local backend + real Clerk test tenant
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, the feature recipe and current validation. Node 22 is required; use `VITEST_MAX_WORKERS=2` locally. Full verification, unit suites, builds and E2E commands share a three-slot machine queue; nested commands reuse the slot. Seed commands are for a deliberately selected empty disposable backend, never an existing shared database.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment variables, release flow, and production verification details.

Follow the [admin UX conventions](./docs/guides/admin-ux.md) when changing staff screens. Generated screenshots and temporary UX review output stay local, outside the tracked source tree.

`bun run dev` starts checkout-local Convex and TanStack Start together and retains data on Ctrl-C or restart. It seeds only an empty backend, then grants the owners configured in mode-600 `.env.dev.local` via `auth/owners:grantOwner`. Sign in with the configured Clerk test account and activate its grant. See the [local development and Preview runbook](./docs/architecture/phase3f-operations.md) for configuration, recovery and `bun run test:dev` lifecycle acceptance.

`bun run test:e2e` starts and seeds a fresh isolated local Convex backend, builds the app, signs in dedicated Clerk test users, and stops its processes and new sessions afterward. Supply the three Clerk test fields from `.env.example` through the environment or an ignored `.env.e2e.local` file (mode `600`). Production Clerk keys are refused. `bun run verify:integration` also runs the full verification and component browser suite. See the [Phase 3d implementation record](./docs/architecture/phase3d-dataflow-implementation.md) for auth evidence and CI secret names.

`bun run test:pure`, `bun run test:dom <file>`, `bun run test:convex <file>` and `bun run test:guards` focus the four Vitest projects. Guards run serially with a 60-second default timeout. `bun run test:unit` preserves full default coverage.

## Guest tour renderer trial

On a Vercel Preview, open `/rooms/pool-villa?tour=1&tourRenderer=pannellum` to try Pannellum. The control is `/rooms/pool-villa?tour=1`. For the tap and reopen paths, omit `tour=1` and use the room's Explore button. The current viewer handles a failed trial load and full-detail requests. Pannellum displays the source panorama orientation, including scenes the current renderer mirrors. Production URLs always use the current viewer.

When guests opt in to measurement, PostHog records `guest_performance` timings for the first interactive tour frame, the homepage calendar opening, and two booking milestones. Booking durations start when the funnel mounts. The first villa change includes the time the guest spends deciding. The date controls count as ready once mounted and the requested months have loaded. Timing properties exclude URLs, coupon codes, and booking details.

Run the renderer and fallback checks against the seeded local app:

```sh
START_PANNELLUM_TRIAL=1 node scripts/heavy.mjs node scripts/local-integration.mjs -- \
  bun run playwright test tests/e2e/tour-renderer-trial.spec.ts --project=chromium --no-deps
```

For the timed mobile comparison use the same harness with `BENCH_START_WIRE_GZIP=1`. Run the existing `tour-open-interaction` benchmark for each renderer with matching `BENCH_RUNS` and separate `BENCH_OUT` files. Pass `BENCH_TOUR_RENDERER=pannellum` for the trial. Judge the result by a rendered frame that responds to a trusted drag, and check the click and reopen paths as well as the direct link.
