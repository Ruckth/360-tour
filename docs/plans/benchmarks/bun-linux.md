# Linux Bun tooling benchmark

Measured the Next toolchain as it existed before the TanStack Start slice. This benchmark covers Linux ARM64 tooling. Guest tour latency and SSR runtime measurements have separate baselines.

The independently buildable Bun commit is `8193f6d96c3861c25acea534bc1bcb18c3571a01`, directly after the pnpm control. Its lock shares the existing Clerk and Floating UI versions across the Next runtime. The five-trial figures below measure the original tooling snapshot. The final lock hash, install checks and emitted route sizes are recorded in the [Bun boundary comparison](bun-boundary-bundles.md).

- pnpm control commit `6e6a562c9d0424f091654ba1e8b69a27b5e92242`, pnpm 10.30.3.
- Bun candidate commit `958848a2bf4b80c604cee37b457a1f17b87a9941`, Bun 1.4.5 (`a7733435c`). The migration was integrated as `8feecce4`.
- Both ran on Node 22.23.5, Debian Bookworm ARM64, on the same Colima `ci` VM with four vCPUs and 8 GiB RAM. Guest kernel `6.8.0-117-generic`. Docker base `node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb` with each manager installed at its own prefix.
- Both inputs were `git archive --format=tar` snapshots of the listed commits. Archive SHA-256 values were `c9cb45afa130ff79de72521b30bdc096d696f0bc6a8d03a3ac7eebf4dd8c3a70` for pnpm and `466268e46857cfed3fc17312a73ab13e6343d4d16a658322dfb5071beb8b3e2f` for Bun. The container received no host env files, credentials, source mounts or dependency store. The candidate PATH contained Bun and Node, with no pnpm executable.
- The control lock SHA-256 was `d333ab9faefec4aa81ce2bf0bafe01d2da086536befc68b8e1257953099b77b2`. The candidate lock SHA-256 was `61f886fa941f044168ac36058b2089d362854e49f0765acf6da7ffe7e815baa7`. All ten frozen installs returned 0 and preserved the lock bytes.

## Timings

All values are elapsed seconds, measured inside the same container with Bash `time` (%3R). The run order alternated by pair and no measured commands overlapped. Toolchain setup and archive extraction were outside the timer.

- Cold install created a new workspace, dependency store and `node_modules` for every trial. Both used the public npm registry and a 12-request cap. The pnpm command was `pnpm install --frozen-lockfile --store-dir "$STORE" --network-concurrency 12`. The Bun command was `BUN_INSTALL_CACHE_DIR="$STORE" bun install --frozen-lockfile --registry https://registry.npmjs.org/ --network-concurrency=12`.
- Cold static checks started from the final frozen installs with the pnpm store and Bun cache outside the checkout. Each cold run removed the app, test and Convex `tsbuildinfo` files if present. Warm runs immediately repeated the command without clearing incremental state. This uses the existing application-level check state and leaves the Linux page cache in normal use.
- The control command was `pnpm check && pnpm lint`. On the control `check` covers the three TypeScript projects, while `lint` covers zero-warning ESLint and the type-aware floating-promise rule. The candidate executes the same checks with literal `bun check`. The container's network was disconnected after the final install and remained disconnected during checks and smoke tests.

| Command | pnpm trials 1–5 | Bun trials 1–5 | pnpm median | Bun median | Change |
|---|---|---|---:|---:|---:|
| Cold frozen install | 6.866, 5.675, 7.446, 5.795, 6.469 | 4.592, 4.106, 4.112, 4.145, 4.209 | 6.469 | 4.145 | -35.9% |
| Cold static check | 75.062, 69.694, 69.865, 59.696, 61.128 | 84.369, 74.116, 65.105, 58.445, 59.578 | 69.694 | 65.105 | -6.6% |
| Warm static check | 80.076, 72.408, 65.717, 58.765, 59.663 | 72.406, 70.960, 58.373, 57.821, 59.261 | 65.717 | 59.261 | -9.8% |

The pnpm cold install ranged from 5.675 to 7.446 s and Bun from 4.106 to 4.592 s. These runs include registry transfer and retain any network variance. In an initial default-concurrency trial pnpm finished in 7.821 s while Bun, configured for its default 64 requests, still had pending TCP connections after 74 s. That pair was stopped and excluded. The matched 12-request results describe this VM and registry path only.

All 20 static checks exited 0. The first-to-last swing in the control was larger than either median delta. Static check speed is inconclusive on this VM.

## Linux smoke

Both frozen installs resolved the same set of 680 reachable package names and versions, including the ARM64 GNU binaries for Sharp, SWC, TS 7, oxlint, tsgolint, esbuild and Rolldown. The sorted `name@version` list matched byte for byte (SHA-256 `8b0983c2df3576f4ea82e328881948fb550ca71b1ce2fa424dd0293ebfd4008b`). The traversal covered the installed workspace's direct, transitive, optional and peer manifests that resolve on this platform. It compares version sets.

- Sharp 0.34.5 and libvips 8.17.3 encoded and read back a 2×2 WebP. Next 16.2.6 SWC and Convex's esbuild 0.27.0 each transformed a TypeScript source string.
- TypeScript native 7.0.2 and oxlint 1.93.0 reported their versions and ran in the timed static checks. Vite 8.0.13 and Vitest 4.1.6 ran `tests/unit/date-formatter-cache.test.ts` successfully for both installs with `VITEST_MAX_WORKERS=2`.
- Playwright 1.60.0 collected 814 booking tests across 40 files for each install with `playwright test -c playwright.booking.config.ts --list`. This was CLI discovery.
- Convex 1.50.0 reported its version, parsed `codegen --help`, and ran `convex codegen --system-udfs --typecheck disable` on the same one-module fixture with JS and declaration output. Both generated the same five files and hashes. This exercised offline generation. Deployment-backed codegen belongs to an integration run.
- Bun reported seven blocked lifecycle scripts covering `@parcel/watcher`, `@swc/core`, `core-js`, `unrs-resolver` and three installed copies of `@clerk/shared` across two versions. The native and integration checks below use the shipped package binaries. Keep these scripts blocked because the verified install and runtime paths work without executing them.
- Literal `bun check` and explicit `bun run check` both passed with pnpm absent from PATH. Two additional empty workspaces successfully ran the exact `bun install --frozen-lockfile` command using the populated package cache in a container with networking disabled. Each preserved the lock bytes and reproduced the candidate's 680-version manifest set.
