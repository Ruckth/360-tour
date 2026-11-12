# Phase 1 cutover (operator runbook)

Status: prepared for parent review; no shared deployment has been reset. Run on an isolated backend first. The operator verifies the chosen Vercel project and its exact Convex deployment mapping, repeats on shared dev, then owns production execution. Production is `wary-toad-189` according to the parent's verified mapping; never infer this from a local `.env.local`. Keep all keys out of logs and git.

The new schema has 74 tables: 87 from main, four staff/refund tables, minus 14 retired tables and the net three removed by the channel-event merge. All money changes units in the same reset. Importing the old snapshot into the new schema is prohibited. The payment tables stay separate and retain their settlement links.

## 1. Prepare and review offline

From the implementation checkout:

```sh
node scripts/architecture-reset.mjs --old-ref 72a657f --out output/phase1-reset
cat output/phase1-reset/manifest.json
pnpm exec vitest run convex/phase1Architecture.test.ts convex/moneyCutover.test.ts convex/staffRoles.test.ts convex/posRefunds.test.ts
```

The program generates two empty snapshot ZIPs, an exact OLD schema/table manifest, and a temporary internal scheduler helper. It does not execute Convex or contact any backend. Review both ZIPs with `unzip -l`. The root ZIP has all 91 old table directories; the component ZIP has the migrations component's `migrations` table. Select a newer old revision if the reviewed dependency schema changed before cutover; regenerate and inspect the count and schema hash.

Record the old application commit, the new application commit, selected deployment, Vercel deployment URLs, database export path/checksum, provider-webhook settings and cron names. There are eight cron jobs in the integrated old revision (the plan's seven was stale).

## 2. Quiesce the OLD deployment

1. Put the public site in maintenance mode and stop staff writes. Disable all LINE/Meta/WhatsApp provider callbacks. Disable Stripe webhook delivery temporarily; list and expire every open Stripe Checkout session in the Stripe dashboard. Record their IDs for reconciliation. Pause iCal import jobs.
2. On the OLD application revision, copy the prepared `reset.ts` to `convex/maintenance/reset.ts`. Its import is correct at that location. Set `ARCH_RESET_PAUSED=1` on the selected Convex deployment. The temporary helper checks both this flag and the deployment's `CONVEX_CLOUD_URL`.
3. Temporarily replace only the OLD revision's cron default export with an empty `cronJobs()` registry, preserving its function definitions. Add a temporary maintenance 503 response to all old Next channel POST routes and the old Convex HTTP router. Deploy this small maintenance patch with the OLD schema still intact. Verify callbacks and guest/staff writes are actually paused before proceeding. No schema reset is deployed here.
4. Export the quiesced OLD deployment, including file storage:

```sh
# Run in the operator's verified OLD-revision checkout, configured for the selected deployment.
# Add --prod only for the separately approved production execution.
pnpm exec convex export --include-file-storage --path /absolute/secure/path/before-phase1.zip
shasum -a 256 /absolute/secure/path/before-phase1.zip
```

Keep the export and old deployable revision until after acceptance. Do not put the export in git or a public artifact store.

## 3. Cancel scheduled work and clear while OLD schema is deployed

Call the temporary helper page by page (100 documents/page). Start with null cursor and pass each returned `continueCursor` until `isDone` is true:

```sh
pnpm exec convex run maintenance/reset:cancelScheduledPage '{"deployment":"REPLACE_WITH_VERIFIED_DEPLOYMENT","paginationOpts":{"numItems":100,"cursor":null}}' --codegen disable
```

Repeat the full scan once after cancellation. There must be zero pending cancellations and zero `inProgress` functions. If any function is running, keep ingress paused, let it finish and rescan; inspect its effects before clearing. Do not assume cancellation can interrupt already running external HTTP requests. Check the migrations component has no active runner; cancel it through the component's dashboard before clearing its state.

Once quiescence and the export are verified, use the OLD configured checkout and reviewed ZIPs:

```sh
pnpm exec convex import --component migrations --replace-all /absolute/path/output/phase1-reset/empty-migrations.zip
pnpm exec convex import --replace-all /absolute/path/output/phase1-reset/empty-root.zip
```

The CLI prompts with the selected deployment and destructive replacement. Check that identity before confirming. For production add `--prod` to every selected command consistently. Do not use `--yes`. Confirm all OLD application tables and the component state are empty in the dashboard, and recheck scheduled work. Storage blobs remain until explicitly cleaned; the exported storage is the rollback source. No old IDs should be reused in seeded data.

## 4. Deploy and reseed once

Deploy the reviewed Phase 1 application via the usual Vercel production flow (`vercel-build` runs `convex deploy`). Keep provider ingress and the public maintenance gate paused throughout. The migrations component and temporary reset helper disappear in this deploy. Inspect Convex deployment logs and confirm 74 schema tables.

```sh
pnpm exec convex run seed:seedAll '{"scenario":"demo-resort"}' --codegen disable
# Production execution uses --prod after the deployment mapping is checked again.
```

The scenario refuses every nonempty database, preventing a partial repair or second seed. Its response includes per-table counts and test access tokens: treat that output as private. Expected key counts: properties 3, tourScenes 5, reviews 7, reviewStats 3, staff 5, services 6, appointments 4, bookings 2, bookingPayments 1, orders 3, orderLines 1, conversations 1, messages 1. `empty` creates no records; `busy-weekend` creates six stays and 12 blocked nights in addition to the demo catalog/inbox.

Run `pnpm verify`, booking component tests and smoke tests. On the newly seeded backend, sign in as owner and cashier; verify the cashier cannot read yesterday's/future receipts. Complete a booking and a POS settlement (including a satang amount and percentage discount), apply/refund a coupon sale, review missing information, and send a web/social chat. Check Stripe unit_amount equals stored total, with no further ×100. Check refunded totals and affiliate credits remain integer satang.

## 5. Restore traffic and observe

Remove maintenance mode and the pause flag after smoke acceptance. Restore cron registry and iCal operation as appropriate for the new deployed revision, then enable provider callbacks and Stripe delivery. Reconcile expired Stripe sessions and replay signed events. Deleted-booking completion/refund events return 200 and write a deduplicated `recordChanges` row with entity type `stripe_orphan`. Current-booking mismatches still return an error for reconciliation. Check these history rows and provider delivery logs during the retry window.

## Rollback

Pause all ingress/writes and scheduling again. Export the failed new deployment separately. Cancel its scheduled functions with a reviewed helper for that schema. Clear the NEW tables before redeploying the OLD schema, since new IDs and shapes cannot validate under the old one. Redeploy the recorded old application/maintenance revision, then import the original export using the matching old component tree and schema. Restore storage from the export as needed. Verify snapshot counts and business behavior before restoring ingress. Never import old baht values into the satang application.

External prerequisites remain operator-owned: verified Vercel/Convex mapping, provider-console pauses, Stripe session expiry, export, scheduler quiescence, old-schema clears, deployment, live reseed and live acceptance. None was performed by the implementation agent.
