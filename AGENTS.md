<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `bun run convex ai-files install`.
<!-- convex-ai-end -->

## Architecture

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing application code. It documents domain ownership, pure shared rules, access builders, the table/endpoint/admin-page recipe and current validation commands. Focused tests may intentionally import private implementations; production code must use the documented model interfaces.

## Checks and parallel agents

- Tier 1, every edit: `bun run check:fast` and `bun run vitest run <files>`.
- Tier 2, before handoff: `bun run verify` (queues for one of three machine-wide heavy slots).
- Tier 3, phase gate only: `bun run verify:integration`, `bun run test:booking-ui`, `bun run test:e2e:smoke`.
- Never run `npx convex dev`, `bun run dev:convex` or `bun run seed` against the cloud deployment; use `bun run dev`.
- Never run a full unit suite, build or E2E outside `scripts/heavy.mjs`, or use more than two Vitest workers locally (`export VITEST_MAX_WORKERS=2`).
- Never leave a dev server, Vite or Chromium running.
- Never hand-resolve `convex/_generated` or `bun.lock` conflicts: take either side, then run `bun run convex codegen` / `bun install --lockfile-only`. Only one agent at a time changes dependencies.

## New worktrees

- Run `bun run worktree:setup` (T3 runs it as the worktree setup script). On macOS it clones dependencies when lockfiles match. It runs a frozen install, copies `.env.local` (frontend keys only, no `CONVEX_DEPLOYMENT`), `.env.dev.local` and `.env.e2e.local` from `~/.config/360-tour/` (mode 600) and assigns this checkout its own dev and booking-UI ports.
- A frozen install never prunes packages an earlier install left behind. Worktree setup checks the runtimes listed in `scripts/shared-runtimes.mjs` (Clerk's `@clerk/shared` for `@clerk/nextjs` and `@clerk/react`, Floating UI's `react-dom` for both Radix Popper copies). If the lockfile shares one but an inherited install (APFS clone or older install) resolves separate copies, setup deletes only this checkout's `node_modules` and runs one clean frozen install. A main checkout installed before these pins (setup skips main) needs a one-time `rm -rf node_modules && bun install --frozen-lockfile`. `node -e 'import("./scripts/shared-runtimes.mjs").then(m => console.log(m.staleSharedRuntimes(process.cwd())))'` lists any split (`[]` when consistent).
- `bun run dev:convex` and `bun run seed` refuse unless `ALLOW_CLOUD_DEV=1`. The vendored Convex skills in `.agents/skills/` say to run `npx convex dev`; here use `bun run dev`.
