# Authenticated full-app Preview QA

This opt-in probe uses the same test-tenant Clerk and browser selectors as the local integration suite. It leaves the local-only Playwright configuration and backend guards intact.

Use an immutable Vercel deployment backed by a **new, disposable Convex Preview**. In the control plane, verify the deployment ID, exact deployed hostname, source commit and frontend's matching Convex origin. Seed its normal data. Use a Clerk test tenant with an existing `convex` JWT template and provision a matched run-owned owner, cashier and nonstaff using `scripts/e2e-clerk.mjs`. Grant only their fixture roles. Remove payment, AI, email, analytics and messaging provider credentials on both deployment surfaces before exposing the target to this run. Do not use an existing shared Preview.

Create a mode-600 JSON manifest outside the checkout. Set `isolation` to `dedicated-vercel-convex-preview`. Include `app` (immutable Vercel HTTPS origin), `backend` (Convex Preview HTTPS origin), `deploymentId`, the full `commit` SHA, and `emails` with `owner`, `cashier` and `nonstaff`. Set `providerDispatchDisabled`, `ownerGrantsAreRunOwned` and `freshlySeeded` to `true` only after the control-plane checks. The runner validates the manifest shape and origin allowlist. The manifest's deployment ID and SHA attest the operator's control-plane checks.

Provide `E2E_PREVIEW_QA_TARGET` (manifest path), `E2E_PREVIEW_QA_OPT_IN=disposable-test-only`, `CLERK_JWT_ISSUER_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` privately through the environment. For deployment protection, provide a mode-600 Netscape cookie jar through `E2E_PREVIEW_VERCEL_COOKIE_JAR`. Mint it against the exact immutable deployment, in a private directory:

```sh
umask 077
vercel curl /robots.txt --deployment "$deployment_id" --scope "$scope" -- \
  -sS -H 'x-vercel-set-bypass-cookie: true' --cookie-jar "$private_jar" -o /dev/null
```

The probe imports only the unexpired or session `_vercel_jwt` with exact host scope, Secure and HttpOnly. Keep the jar private and remove it after the run. Alternatively, provide `E2E_PREVIEW_VERCEL_BYPASS` privately to take precedence over the jar. Its header is attached only to exact-origin requests, without redirect forwarding. Leave Playwright and Clerk debug options off. Preserve only the one JSON stage summary, which contains no URLs, IDs, transcripts, cookies or credentials.

```sh
E2E_PREVIEW_QA_MODE=checkout-read-only node scripts/heavy.mjs node tests/e2e/preview-qa.ts
E2E_PREVIEW_QA_MODE=isolated-fixtures node scripts/heavy.mjs node tests/e2e/preview-qa.ts
```

The first run checks the public payment and success screens with missing credentials, while blocking browser Convex traffic and external write requests. The second run checks real Clerk role enforcement and cashier sign-out, creates a test booking hold through the payment handoff without paying, and restores a deterministic web-chat transcript after reload. It publishes a unique two-scene fixture, observes a reorder in an already-open guest tab while an explicit scene selection stays put in another, then archives while that second tab's Convex connection is interrupted. The probe checks both open-tab and reconnected unavailable states and attempts to remove its fixture. The operator owns teardown of the disposable Convex deployment and the pre-provisioned Clerk test identities. No test should invoke or verify external provider dispatch.

## Separate Preview outage experiment

The cache outage study uses its own disposable fixture Preview rather than a proxy. See "Vercel Preview outage" in `docs/plans/benchmarks/start-villa-cache-study.md` and `tests/bench/start-villa-preview-outage.mjs`. Only a `START_VILLA_FAULT_FIXTURE=1` build contains the fault hook. It acts only for requests carrying that deployment's token. Process-local recovery counts only when every observation shares one `x-villa-fault-process`. Browser offline mode confirms client reconnection only and cannot simulate the server-side outage.

## Provision and tear down a run

Use `perf-phase2-start-validation-<first 12 commit hex characters>` for a freshly seeded target per revision. The original dedicated `perf-phase2-start-validation` name also works. For either target, the provisioner can prepare the previous runner's private manifest and fixture users automatically. Supply an absolute mode-600 `E2E_PREVIEW_QA_PROVISION` JSON path. Include the exact immutable `app`, `backend`, `deploymentId`, `commit`, Vercel `scope`, `previewName` and the nonsecret Convex dev deployment selector in `convexProjectAnchor`. Set the same isolation and seed attestations as above, plus `frontendProviderOverridesBlank: true`. Set `E2E_PREVIEW_VERCEL_BIN` to the absolute authenticated Vercel CLI executable and opt in with `E2E_PREVIEW_QA_OPT_IN=disposable-test-only`.

```sh
node scripts/heavy.mjs node tests/e2e/preview-qa-provision.ts
```

The provisioner uses the Vercel deployment metadata and provider-isolation response, independently checks the Convex environment, matches the seed record across the named CLI target and published Convex client origin, and scans the deployment's public client assets for the pinned backend and test Clerk frontend key. It reads test tenant settings from the local private e2e file. The provisioner grants a temporary owner through the deployment CLI after verification and requires an existing owner grant so the temporary grant can be revoked. An authenticated owner creates and revokes the run's cashier invitation, and the cashier claims it with its real Clerk session. Booking, chat and scene fixture cleanup uses the app's operations. The provisioner revokes its temporary owner grant and deletes its own Clerk identities. It retains its mode-600 recovery journal only if deployment or user teardown fails.
