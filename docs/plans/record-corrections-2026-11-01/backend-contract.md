# Backend contract — implementation in progress

No new financial correction APIs are available yet. Existing payment, source uniqueness and receipt rules remain authoritative. Do not integrate against proposed APIs in the audit.

## Delivered APIs

Pending implementation verification.

## Coverage

Prior findings 1–8 and B1–B15 remain open unless explicitly marked delivered below. This document does not claim complete backend or UI delivery.

## Actual foundation delivered

`recordHistory.list({entityType: string, entityId: string, paginationOpts: {numItems: number, cursor: string|null}})` is admin-only. numItems must be an integer from 1 to 100. Returns Convex pagination `{page, isDone, continueCursor}`. Each page row contains `_id`, `_creationTime`, `entityType`, `entityId`, `recordedAt`, `effectiveAt`, `actor`, `kind`, optional `reason`, `before`, `after`. New customer create/edit operations append selected profile snapshots atomically. Entity type is `customer`; kinds are `created` and `edited`. Existing historical customer state is not reconstructed. No generic public write/undo endpoint exists.

Internal helper `appendRecordHistory(ctx,event)` must receive explicitly selected non-secret fields. No settings credential snapshots are authorized. Legacy appointmentChanges and billAudit remain untouched and readable through existing APIs.

## Remaining delivery (all open)

1 order discard/restore/history; 2 historical appointments; 3 booking correction/history; 4 refunds; 5 status correction; 6 customer archive/merge and >100 order handling (profile history foundation only); 7 ordinary POS line history; 8 configuration history and roster semantics.

B1 price override; B2 partial refund; B3 payment-entry correction; B4 effective dates outside new history; B5 fee path; B6 deletion snapshots; B7 notification controls; B8 archived sources; B9 net refund balances; B10 creation/payment actors outside customers; B11 revisions; B12 past time-off query; B13 frontend confirmation; B14 assignments/roster versions; B15 refunded metadata: all unresolved. No frontend completion is claimed. Payment correction APIs must not be inferred from this foundation.
