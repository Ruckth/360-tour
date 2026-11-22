# Start private source-map upload (credential-gated)

**Outcome: pass.** With `SENTRY_AUTH_TOKEN` set, the Start build uses the official `@sentry/tanstackstart-react/vite` plugin. It uploads hidden client and final Nitro server source maps with debug IDs, then deletes them. Without a token the plugin is not loaded and nothing is uploaded. Neither build publishes a map, a `sourceMappingURL` or the token. Sanitized result: [`start-sentry-sourcemaps.json`](start-sentry-sourcemaps.json).

## Configuration

`vite.start.config.ts` lazily loads `sentryTanstackStart` only when `SENTRY_AUTH_TOKEN` is set, mirroring the Next build's `sourcemaps.disable: !SENTRY_AUTH_TOKEN`. Org and project come from `SENTRY_ORG`/`SENTRY_PROJECT`; `SENTRY_URL` selects a self-hosted server. Telemetry, build-time instrumentation and middleware auto-instrumentation are off, so only source-map handling changes. The plugin's server instrumentation needs an `instrument.server.*` file, which does not exist. A static import of the plugin breaks the plain build, hence the lazy import.

`@sentry/nextjs` is pinned to exactly `11.16.0`, the same version `@sentry/tanstackstart-react` pins. Before the pin, the hoisted `@sentry/core` was 11.0.0 and Nitro's re-bundle of Start's SSR output resolved Sentry imports to it. The credentialed build failed on the missing `_INTERNAL_setTunnelDefaults`, and plain builds already ran 11.16 server code against core 11.0.0. The lockfile now holds one Sentry 11.16.0 tree.

## Procedure

```sh
node scripts/heavy.mjs node scripts/sentry-sourcemap-proof.mjs --out docs/plans/benchmarks/start-sentry-sourcemaps.json
```

[`scripts/sentry-sourcemap-proof.mjs`](../../../scripts/sentry-sourcemap-proof.mjs) starts a fake Sentry API on `127.0.0.1:47921`. It answers the organization, release, chunk-upload and artifact-bundle assembly calls, and reassembles uploaded chunks into the artifact bundle zips.

1. **Plain build** (`SENTRY_URL` points at the fake API, no token): count requests, maps and map references.
2. **Credentialed build:** synthetic `sntrys_…` token, `smoke-org`/`smoke-project`, loopback `SENTRY_URL`. Unpack every uploaded bundle; read each `minified_source`/`source_map` pair by its `debug-id`.
3. **Debug-ID links:** read each published JavaScript file's `_sentryDebugIds` snippet. The ID must match an uploaded pair whose code is identical apart from trailing `debugId`/`sourceMappingURL` comments.
4. **Original positions:** locate first-party strings in published client and server code. Decode the uploaded map's VLQ mappings at that generated position, and check the original line in the real source file contains the same text.
5. **Leaks:** check for `.map` files and `sourceMappingURL=` references in `.output/public`, `.map` files in `.output/server`, and the token in any output file.
6. **Strict coverage** ([`scripts/lib/sentry-coverage.mjs`](../../../scripts/lib/sentry-coverage.mjs)): during the credentialed build, record every server `.map` that exists before the plugin deletes it. Every published client file and every published server file with a debug ID must link to an uploaded copy of the same code.
   - **Real sources:** each map's non-virtual sources must exist on disk once Vite query suffixes such as `?url` are removed.
   - **Segments:** each map needs mapped segments unless all its real sources are JSON data modules.
   - **Two exceptions:** `.output/server/_runtime.mjs` (one rolldown runtime region, `__` helper exports only) and `.output/server/_ssr/server-*.mjs` (`import {…}`/`export {…}` statements only). Each is allowed only while it was not uploaded and no map was emitted for it. Either one gaining a map or application code, or any other unmatched file, fails.
   - **Negative controls:** run on the same real data, and each must fail:
     - drop one non-sampled uploaded server map;
     - give the classified re-export chunk an emitted map;
     - give the classified runtime chunk application code.
