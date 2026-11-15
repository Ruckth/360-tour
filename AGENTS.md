<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Architecture

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing application code. It documents domain ownership, pure shared rules, access builders, the table/endpoint/admin-page recipe and current validation commands. Focused tests may intentionally import private implementations; production code must use the documented model interfaces.

## Checks and parallel agents

- Tier 1, every edit: `pnpm check:fast` and `pnpm exec vitest run <files>`.
- Tier 2, before handoff: `pnpm verify` (queues for one of three machine-wide heavy slots).
- Tier 3, phase gate only: `pnpm verify:integration`, `pnpm test:booking-ui`, `pnpm test:e2e:smoke`.
- Never run `npx convex dev`, `pnpm dev:convex` or `pnpm seed` against the cloud deployment; use `pnpm dev`.
- Never run a full unit suite, build or E2E outside `scripts/heavy.mjs`, or use more than two Vitest workers locally (`export VITEST_MAX_WORKERS=2`).
- Never leave a dev server, Vite or Chromium running.
- Never hand-resolve `convex/_generated` or `pnpm-lock.yaml` conflicts: take either side, then run `npx convex codegen` / `pnpm install --lockfile-only`. Only one agent at a time changes dependencies.

## New worktrees

- Run `pnpm worktree:setup` (T3 runs it as the worktree setup script). It clones dependencies, copies `.env.dev.local` / `.env.e2e.local` from `~/.config/360-tour/` (mode 600) and assigns this checkout its own dev and booking-UI ports.
