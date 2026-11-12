# Phase 1 cutover (operator runbook)

Status: root completed the production reset/seed/backend acceptance from exact main `4027d87e81047d000913075251ac53023117aebe` (reviewed `a08175a`). The quiesced 915-document / 96-entry production export was restored and matched on an isolated backend before clearing; the 74→91 rollback rehearsal also passed. Shared development was intentionally preserved. Root owns frontend readiness, traffic restoration and all further live operations. Production is the parent-verified `wary-toad-189`; never infer a deployment from a local `.env.local`. Keep all keys out of logs and git.

The new schema has 74 tables: 87 from main, four staff/refund tables, minus 14 retired tables and the net three removed by the channel-event merge. All money changes units in the same reset. Importing the old snapshot into the new schema is prohibited. The payment tables stay separate and retain their settlement links.

## 1. Prepare and review offline

From the implementation checkout:

```sh
node scripts/architecture-reset.mjs --old-ref 72a657f --out output/phase1-reset
cat output/phase1-reset/manifest.json
pnpm exec vitest run convex/phase1Architecture.test.ts convex/moneyCutover.test.ts convex/staffRoles.test.ts convex/posRefunds.test.ts
```

The program generates two empty snapshot ZIPs, an exact OLD schema/table manifest, and a temporary internal scheduler helper. It does not execute Convex or contact any backend. Review both ZIPs with `unzip -l`. The root ZIP has all 91 old table directories; the rollback ZIP `empty-new-root.zip` has all 74 new table directories, and `reset-new.ts` supplies the new-schema scheduler helper; the component ZIP has the migrations component's `migrations` table. Select a newer old revision if the reviewed dependency schema changed before cutover; regenerate and inspect the count and schema hash.

Since the Phase 3b schema split, the preparation script follows the actual `defineSchema` assembly for both historical monoliths and domain modules. It also writes `old-schema-sources/` and `new-schema-sources/` with repository-relative paths and per-file SHA-256 hashes in `manifest.schemaSources`. Keep these complete source graphs with the artifacts; the top-level `old-schema.ts` / `new-schema.ts` copies alone do not contain imported table definitions or validators. The maintenance preparation script verifies all reachable schema sources against the selected revision before writing its gate. These are offline preparation checks, not authorization to perform another reset.

Maintenance preparation preserves the selected revision's existing access seam byte for byte and rejects a changed or missing copy. For revisions before that seam existed, it uses the reviewed schema-independent maintenance builders from `f2bd89a` (`--gate-ref` can select another reviewed compatible seam). It never substitutes today's guest/role builders into the old table model. Install the archived revision's dependencies and typecheck the prepared Convex source before deploying it; schema equality alone does not prove that its builders compile.

