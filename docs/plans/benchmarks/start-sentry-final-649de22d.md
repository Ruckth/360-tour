# Final Start-only Sentry smoke and strict source-map proof on R `649de22d`

This is the final run on exact R `649de22d582358c9092e0e7c9e1835ad1af952ea` (parent `93b08fd0`), a native Start-only build. It was rerun because guest modules changed since `ba9b91ad`. The proof scripts, coverage rules, preloads, `heavy.mjs`, `vite.start.config.ts`, `package.json` and `bun.lock` are identical to `ba9b91ad`. The thresholds are unchanged, and earlier evidence (Phase 2, [R6](start-sentry-r6.md)) is left as recorded.

**Inputs:**
- R's frozen Bun 1.4.5 lock, with no `next` or `@sentry/nextjs` installed.
- Node 22.
- The shipped `bun run build`, nested inside the held heavy slot.
- A loopback fake Sentry with a synthetic token, org and project.
- No real accounts, no Clerk, no cloud.

**Runs** (2026-11-22, UTC). Unit tests: `sentry-coverage`, `heavy` and `sentry-privacy`, 11 of 11 passed.

| Run | Time | Heavy queue | Native exit |
| --- | --- | --- | --- |
| `node scripts/heavy.mjs node scripts/sentry-smoke.mjs --out …` | 12:37:01–12:37:18 | slot acquired after 0.0 s | **0** |
| `node scripts/heavy.mjs node scripts/sentry-sourcemap-proof.mjs --out …` | 12:37:18–12:37:51 | slot acquired after 0.0 s | **0** |

## Smoke: pass ([json](start-sentry-smoke-final-649de22d.json))

| Check | Result |
| --- | --- |
| Credential-free build: public maps / map references / server maps / token | 0 / 0 / 0 / absent |
| Server envelope | `tanstackstart-react`, `auto.node.onunhandledrejection`, DSN matches, pairing fragment `[redacted]` |
| Browser envelope | `auto.browser.browserapierrors.setTimeout`, DSN matches, URL scrubbed, 2 outbound requests blocked |
| Envelopes / secret in any envelope | 2 / no |

## Strict source maps: pass ([json](start-sentry-sourcemaps-final-649de22d.json))

| Check | `ba9b91ad` | `649de22d` |
| --- | --- | --- |
| Plain build: requests / public maps / map references / server maps / token files | 0/0/0/0/0 | 0/0/0/0/0 |
| Credentialed upload | 2 bundles, 711 debug IDs | 2 bundles, 713 debug IDs, every request carried the synthetic token |
| Client debug IDs linked | 259 of 259 | **260 of 260** |
| Server debug IDs linked | 480 of 482 | **481 of 483** (481 server maps observed before deletion) |
| Coverage failures | none | none |
| After upload: public maps / map references / server maps / token files | 0/0/0/0 | 0/0/0/0 |

**Allowed unlinked files.** Both are classified, and both have no map emitted and their debug ID not uploaded:
- `.output/server/_runtime.mjs`, `rolldown-runtime`.
- `.output/server/_ssr/server-DnUo0sLl.mjs`, `reexport-barrel`.

**Negative controls.** All ran on the same real data, and each failed as required:
1. Dropping the uploaded map for `.output/server/_-_locale_.booking.pay-B6RIx8Ra.mjs` gave "debug ID not uploaded (a map was emitted, so it must link)".
2. Giving `.output/server/_ssr/server-DnUo0sLl.mjs` an emitted map gave "debug ID not uploaded (a map was emitted, so it must link)".
3. Giving `.output/server/_runtime.mjs` application code gave "debug ID not uploaded".

**Captured server exception.** `TypeError: Cannot read properties of undefined (reading 'search')`, `auto.node.onunhandledrejection`, 1 `debug_meta` image. The top frame `.output/server/_ssr/routing-ByiabNMG.mjs:46:25` (`Module.localizeHref`) has its debug ID present and its map uploaded. It resolves to `src/i18n/routing.ts:57:25`: `const separator = href.search(/[?#]/);`.

**Static positions:**
- Client `.output/public/assets/index-uW-Oldqw.js:93:8442` → `src/start-app/routes/__root.tsx:58:47`.
- Server `.output/server/__root-CUlBoQO6.mjs:18:93` → `src/start-app/routes/__root.tsx:17:95`.

**Secret hygiene.**
- The synthetic token was absent from every output file in both builds.
- No secret appeared in any captured envelope.
- The committed JSON contains no local paths and no token.

## Local versus hosted symbolication

All symbolication here was **local**. It decodes VLQ mappings from the uploaded artifact-bundle copies held by the fake API and matches files and the event frame by debug ID. **Hosted Sentry symbolication was not exercised:**
- No real Sentry project received the bundles or the event.
- The client is checked by static position only.
- The server exception comes from the test-only preload, not from an HTTP request.

Proving hosted symbolication takes one credentialed staged deployment that sends a real event, with Sentry showing the `src/i18n/routing.ts:57:25` frame.
