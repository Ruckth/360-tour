# Start-only R6 functional verification (provisional)

These results are for provisional R6 `982ffe82bc133e013c9a6a39a83bccc5cb103585`, the single direct child of the dual integration `08b24a15ce77b3c709b60b22a76fbfef1f6baacd`, recorded 2026-11-22. They are not the shipping-revision record (runbook §7, step 7).

- **Inputs:** Bun 1.4.5 frozen lock (identical to `25ce9683`, with no Next packages), Node 22, `VITEST_MAX_WORKERS=2`, and the local Convex backend from `scripts/local-integration.mjs`. The Clerk test tenant had 3 run-owned users, created at start and deleted at the end; cleanup reported no failure.
- **Command:** `bun run verify:integration`, one heavy slot, 15:21:11–15:39:14 +07.

| Stage | Result |
| --- | --- |
| `bun run verify`: Vitest, all four projects | 378 / 378 files, 4,293 / 4,293 tests passed |
| `bun run verify`: Start build (`vite build --config vite.start.config.ts`, Nitro) | built |
| Booking UI (`playwright.booking.config.ts`, 2 workers) | 814 / 814 passed in 9.1 min, no retries or flakes |
| Real-Clerk E2E (Playwright, Start server) | 86 / 86 passed in 1.8 min |

**Exit code not captured.** The run was started detached (`nohup … &`, then `disown`), so its exit status was not recorded. The result rests on the four stage summaries above, the absence of any error or failure line in the log, and cleanup completing. The next run recorded its exit code directly. R7 `3b46bc814e31e90e1b4dc4a781bbca041439c1a3` (parent `69c90534`) ran `bun run verify:integration` from 15:46:56 to 16:04:26 +07, with the same lock and 2 workers, and its **exit code was 0**. It passed Vitest with 378 / 378 files and 4,299 tests, the Start build, booking UI with 814 / 814 in 9.1 min, and real-Clerk E2E with 86 / 86 in 1.7 min.

The related checks on R5 `25ce9683` (same lock and the same R delta, parent `661d4e7d`) also passed: `check:fast`, `check`, knip, 77 focused files with 873 tests, the Start build, and `bench:routes`. Checkout measured 469,685 bytes gzip and 406,574 bytes Brotli. The Sentry proof for R6 is in [`start-sentry-r6.md`](start-sentry-r6.md).
