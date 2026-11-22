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

`bun run dev` starts an isolated persistent checkout-local Convex and Next together, seeds only an empty backend, and retains data on Ctrl-C/restart. Configure only real Clerk test fields and explicit local owners in mode-600 `.env.dev.local`. See the [local development and Preview runbook](./docs/architecture/phase3f-operations.md) for configuration, recovery and `bun run test:dev` lifecycle acceptance.

`bun run test:e2e` starts and seeds a fresh isolated local Convex backend, builds the app, signs in dedicated Clerk test users, and stops its processes and new sessions afterward. Supply the three Clerk test fields from `.env.example` through the environment or an ignored `.env.e2e.local` file (mode `600`). Production Clerk keys are refused. `bun run verify:integration` also runs the full verification and component browser suite. See the [Phase 3d implementation record](./docs/architecture/phase3d-dataflow-implementation.md) for auth evidence and CI secret names.

`bun run test:pure`, `bun run test:dom <file>`, `bun run test:convex <file>` and `bun run test:guards` focus the four Vitest projects. Guards run serially with a 60-second default timeout. `bun run test:unit` preserves full default coverage.