7. **Captured server event:** run the credentialed `.output/server/index.mjs` with `SENTRY_DSN` pointing at the same loopback server and the test-only preload [`scripts/sentry-sourcemap-preload.mjs`](../../../scripts/sentry-sourcemap-preload.mjs). After the first request initializes Sentry, `SIGUSR2` calls the final routing chunk's first-party `localizeHref(undefined, "en")`. It throws a real TypeError, left unhandled. The emitted event's frames are resolved by `debug_meta` debug ID through the uploaded maps.

## Result (run 2026-11-22 14:04, branch `t3/sentry-proof-strict` at `5010722b`, combined lock from `7315730f`)

| Check | Result |
| --- | --- |
| Plain build: requests / public maps / map references / server maps | 0 / 0 / 0 / 0 |
| Credentialed upload | 2 artifact bundles, 715 debug IDs, every request carried the synthetic bearer token |
| Published files with a debug ID → linked to an uploaded map with real sources | client **264 of 264**; server **479 of 481**, with the other 2 classified as `rolldown-runtime` and `reexport-barrel` (no map emitted) |
| Coverage failures | none |
| Negative controls (each must fail) | dropped `_-_locale_.booking.pay-Bqzu4rKc.mjs` map: **failed** ("a map was emitted, so it must link"); `server-DnUo0sLl.mjs` given a map: **failed**; `_runtime.mjs` given app code: **failed** |
| Client static position | `.output/public/assets/index-C16-PO-m.js:90:2820` → `src/start-app/routes/__root.tsx:58:47` ("Page temporarily unavailable") |
| Server static position | `.output/server/__root-DDKx2WXZ.mjs:18:93` → `src/start-app/routes/__root.tsx:17:95` ("Invalid shell request") |
| **Captured server event** | `TypeError: Cannot read properties of undefined (reading 'search')`, `auto.node.onunhandledrejection`; frame `.output/server/_ssr/routing-ByiabNMG.mjs:46:25` (`Module.localizeHref`, debug ID in `debug_meta`) → `src/i18n/routing.ts:57:25`, `const separator = href.search(/[?#]/);`, at the `search` token |
| After upload: public maps / map references / server maps / files containing the token | 0 / 0 / 0 / 0 |

### The two unlinked server files

Neither file had a source map emitted, so no copy was uploaded under its debug ID. That is generated-only code, not a stale map:

| File | Debug ID | Contents |
| --- | --- | --- |
| `.output/server/_runtime.mjs` | `8b51fb44-…` | rolldown's generated module helpers (`__toESM`, `__commonJSMin`, `__exportAll`, `__require`, …) from the virtual module `\0rolldown/runtime.js`; no original source exists |
| `.output/server/_ssr/server-DnUo0sLl.mjs` | `7c1b2aca-…` | a pure re-export barrel of Start server-entry symbols; no executable code besides the debug-ID snippet |

A frame in either file would show readable, unminified bundler helper code. Neither file contains first-party code, so no first-party frame depends on them.

An earlier run that triggered through the `loadShell` RPC handler outside a request threw "No Start context found" in TanStack code. Those framework frames resolved correctly to `@tanstack/start-client-core` and `@tanstack/start-storage-context`. The first-party frame sat in TanStack's compiler-generated `createServerRpc` wrapper, which has no original line. The `localizeHref` trigger replaced it so the top frame is real first-party code.

## Limitations

- **Fake server, not Sentry:** the fake API accepts whatever the official plugin and Sentry CLI SDK 0.50.0 send. That proves the real client side of the upload, not that real Sentry accepts it, processes it or symbolicates a live event.
- **Client stack not captured:** the client is verified by static position mapping only. The server is also verified by a captured event, whose frame was resolved locally with the same algorithm, not by Sentry's symbolicator.
- **Release calls:** the plugin's release-creation calls ran against the fake API with the Git SHA as the release name.
- **Preload trigger:** the server exception is raised by a test-only preload that calls a first-party export in the final bundle, not by an HTTP request.
