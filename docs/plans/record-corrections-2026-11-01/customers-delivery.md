# Customer correction delivery

Implemented in `/Users/macbook/Development/360-tour-pos-checkout`, branch `fix/audited-record-corrections`. No commits, pushes, PRs, deployments, provider calls, live writes, package installs, child agents, or generated-file edits were performed. Concurrent/preexisting changes were preserved. Only the customers table section of schema.ts was patched, using narrow contextual patches.

## Delivered files

- `convex/customers.ts`: paginated customer browse, profile details, order/history readers, revision-aware editing, archive/restore, guarded merge endpoint, tested atomic merge transaction helper, POS integration helpers.
- `convex/schema.ts`, **customers section only**: optional `revision`, `archivedAt`, `mergedInto`, `mergeKey`, `mergeReason`; index `by_archivedAt`. Existing documents remain valid and missing revisions mean zero.
- `src/components/checkout/OrderStrip.tsx`: linked-customer View / edit; Details on search results; active/archived access; cursor paging; pending profile writes prevent dismissing the customer dialog.
- `src/components/checkout/CustomerDetails.tsx`: customer details/editor, visible archive/restore, full paginated orders/history, explicit duplicate selection/review with reason and stable attempt key, visible integration guard.
- `src/components/checkout/backend.tsx`: typed reads and actions for these workflows.
- `src/components/checkout/convex-backend.ts`: live query/mutation adapters.
- `src/components/checkout/fixture-backend.ts`: correction, archival and history fixtures; existing search failure/loading seam retained underneath the paginated fixture interface. Public fixture merge remains guarded, matching production.
- `convex/customers.corrections.test.ts`: new backend regression tests.
- `tests/unit/pos-customer-corrections.test.ts`: new behavioral UI regression tests.
- This report.

## API semantics

All registered functions require an authenticated allowed admin through `requireAdmin`. History rows are written through the incumbent `appendRecordHistory` in the same transaction as their changes. Snapshot inputs select customer business fields; no tokens, provider credentials, booking access secrets, or unrelated source documents are captured.

- `browseCustomers({query, archived, paginationOpts})`: active or archived records, cursor-paginated (1–50 rows per underlying page). Empty/one-character input browses the selected archive state. Otherwise email uses exact normalized lookup, phone-like input with at least four digits uses exact digits, and other text searches name. Search pages filter archive state in memory **after** pagination and retain the underlying continuation: a page can be empty and still have more results. UI always offers Load more when there is a continuation. Same names remain separate profiles; there is no automatic matching/merge.
- `searchCustomers({query})`: preserved legacy bounded suggestion API for existing callers; archived/merged profiles excluded. Production picker, merge selection and duplicate-contact suggestions all use `browseCustomers` with pagination for complete navigation. The old endpoint is retained for API compatibility and has no production checkout reader.
- `getCustomer({customerId})`: returns identity/contact/notes, revision (legacy zero), archive/merge destination, `mergeEnabled`, and first ten recent orders with `ordersHasMore`. Full orders/history use the readers below.
- `listCustomerOrders({customerId,paginationOpts})`: bounded cursor pages of linked order IDs, permanent titles, states, totals/currencies. No receipt mutation.
- `customerHistory({customerId,paginationOpts})`: bounded cursor pages of customer recordChanges. UI renders actor, recorded time, kind, reason and selected before/after business values, including both identities for merges. It explicitly states earlier changes may not have been recorded.
- `createCustomer`: preserves existing validation/create logging and initializes revision zero.
- `updateCustomer({customerId,expectedRevision?,name,phone?,email?,notes?})`: trims/validates the full replacement profile; omission clears optional contact/notes fields. Exact no-ops do not create history or revisions. Production editor always passes the revision captured when editing began; it retains that revision/draft through reactive changes and save errors. A stale revision rejects. `expectedRevision` remains optional solely for existing API compatibility; migrate remaining legacy callers before making it required. Existing legacy invalid phones can survive unrelated edits, and invalid legacy emails can be corrected without history validation rejecting the old value. Merged-away profiles cannot be edited.
- `setCustomerArchived({customerId,expectedRevision,archived})`: revision check, archive/restore, revision increment and atomic history. No reason prompt. Orders and receipt snapshots remain linked/intact. Merged-away identities cannot be restored.
- `mergeCustomers({sourceId,destinationId,sourceRevision,destinationRevision,reason,idempotencyKey})`: **currently guarded pending POS integration below**. Once enabled, calls `mergeCustomerRecords`, an unregistered transaction helper. Both revisions are required, source and destination must differ, neither can already be merged, and destination must be active. Source may be archived deliberately. Reason is 1–1000 trimmed characters and attempt key is 8–100 characters. No name-based inference.

