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
pnpm dev                 # requires a deliberately selected configured development backend
pnpm lint                # zero warnings
pnpm knip
pnpm verify:integration  # isolated local backend + real Clerk test tenant
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, the feature recipe and current validation. Node 22 is required; use `VITEST_MAX_WORKERS=4` and serialize Next builds. Seed commands are for a deliberately selected empty disposable backend, never an existing shared database.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment variables, release flow, and production verification details.

`pnpm test:e2e` starts and seeds a fresh isolated local Convex backend, builds the app, signs in dedicated Clerk test users, and stops its processes and new sessions afterward. Supply the three Clerk test fields from `.env.example` through the environment or an ignored `.env.e2e.local` file (mode `600`). Production Clerk keys are refused. `pnpm verify:integration` also runs the full verification and component browser suite. See the [Phase 3d implementation record](./docs/architecture/phase3d-dataflow-implementation.md) for auth evidence and CI secret names.
