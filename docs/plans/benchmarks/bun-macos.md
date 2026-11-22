# Bun toolchain on macOS

Bun 1.4.5 and Node 22.22.3 ran the Next toolchain on Darwin arm64 with pnpm absent from PATH. The Bun-only snapshot was `958848a2`. Its import preserved all 59 direct dependency versions and the frozen lock kept SHA-256 `61f886fa941f044168ac36058b2089d362854e49f0765acf6da7ffe7e815baa7`. The OLD rollback snapshot `6e6a562c` retains its original pnpm 10.30.3 lock.

The independently buildable Bun commit is `8193f6d96c3861c25acea534bc1bcb18c3571a01`, directly after the pnpm control. Its lock shares the existing Clerk and Floating UI versions across the Next runtime. The five-trial figures below measure the original tooling snapshot. The final lock hash, install checks and emitted route sizes are recorded in the [Bun boundary comparison](bun-boundary-bundles.md).

| Operation | Runs | Median |
| --- | ---: | ---: |
| Frozen install into fresh `node_modules`, warm package cache | 5 | 2.311 s |
| Cold `bun check`, app TypeScript build info removed | 5 | 51.192 s |
| Warm `bun check`, immediate repeat | 5 | 48.321 s |

The repeated frozen install took 0.145 s and left the lock unchanged. A second APFS worktree cloned dependencies and verified its frozen install offline in 17.548 s. TypeScript native 7.0.2 and Playwright 1.60.0 started from the cloned dependencies. Other work was active on the machine during timing, and the measurements cover the toolchain only.

Each disposable fault failed the exact CI `bun check` command and `bun run check` with exit code 1 and the expected diagnostic. The five faults covered the application, test and Convex TypeScript projects, a floating promise and an ESLint warning. Both commands passed after restoration.

Knip and 12 focused repository tests passed. Sharp encoded an image, critical React and Vite peers shared the expected root instances, and the installed native bindings loaded. The local Convex CLI generated API and server artifacts in an offline system-UDF fixture. These checks cover tooling on macOS. Linux, live Vercel installation and the deployed server runtime have separate acceptance records.
