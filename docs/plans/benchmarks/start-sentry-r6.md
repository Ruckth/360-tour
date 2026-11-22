# Start-only Sentry smoke and strict source-map proof on R6

Re-run of the Phase 2 Sentry acceptance on provisional R6 (`982ffe82`), where all Next packages are gone, `@sentry/nextjs` included. Both scripts and their thresholds are unchanged. The historical evidence in [`start-sentry-smoke.md`](start-sentry-smoke.md) and [`start-sentry-sourcemaps.md`](start-sentry-sourcemaps.md) stays as recorded.

- **Inputs:** R6's frozen Bun 1.4.5 lock, Node 22, the shipped `bun run build` (which runs `heavy.mjs` itself and is nested through `HEAVY_HELD`), loopback fake Sentry only, synthetic credentials, no Clerk sign-in.
- **Commands** (run 2026-11-22 15:36 and 15:37, one heavy slot each):
  - `node scripts/heavy.mjs node scripts/sentry-smoke.mjs --out docs/plans/benchmarks/start-sentry-smoke-r6.json`
  - `node scripts/heavy.mjs node scripts/sentry-sourcemap-proof.mjs --out docs/plans/benchmarks/start-sentry-sourcemaps-r6.json`
- **Install check:** `node_modules/next` and `node_modules/@sentry/nextjs` are absent. The unit tests `sentry-coverage`, `heavy` and `sentry-privacy` pass (11 of 11).

## Smoke: pass ([`start-sentry-smoke-r6.json`](start-sentry-smoke-r6.json))

| Check | Result |
| --- | --- |
| Credential-free build: public maps / map references / server maps / token | 0 / 0 / 0 / absent |
| Server envelope | `tanstackstart-react` SDK, `auto.node.onunhandledrejection`, DSN matches, pairing fragment redacted |
| Browser envelope | `auto.browser.browserapierrors.setTimeout`, DSN matches, URL scrubbed, 1 outbound request blocked |
| Secret in any envelope | no |

## Strict source maps: pass ([`start-sentry-sourcemaps-r6.json`](start-sentry-sourcemaps-r6.json))

| Check | Phase 2 (`5010722b`) | R6 (`982ffe82`) |
| --- | --- | --- |
| Plain build: requests / public maps / map references / server maps | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Credentialed upload | 2 bundles, 715 debug IDs | 2 bundles, 711 debug IDs, every request carried the synthetic token |
| Client debug IDs linked | 264 of 264 | **259 of 259** |
| Server debug IDs linked | 479 of 481 | **480 of 482**. The other 2 are `_runtime.mjs` (`rolldown-runtime`) and `_ssr/server-DnUo0sLl.mjs` (`reexport-barrel`), with no map emitted for either |
| Coverage failures | none | none |
| Negative controls | 3 of 3 failed as required | 3 of 3 failed as required: the dropped `_-_locale_.booking.pay-CwkLm8EQ.mjs` map, `server-DnUo0sLl.mjs` given a map, and `_runtime.mjs` given app code |
| Captured server event | `routing-ByiabNMG.mjs:46:25` → `src/i18n/routing.ts:57:25` | Same frame and same position (`Module.localizeHref`, debug ID in `debug_meta`) |
| Client position | → `__root.tsx:58:47` | `index-O9WyIkrT.js:93:8442` → `src/start-app/routes/__root.tsx:58:47` |
| Server position | → `__root.tsx:17:95` | `__root-C7jh0jBL.mjs:18:93` → `src/start-app/routes/__root.tsx:17:95` |
| After upload: public maps / map references / server maps / token files | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

The count changes follow from R6 removing the Next entry and adding Start-only modules. Every file is still either linked or one of the two classified generated files. No regression was found and no code was changed.

The limitations in [`start-sentry-sourcemaps.md`](start-sentry-sourcemaps.md#limitations) still apply.