The atomic merge supports at most **100 total source order references**, counting paid, void, empty and open orders. It reads 101 and refuses the entire operation above the bound. This is an explicit atomic bound, not silently truncated progress or a partially completed batch. Larger merges require a separately reviewed durable migration; none is implied by this implementation.

A successful merge repoints every source bill's `customerId`, keeps all bill IDs/numbers, booking/appointment/parent links, lines, payments, ordering timestamps and issued `customerSnapshot` values, and bumps revisions on draft/held source orders. It retains the source identity, marks it archived with destination/key/reason, and increments both profile revisions. It appends one recordChanges row per moved order and a full selected before/after identity record on both profiles. Destination fields/notes are retained; source fields/notes remain accessible on its archived identity/history. A same source/destination/key/reason retry returns `{replayed:true,destinationId}` without additional writes/history, even with the original revisions. Reusing a completed attempt with a different reason, destination or key rejects. Initial success returns `{replayed:false,destinationId}`.

## POS integration required before shipping merge or scalable high-count identity edits

**Do not enable `CUSTOMER_POS_INTEGRATION_ENABLED` until these changes and their caller tests are integrated by the POS owner.** It is currently `false` and controls both public merging and scalable customer invalidation. Merge review is available, but submission is visibly disabled; direct API submission also rejects before any writes. This guard prevents the incumbent `pos.linkCustomer` from adding new references to a merged-away source.

Current safe fallback for customer name/phone/email corrections:

1. Read draft and held links with a bounded 1001-row overfetch per status.
2. Reject if either status exceeds 1000 linked records (honest scan-budget error; no partial write).
3. Count **only `hasItems`** orders across both statuses and reject above 100 nonempty unpaid orders.
4. Otherwise bump those order revisions atomically with the profile/history, **without updating bills.updatedAt**. Empty orders and paid/void orders are untouched. Thus >100 empty linked orders now work (150 is tested), and reviewed stale payments are rejected by the existing order revision check.
5. Notes-only corrections do not scan/invalidate orders. All overflow failures leave profile/order/history unchanged. Error copy no longer says to clear orders; clearing retains their customer links.

This intentionally does **not** claim the >100-nonempty or >1000-linked cases are solved until POS adopts the revision protocol below. Keeping the guard is required to avoid accepting checkout reviewed with stale identity details. The scalable path is already present: after integration, enabling the constant skips the linked-order scan and relies on customer revision validation, so identity corrections are O(1) regardless of linked order count.

Minimal POS patch contract (no bills schema changes or new index required):

