# Stock and Dashboard rollout

## Roll forward

1. Record the deployed application and Convex revisions. Take a restorable backup and record control totals for purchase orders, receipts, stock movements, on-hand quantities and open incoming quantities. Include samples of order revisions, receipt lines, linked ledger entries and variant IDs.
2. Deploy the widened Convex schema, indexes and functions. Wait for schema validation and index readiness. Verify that an existing receipt can be reopened and an old-client receipt request can be retried with its original operation key.
3. Run the internal `commerce/purchasing:backfillSupplierData` mutation for each source, `orders`, `receipts` and `contacts`. Start with `{"source":"orders","dryRun":true}` to preview a batch. Repeat each source with `dryRun` omitted until a follow-up call reports both `isDone: true` and zero processed. Check legacy suppliers' open-order counts, delivery history and contact matching before relying on the projections.
4. Run internal `commerce/stock:backfillVariantSearch` with `{"paginationOpts":{"cursor":null,"numItems":25},"continueBatches":true}`. Verify older variants in catalog search after scheduled batches finish. Historical activity already uses the legacy row data. The optional `commerce/stock:backfillMovementFilters` refreshes actor search keys only. Pass 25 items and each returned cursor until `isDone`. Check that historical reason codes still match the retained evidence.
5. Release the application and verify receiving, stock activity, legacy variant search and the finance dashboard using the appropriate roles. Reconcile receipt quantities against stock movements and open incoming quantities for the sampled orders.

## Roll back the application

Keep the widened Convex schema, indexes and compatible function deployment. Restore the previous application and smoke-test legacy requests against that backend. Check receipt and order detail, replay a receipt with the same operation key, and verify that the replay creates zero additional receipts or movements. Compare stock and purchasing control totals with the pre-rollback readings and account for any writes during the interval. Check which active orders or custody states require controls introduced in the new application. Route those cases to a compatible admin workflow before restoring old-client traffic.

If prepared profitability views must be drained, follow [Profitability snapshot rollback](profitability-snapshot-rollback.md) through the repeat drain check. Keep the pause active while rolling back application traffic if prepared pages need to stay unavailable. The finance guide’s previous-backend step applies only after the Stock and Purchasing downgrade prerequisites below have also been met.

## Prerequisites for a strict backend downgrade

Quiesce writers and scheduled work that can create widened records. Restore a copy of the current data in isolation and inventory validator differences, pending jobs and index dependencies against the exact rollback revision. Include nested fields and new enum values, both source and derived tables, and data persisted by backfills. Prepare an audit-preserving conversion for every incompatible record and agree on how the older application will handle any state it cannot represent. Validate the old schema on the converted copy and reconcile IDs, quantities, money, and audit history before choosing a downgrade window. Retain a restorable copy of the widened state.

## Local rehearsal

An isolated Convex instance started on `ef637a55` and accepted a purchase order, a partial receipt, and a profitability source view. After deploying the widened backend, the stored records matched the baseline. Supplier backfills processed one order, one receipt and ten contacts, then returned zero on repeat calls. The activity backfill left the already-indexed movement and its evidence intact.

After old-client receiving, new-client receiving with a 20,000 satang invoice total, and an old-client receipt against the retained backend, the fixture held two orders, four receipts, four ledger movements, ten units on hand and ten units incoming. Replaying the original and rollback receipts added no rows. The profitability drain removed an actual prepared view and a synthetic 35-chunk child while retaining the original source. With the drain complete, Convex still rejected the strict `ef637a55` downgrade because the supplier validator lacked `contactKeysApplied`.

The rehearsal used legacy API payloads for the application rollback path. It did not deploy a previous frontend build or measure migration throughput on production-sized data.
