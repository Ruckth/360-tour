# Start Sentry smoke (Phase 2 acceptance)

**Outcome: pass.** The production TanStack Start build's own Sentry initialization sends a synthetic exception from the browser (`src/start-app/client.tsx`) and from the server (`src/start-app/server.ts`) to a loopback capture transport. Neither envelope contains the display pairing secret, and the build publishes no source maps. Sanitized result: [`start-sentry-smoke.json`](start-sentry-smoke.json).

No Sentry account, DSN credentials, auth token, deployment or public debug route was used.

## Procedure

```sh
unset SENTRY_AUTH_TOKEN
node scripts/heavy.mjs node scripts/sentry-smoke.mjs --out docs/plans/benchmarks/start-sentry-smoke.json
# Reuse an existing smoke build (the DSN is baked into the client bundle):
node scripts/heavy.mjs node scripts/sentry-smoke.mjs --skip-build --out <proof.json>
```

[`scripts/sentry-smoke.mjs`](../../../scripts/sentry-smoke.mjs):

1. **Loopback capture.** Listens on `127.0.0.1:47911` and records envelopes posted to the fake DSN `http://sentrysmokepublickey@127.0.0.1:47911/4242`. It also answers a minimal anonymous Convex query stub so pages render without a backend.
2. **Credential-free build.** Refuses to run if `SENTRY_AUTH_TOKEN` is set. Runs the normal `bun run build:start` with the loopback DSN as `VITE_SENTRY_DSN`/`SENTRY_DSN`. Real Sentry, Clerk, Convex, PostHog and site variables are not inherited; Clerk uses syntactically valid production-format keys for an unresolvable domain.
3. **Source maps.** Counts `.map` files and `sourceMappingURL=` references in `.output/public` (and `.map` files in `.output/server`).
4. **Server exception.** Runs `.output/server/index.mjs` with the test-only preload [`scripts/sentry-smoke-preload.mjs`](../../../scripts/sentry-smoke-preload.mjs). On `SIGUSR2` the preload logs a URL containing `#pair=<random secret>`, then raises an unhandled rejection. The app's own init must capture it.
5. **Browser exception.** Chromium (every non-loopback request blocked) opens `/display?pair=<secret>#pair=<secret>`, waits for the client bundle's Sentry client, then throws from a timer.
6. **Checks.**
   - Both events arrive at the project's envelope endpoint with the DSN's public key.
   - The server console breadcrumb reads `#pair=[redacted]`.
   - The browser event URL contains no secret.
   - A JSON-path search finds the secret in no captured envelope.

## Result

| Check | Result |
| --- | --- |
| Public `.map` files / `sourceMappingURL` references / server `.map` files | 0 / 0 / 0 |
| Server event | `sentry.javascript.tanstackstart-react`, platform `node`, mechanism `auto.node.onunhandledrejection`, matching key |
| Browser event | `sentry.javascript.tanstackstart-react`, platform `javascript`, mechanism `auto.browser.browserapierrors.setTimeout`, matching key |
| Server pairing breadcrumb | `sentry smoke navigation http://127.0.0.1/display#pair=[redacted]` |
| Browser `request.url` | `http://localhost:47912/display` (the SDK drops the fragment, and `urlQueryParams: false` drops the query) |
| Secret in any envelope | no (no JSON paths) |

## Defect found and fixed

The first run found the pairing secret in the server event at `breadcrumbs[0].data.arguments[0]`. The SDK's console breadcrumb repeats the raw console arguments, and `scrubBreadcrumb` redacted only `message` and `from`/`to`/`url`. `src/lib/sentry-privacy.ts` now also redacts string console `arguments`. `tests/unit/sentry-privacy.test.ts` uses the SDK's real console-breadcrumb shape; it fails without the fix. The result above is from a fresh build containing the fix.
