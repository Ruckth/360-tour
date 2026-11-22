# Start-only Sentry smoke and strict source-map proof for the Phase 4 release

Measured on the Start-only candidate `ba9b91adf79721a5d0f01849a1d4b307b4438fff` (parent `93b08fd0`). It was needed because the chat source changed after R6 (`982ffe82`) in `src/components/chat/{AIChatWidget,ChatShell,useChatSession}.tsx` and `src/components/global/SiteShell.tsx`. The proof scripts, coverage rules, preloads, `vite.start.config.ts`, `package.json` and `bun.lock` are identical to R6, and the thresholds are unchanged. The historical Phase 2 and [R6](start-sentry-r6.md) evidence stays as recorded.

The shipping revision is `295323064cf4b6f5fb30595ae2129f17c3ffdaca`. Its application, Convex sources, lockfile, package manifest, Vite and Vercel configuration, and Sentry scripts and tests match the measured candidate. The later edits cover the local development launcher, cutover verification, CI test placement, fixtures and the runbook.

- **Inputs:** R's frozen Bun 1.4.5 lock (no `next` or `@sentry/nextjs` installed), Node 22, the shipped `bun run build` nested inside the held heavy slot, a loopback fake Sentry, synthetic token/org/project, no Clerk, no cloud.
- **Timing:** the provisional Stage E fixture had stopped at the readiness barrier with zero scored opens. The smoke ran 09:16:42–09:17:04Z and the source-map proof until 09:17:28Z, one heavy slot each.
- **Unit tests:** `sentry-coverage`, `heavy` and `sentry-privacy` pass, 11 of 11.

## Smoke: pass ([json](start-sentry-smoke-r-final.json))

| Check | Result |
| --- | --- |
| Credential-free build: public maps / map references / server maps / token | 0 / 0 / 0 / absent |
| Server envelope | `tanstackstart-react`, `auto.node.onunhandledrejection`, DSN matches, pairing fragment redacted |
| Browser envelope | `auto.browser.browserapierrors.setTimeout`, DSN matches, URL scrubbed. The harness blocked 2 outbound requests (1 on R6) |
| Secret in any envelope | no |

## Strict source maps: pass ([json](start-sentry-sourcemaps-r-final.json))

| Check | R6 `982ffe82` | R `ba9b91ad` |
| --- | --- | --- |
| Plain build: requests / public maps / map references / server maps / token files | 0/0/0/0/0 | 0/0/0/0/0 |
| Credentialed upload | 2 bundles, 711 debug IDs | 2 bundles, 711 debug IDs, every request carried the synthetic token |
| Client debug IDs linked | 259 of 259 | **259 of 259** |
| Server debug IDs linked | 480 of 482 | **480 of 482** (480 server maps observed before deletion) |
| Coverage failures | none | none |
| After upload: public maps / map references / server maps / token files | 0/0/0/0 | 0/0/0/0 |

**Allowed unlinked files.** Both are classified, and both have no map emitted and their debug ID not uploaded:
- `.output/server/_runtime.mjs` as `rolldown-runtime`: generated runtime helpers, no first-party source.
- `.output/server/_ssr/server-DnUo0sLl.mjs` as `reexport-barrel`: server-entry re-exports plus debug-ID registration.

**Negative controls.** All three ran on the same real data, and each failed as required:
1. Dropping the uploaded map for `.output/server/_-_locale_.booking.pay-CwkLm8EQ.mjs` gave "debug ID not uploaded (a map was emitted, so it must link)".
2. Giving `.output/server/_ssr/server-DnUo0sLl.mjs` an emitted map gave "debug ID not uploaded (a map was emitted, so it must link)".
3. Giving `.output/server/_runtime.mjs` application code gave "debug ID not uploaded" (it is no longer classified as runtime-only).

**Captured server exception.** `TypeError: Cannot read properties of undefined (reading 'search')`, mechanism `auto.node.onunhandledrejection`, 1 `debug_meta` image. The top frame is `.output/server/_ssr/routing-ByiabNMG.mjs:46:25` (`Module.localizeHref`). Its debug ID is present and the map was uploaded. It resolves to `src/i18n/routing.ts:57:25`: `const separator = href.search(/[?#]/);`.

**Static positions:**
- Client `.output/public/assets/index-Bslbu0EL.js:93:8442` → `src/start-app/routes/__root.tsx:58:47` ("Page temporarily unavailable").
- Server `.output/server/__root-C7jh0jBL.mjs:18:93` → `src/start-app/routes/__root.tsx:17:95` ("Invalid shell request").

## Local versus hosted symbolication

Everything above was symbolicated **locally**. The proof decodes the VLQ mappings from the uploaded artifact-bundle copies held by the fake API, and matches files and the event frame by debug ID. **Hosted Sentry symbolication was not exercised.** No real Sentry project received the bundles or the event, so this does not show that Sentry accepts, processes or symbolicates them. Client errors are checked by static position only; no client stack was captured and symbolicated. The server exception is raised by the test-only preload calling a first-party export, not by an HTTP request. To prove hosted symbolication, one credentialed staged deployment must send a real event and Sentry must show the same `src/i18n/routing.ts:57:25` frame.
