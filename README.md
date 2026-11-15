# 360 Tour

Immersive direct-booking site for boutique resort stays, combining villa pages, 360-degree tours, booking flows, concierge chat, and admin operations.

Production: https://tour.helpgueststay.com

## Stack

- Next.js App Router
- Convex backend functions and data
- Vercel deployment
- Clerk-powered admin access
- React Three Fiber and Three.js for 360 tour experiences

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dev                 # persistent isolated local Convex + Next; configure .env.dev.local
pnpm check:fast          # TS 7 types + typed oxlint + cached untyped ESLint
pnpm lint                # untyped ESLint, zero warnings + typed oxlint
pnpm knip
pnpm verify:integration  # isolated local backend + real Clerk test tenant
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, the feature recipe and current validation. Node 22 is required; use `VITEST_MAX_WORKERS=2` locally. Full verification, unit suites, builds and E2E commands share a three-slot machine queue; nested commands reuse the slot. Seed commands are for a deliberately selected empty disposable backend, never an existing shared database.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment variables, release flow, and production verification details.

Follow the [admin UX conventions](./docs/guides/admin-ux.md) when changing staff screens. Generated screenshots and temporary UX review output stay local, outside the tracked source tree.

`pnpm dev` starts an isolated persistent checkout-local Convex and Next together, seeds only an empty backend, and retains data on Ctrl-C/restart. Configure only real Clerk test fields and explicit local owners in mode-600 `.env.dev.local`. See the [local development and Preview runbook](./docs/architecture/phase3f-operations.md) for configuration, recovery and `pnpm test:dev` lifecycle acceptance.

`pnpm test:e2e` starts and seeds a fresh isolated local Convex backend, builds the app, signs in dedicated Clerk test users, and stops its processes and new sessions afterward. Supply the three Clerk test fields from `.env.example` through the environment or an ignored `.env.e2e.local` file (mode `600`). Production Clerk keys are refused. `pnpm verify:integration` also runs the full verification and component browser suite. See the [Phase 3d implementation record](./docs/architecture/phase3d-dataflow-implementation.md) for auth evidence and CI secret names.

`pnpm test:pure`, `pnpm test:dom <file>`, `pnpm test:convex <file>` and `pnpm test:guards` focus the four Vitest projects. Guards run serially with a 60-second default timeout. `pnpm test:unit` preserves full default coverage.