1. In `pos.linkCustomer`, after fetching the profile and **before** `editableOrder` or same-customer early return, call the supplied `assertCustomerCanLink(customer)` from `customers.ts`. It rejects missing, archived and merged-away profiles. Never silently redirect a merged ID. Existing already-linked archived customers may still settle after explicit review.
2. In `pos.settleOrder`, add `expectedCustomerRevision: v.optional(v.number())` to args. Keep all current admin, idempotency key, already-paid replay, due/order revision, source/live-provider and tender checks. After the existing replay branch, fetch the current linked customer; if `order.customerId` exists, call supplied `assertCustomerReviewed(customer,args.expectedCustomerRevision)` **before any write**. It rejects missing/merged identities and missing or mismatched revisions (legacy stored revision is zero). Fetch/check participates in the same mutation transaction as settlement, providing OCC protection for concurrent corrections/merges.
3. `getOrder` already uses the expanded `customerCard` and now exposes current profile revision (its missing-customer fallback lacks a revision). The checkout payment attempt must capture `expectedCustomerRevision` from the **reviewed view**, alongside `expectedRevision`/`expectedDue`, before async queueing. Pass undefined for no linked customer, zero for legacy revision. Do not look up/substitute the latest customer revision at send/retry time: that would silently accept an unseen correction. Update PayPanel/payment attempt types and fixture settlement in the POS-owned scope accordingly. Keep the original attempt values on network retry; a stale customer error requires explicit renewed review/new attempt. Do not move the customer check before successful payment replay handling.
4. After caller tests pass, flip `CUSTOMER_POS_INTEGRATION_ENABLED = true`. This enables merge and automatically removes the temporary customer edit scan/count bound. Align fixture `mergeEnabled` and its merge action with the enabled implementation as part of the integration. The current fixture intentionally matches the disabled feature.
5. Extend actual POS/payment caller tests: stale/missing customer revision, >100 nonempty plus >1000 empty edits using O(1) invalidation, old linked archived profile versus new archived link, merged source new link rejection, merge racing link/payment, same-attempt already-paid replay after profile edits/merge, destination/source review revisions, and normal provider protection. Current guard-specific tests should be updated to the enabled contract when the constant changes.

No `pos.ts`, PayPanel, generated files or other workers' files were changed. Existing generated API types already import the `customers` module, so added customer functions/types resolve without editing generated declarations. The parent should run ordinary local Convex codegen after integrating all workers (including the shared `recordHistory` module, which the current generated API does not list). This implementation uses its safe dedicated history reader and does not need to hand-edit generated output.

## Verification

Read target AGENTS.md, installed Convex guidelines, implementation.md, independent-audit.md, the installed Next `use client` guide, and the requested craft-floor reference before edits. Retained incumbent controls/theme and checkout touch-target wrapper. No browser visual verification was performed; component interaction tests exercise actual rendered controls.

- `pnpm exec vitest run convex/customers.corrections.test.ts convex/pos.test.ts tests/unit/pos-customer-corrections.test.ts tests/unit/pos-customer-order-switch.test.ts tests/unit/pos-order-recovery.test.ts tests/unit/pos-checkout-error-recovery.test.ts`: **6 files, 101 tests passed**. This includes 17 new backend cases and 9 new UI cases, plus incumbent POS/customer/recovery coverage.
- `pnpm typecheck`: **passed** (app, tests, Convex).
- Targeted normal ESLint over every owned TS/TSX implementation and new test file: **passed**, zero warnings/errors after cleanup.
- `git diff --check`: **passed**.
- Runtime environment reports Node 24.19.0 versus package engine 22.x; no environment/package changes were made. No build or live-provider verification was run in this bounded task.

Behavioral evidence covers atomic customer edit/history and no-op handling, stale editor revisions/draft retention, legacy profiles, archive/restore discoverability and unchanged receipt snapshots, >20 namesakes, empty filtered pages with continuation, exact contacts, full order/history pagination, only nonempty draft/held invalidation without ordering changes, 150 empty plus an active order, >100 active and >1000 linked safe failures, stale payment rejection, merge identity/order/payment/line/receipt preservation and both history entries, retry idempotency and changed payload rejection, merge conflicts/limits, the public integration guard, and denial to non-admins. UI evidence covers linked and searched profile access, save failure/retry without creation, concurrency protection, pending dismissal protection, archive/restore access without reason prompts, merge selection/reason/retry values and guarded submission, pagination controls, and disconnected search recovery.

Remaining integration is exactly the POS contract above; merge is intentionally not enabled and high-count receipt-identity corrections are intentionally not represented as ready before that integration. The complete owned UI/API transaction paths and safe fallback are delivered.