Record the old application commit, the new application commit, selected deployment, Vercel deployment URLs, database export path/checksum, provider-webhook settings and cron names. There are eight cron jobs in the integrated old revision (the plan's seven was stale).

## 2. Quiesce the OLD deployment

1. Before the FIRST action that blocks Stripe ingress (Vercel pause, backend maintenance, or provider delivery changes), record an epoch-millisecond timestamp and set `ARCH_MONEY_CUTOVER_AT` to that value on the selected backend. This cutoff must be no later than the first blocked delivery, never the later export/clear/deploy time. Events created throughout the blocked window must remain failed deliveries for reconciliation. Then block public traffic and stop staff writes. A Vercel project pause blocks builds: before building the fresh frontend, hold traffic with a temporary all-path firewall deny rule and keep the project unpaused. Retain the backend maintenance gate separately. Disable LINE/Meta/WhatsApp provider callbacks and record settings for restoration. Keep Stripe delivery enabled: the paused HTTP router returns 503 so deliveries remain visible for retries; expire every open Stripe Checkout session and record its ID. Pause iCal imports. A disabled Stripe endpoint is not assumed to queue new events; explicitly reconcile/resend any events from a disabled interval.
2. Export the OLD application source into a disposable copy. Run `node scripts/architecture-maintenance.mjs --dir /absolute/disposable/old-source --old-ref 72a657f`, then install that copy's dependencies with `pnpm install --no-frozen-lockfile`. The script preserves the exact old schema, installs the shared public query/mutation/action/HTTP maintenance gate, pauses the eight crons without deleting their functions, and adds the protected scheduler helper. It refuses a working checkout or a mismatching schema.
3. Set `ARCH_RESET_PAUSED=1` on the explicitly selected Convex deployment and deploy this maintenance copy. All public Convex calls are blocked (HTTP returns 503); internal export/reset/seed functions remain available. The same environment gate is included in the NEW revision, so it remains paused after deployment. All new cron handlers, iCal bulk sync and pending-display cleanup also return without effects while that flag is set; registration of the new cron registry does not restart those writes during reseeding. Verify guest/staff writes and callbacks are blocked before proceeding. No schema reset is deployed here.
4. Export the quiesced OLD deployment, including file storage:

```sh
# Run in the operator's verified OLD-revision checkout, configured for the selected deployment.
# Add --prod only for the separately approved production execution.
pnpm exec convex export --include-file-storage --path /absolute/secure/path/before-phase1.zip
shasum -a 256 /absolute/secure/path/before-phase1.zip
```

Keep the export and old deployable revision until after acceptance. Set export permissions to 0600. Restore this exact export into an isolated old-schema backend before clearing shared data, compare every table count, and verify stored files. A checksum alone is insufficient. Do not put the export in git or a public artifact store.

## 3. Cancel scheduled work and clear while OLD schema is deployed

Call the temporary helper page by page (100 documents/page). Start with null cursor and pass each returned `continueCursor` until `isDone` is true:

```sh
pnpm exec convex run maintenance/reset:cancelScheduledPage '{"deployment":"REPLACE_WITH_VERIFIED_DEPLOYMENT","paginationOpts":{"numItems":100,"cursor":null}}' --codegen disable
```

Repeat the full scan once after cancellation. There must be zero pending cancellations and zero `inProgress` functions. If any function is running, keep ingress paused, let it finish and rescan; inspect its effects before clearing. Do not assume cancellation can interrupt already running external HTTP requests. Check the migrations component has no active runner; cancel it through the component's dashboard before clearing its state.

Once quiescence and the export are verified, use the OLD configured checkout and reviewed ZIPs:

```sh
pnpm exec convex import --component migrations --replace-all /absolute/path/output/phase1-reset/empty-migrations.zip
```

Observed in root's rehearsal/cutover: `--replace-all` applies to the whole component tree even with `--component migrations`. Inspect the CLI summary before confirming, then verify all 91 root tables and the component state. If the root is already empty, skip the redundant root clear. Only if the verified root still needs clearing, use the reviewed root ZIP:

```sh
pnpm exec convex import --replace-all /absolute/path/output/phase1-reset/empty-root.zip
```

The CLI prompts with the selected deployment and destructive replacement. Check that identity before confirming. For production add `--prod` to every selected command consistently. Do not use `--yes` on shared or production deployments. An automated isolated rehearsal may use it only after asserting its exact newly created preview identity. Confirm all OLD application tables and the component state are empty in the dashboard, and recheck scheduled work. The isolated rehearsal verified that an empty-root ZIP without `_storage` retains storage blobs; the exported storage is the rollback source. No old IDs should be reused in seeded data.

## 4. Deploy and reseed once

Reuse the `ARCH_MONEY_CUTOVER_AT` recorded BEFORE the first ingress pause in step2.1. Verify it is unchanged and record it with the export; do not advance it to the export, clear, deploy or seed time. Deploy ONLY the reviewed Phase 1 backend from the exact approved commit to the verified deployment, retaining `ARCH_RESET_PAUSED=1`. This controlled backend deploy precedes the frontend merge: it allows seed and backend acceptance before Vercel prerenders public pages. The later merge/build runs `vercel-build`/`convex deploy` again with the same compatible schema. Keep public traffic blocked by the all-path firewall deny rule and provider ingress paused throughout. The Vercel project must be unpaused to build. The migrations component and temporary reset helper disappear in this deploy. Inspect Convex deployment logs and confirm 74 schema tables.

```sh
pnpm exec convex run seed:seedAll '{"scenario":"demo-resort"}' --codegen disable
# Production execution uses --prod after the deployment mapping is checked again.
```

The scenario refuses every nonempty database, preventing a partial repair or second seed. Its response includes per-table counts and test access tokens: treat that output as private. Expected key counts: properties 3, tourScenes 5, reviews 7, reviewStats 3, staff 5, services 6, appointments 4, bookings 2, bookingPayments 1, orders 3, orderLines 1, conversations 1, messages 1. `empty` creates no records; `busy-weekend` creates six stays and 12 blocked nights in addition to the demo catalog/inbox.

Run `pnpm verify`, booking component tests and smoke tests. On the newly seeded backend, sign in through the configured owner allowlist and invite a cashier through Team (the reset clears role grants); verify the cashier cannot read yesterday's/future receipts. Complete a booking and a POS settlement (including a satang amount and percentage discount), apply/refund a coupon sale, review missing information, and send a web/social chat. Check Stripe unit_amount equals stored total, with no further ×100. Check refunded totals and affiliate credits remain integer satang.

## 5. Restore traffic and observe

With public traffic still blocked, clear the backend pause flag only after seed/count acceptance so the operator can run live backend checks. After backend acceptance, merge the reviewed PR. Keep the Vercel project unpaused under a temporary all-path firewall deny rule while its production frontend builds against the unpaused, seeded backend. If a frontend was already built during maintenance, deploy the same reviewed application once more. This refreshes the homepage/sitemap that may have been prerendered with an empty catalog while maintenance was active. Confirm the public catalog query returns the seeded active villas; remove the firewall deny rule and restore traffic only after that fresh deployment is READY and accepted. Restore cron registry and iCal operation as appropriate for the new deployed revision, then enable provider callbacks and Stripe delivery. Reconcile expired Stripe sessions and replay signed events. Financial events created strictly before `ARCH_MONEY_CUTOVER_AT` that reference deleted, malformed or foreign booking IDs return 200 and write deduplicated `stripe_orphan` history. Missing-booking expiry events are also acknowledged and recorded. Newer orphaned captures/refunds are recorded but return 500, keeping them visible as failed Stripe deliveries for owner reconciliation; missing cutoff configuration also fails visibly. Expiry and completion use distinct keys, so an expiry cannot hide a later payment. Current-booking mismatches still return an error for reconciliation. Check these history rows and provider delivery logs during the retry window.

## Rollback

Pause all ingress/writes and scheduling again. Export the failed new deployment separately. Cancel its scheduled functions with a reviewed helper for that schema. Use the generated `reset-new.ts` helper to cancel the new schema scheduler and `empty-new-root.zip` to clear the 74 NEW tables before redeploying the OLD schema, since new IDs and shapes cannot validate under the old one. Redeploy the recorded old application/maintenance revision, then import the original export using the matching old component tree and schema. Restore storage from the export as needed. Verify snapshot counts and business behavior before restoring ingress. Never import old baht values into the satang application.

External prerequisites remain operator-owned: verified Vercel/Convex mapping, provider-console pauses, Stripe session expiry, export, scheduler quiescence, old-schema clears, deployment, live reseed and live acceptance. None was performed by the implementation agent.

Root reported no production Stripe keys and no open stored Checkout sessions at this cutover. Actual Clerk browser login and external social sends were not tested; do not infer them from backend identity-impersonation acceptance. Shared development remained unchanged.
