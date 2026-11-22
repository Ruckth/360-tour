# Release battery on R 3dbc571e (run 20261122200558)

- **R:** `3dbc571ebe5fd25a822b9404fafa7fd048adbc71`, the single child of C `93b08fd084679fba52431ab2abed0afabcc4abe2`. The checkpoint constant names C.
- **Host:** private checkout `/private/tmp/360-release-battery`, Bun 1.4.5 (pinned), Node 22, `VITEST_MAX_WORKERS=2`, heavy queue. Clerk was exclusive to this run during the integration, smoke and dev stages, using the test tenant only.
- **Exit codes:** every exit code below is the command's own, recorded by `release-battery.sh` in `stages.tsv` (stage, exit, start, end, +07). This record keeps no secrets, environment files, private logs or request bodies.

| Stage | Exit | Time (+07) | Result |
| --- | ---: | --- | --- |
| setup, frozen install | 0 | 19:41:53 | tree unchanged |
| `check:fast` | 0 | 19:41:53–19:42:12 | |
| `check` | 0 | 19:42:12–19:42:58 | |
| knip | 0 | 19:42:58–19:43:00 | |
| `arch:score --phase 4` | 0 | 19:43:00–19:43:49 | |
| no-undef, all runner scripts | 0 | 19:43:49–19:43:50 | |
| focused unit set | 0 | 19:43:50–19:44:54 | |
| `test:guards` | **1** | 19:44:54–19:47:25 | 236 / 237. `arch-scorecard-cli` › `--phase2` hit the 60 s limit (81 s) while other heavy jobs ran on the host; kept as observed |
| `verify:integration` | 0 | 19:47:27–20:01:55 | Vitest 381 / 381 files, 4,340 tests (guards included); Start build; booking UI 815 / 815 in 8.0 min; real-Clerk E2E 86 / 86 in 1.9 min; run-owned users removed |
| `bench:routes` (integration build) | **1** | 20:02:46–20:02:48 | every size below its limit; the check failed on `/rooms/pool-villa: ordinary room loads the heavy renderer in assets/TourIntro-DvVmwdOX.js` (the 1 KiB SSR-safe shared intro, classified by directory). The measurement plugin is fixed separately (root) |
| route tree vs build | 0 | 20:02:48 | committed `routeTree.gen.ts` matches |
| `test:e2e:smoke` (standalone) | 0 | 20:02:48–20:03:25 | 16 / 16 |
| `test:dev` (local-only) | 0 | 20:03:25–20:04:11 | fresh and retained lifecycles, real Clerk owner and nonstaff checks; owned processes and users cleaned; `.local-dev` removed afterwards |
| `test:guards` (standalone, idle host) | 0 | 20:04:11–20:05:23 | 17 / 17 files, 237 / 237 tests |

Route sizes from the integration build are in `start-route-budgets.json` (SHA-256 in `sha256.txt`):

| Route | Chunks | gzip | Brotli |
| --- | ---: | ---: | ---: |
| home | 21 | 242,917 | 206,953 |
| room | 22 | 240,789 | 204,862 |
| property | 77 | 384,975 | 333,125 |
| checkout | 93 | 469,731 | 406,649 |
