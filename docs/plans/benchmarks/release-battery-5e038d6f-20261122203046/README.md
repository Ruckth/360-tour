# Release battery on final R 5e038d6f (run 20261122203046)

- **R:** `5e038d6f7cf573bcd73c6988189baa82577e8a06`, the single child of C `93b08fd084679fba52431ab2abed0afabcc4abe2`. The checkpoint constant names C.
- **Host:** private checkout `/private/tmp/360-release-battery`, Bun 1.4.5 (pinned), Node 22, `VITEST_MAX_WORKERS=2`, heavy queue.
- **Clerk:** the test tenant only, exclusive to this run from 20:11:46. Hosted QA held its own window first. This run provisioned no identities before that window was released.
- **Exit codes:** every exit code is the command's own, recorded in `stages.tsv` (stage, exit, start, end, +07). This record keeps no secrets, environment files, private logs or request bodies.

| Stage | Exit | Time (+07) | Result |
| --- | ---: | --- | --- |
| setup, frozen install | 0 | 20:08:42–20:08:43 | tree unchanged |
| `check:fast` | 0 | 20:08:43–20:09:02 | |
| `check` | 0 | 20:09:02–20:09:51 | |
| knip | 0 | 20:09:51–20:09:53 | |
| `arch:score --phase 4` | 0 | 20:09:53–20:10:42 | |
| no-undef, all runner scripts | 0 | 20:10:42–20:10:43 | |
| focused unit set | 0 | 20:10:43–20:11:45 | |
| `test:guards` | 0 | 20:11:45–20:12:55 | 17 / 17 files, 237 / 237 tests |
| `verify:integration` | 0 | 20:14:31–20:28:47 | Vitest 381 / 381 files, 4,341 tests; Start build; booking UI 815 / 815 in 8.0 min; real-Clerk E2E 86 / 86 in 1.8 min; run-owned users removed |
| `bench:routes` (integration build) | 0 | 20:28:47–20:28:49 | all four routes within their limits |
| route tree vs build | 0 | 20:28:49 | committed `routeTree.gen.ts` matches |
| `test:e2e:smoke` (standalone) | 0 | 20:28:49–20:29:28 | 16 / 16 |
| `test:dev` (local-only) | 0 | 20:29:28–20:30:14 | fresh and retained lifecycles, real Clerk owner and nonstaff checks; owned processes and users cleaned; `.local-dev` removed |

Static guards passed on the uncontended host, so no standalone guard re-run was needed.

Route sizes from the integration build are in `start-route-budgets.json` (SHA-256 in `sha256.txt`):

| Route | Chunks | gzip | Brotli |
| --- | ---: | ---: | ---: |
| home | 21 | 242,924 | 206,911 |
| room | 22 | 240,794 | 204,855 |
| property | 77 | 384,963 | 333,033 |
| checkout | 93 | 469,709 | 406,567 |

## Provisional R 3dbc571e (superseded)

The earlier battery on provisional R `3dbc571e` (record `release-battery-3dbc571e-20261122200558`, docs-only commit `5c6cb47a`, branch `evidence/release-battery-3dbc571e-20261122200558`) recorded two non-zero exits:
- `bench:routes` exited 1. Its local measurement plugin classified the 1 KiB SSR-safe shared `TourIntro` chunk as the heavy renderer by its directory, although every size was within its limit. R `5e038d6f` fixes only that plugin, its types and its regression test (`scripts/bench/start-route-js-manifest.{mjs,d.mts}`, `tests/unit/start-route-js-size.test.ts`). The application source is identical to `3dbc571e`.
- Static `test:guards` exited 1 on a 60 s timeout of `arch-scorecard-cli` › `--phase2` under concurrent host load. It passed 237 / 237 standalone on an idle host, and passes here.
