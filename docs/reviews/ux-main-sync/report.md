# UX integration / main synchronization

Branch: `ux/main-sync`. Upstream: `d6303797bdb9fb8c74621c8aa7d295a10e990ecc`.
All 73 initially conflicted files are resolved; the Git index has no unmerged entries.
The final branch SHA is supplied in the completion message; this report is committed on that branch.

Merge commit: `d2549791a4fffc596facbf4e2e3d7e26efeec7d8`, with parents `324ea235bb98f32f93603135c54d39644e133723` (`ux/integration`) and `d6303797bdb9fb8c74621c8aa7d295a10e990ecc` (`origin/main`). Follow-up implementation commits: `ad01edbd`, `88c27064`, `beec6fb5`. This is a merge, not a rebase. The source branch was not changed.

## Conflict resolutions

| Area | Resolution |
| --- | --- |
| Backend POS and booking monoliths | Deleted `convex/pos.ts` and `convex/adminBookings.ts` stay deleted. Ported the integration delta into POS commands/queries/private implementations and bookings/services model interfaces. All registrations use upstream access builders. |
| Stay checkout | Added `pos/commands/openStayCheckout.openStayCheckout`. Services owns `readStayAppointments` through `services/model.ts`; bookings exposes the bounded stay summary. More than 50 appointments refuses before writes. A pre-write source refusal may be reported as skipped; any error after a write aborts the transaction. Reopening is idempotent through the existing source/order guards. |
| Open orders | Added `pos/orders.listOpenOrders` under checkout permission, sharing the manager browser row projection. It paginates the indexed draft rows before applying the existing read-access check, caps pages at 50 and includes cross-staff recall. Upstream's draft state replaces retired held rows. |
| Checkout UI | Kept the UX catalog, item editor, payment track, cash chips, automatic final split remainder, receipt/refund controls, payment-correction flow and copy. Adopted current domain references, order/appointment table names, schedule-only rows, shared rules and satang/basis-point values. |
| Money safeguards | Preserved attempt keys, lost-answer retries with frozen requests, reviewed revision/customer checks, NEEDS_APPROVAL/PENDING_APPROVAL behavior, refund caps, permission checks, `payLocked` recheck after discard, Covered only for complete split rows, display-only approval expiry and unsaved-draft guards. No money or permission assertion was relaxed to accept a failing result. |
| Stay/appointment financial sheets | Kept money-first summaries, Record external payment… wording, own dialogs, confirmation/dismissal guards, history and provenance. Use upstream explicit ledger records. Retired inference-based legacy fields are not added back to the schema or backend. |
| Display pairing and lease | Kept pairing/replacement/status UX and lease safety, using `api.pos.displays` and upstream POS display implementations. |
| Inbox/chats | Kept two-row phone header, Needs you/AI state copy, guest/task actions and draft guards. Upstream messaging APIs, inbox privacy, bounded reads, projections and head updates remain in the backend. |
| Settings/team/marketing | Kept sticky dirty save bars, people/role/invite behavior, subtle choices, coupon single-column summary and signed dashboard breakdowns. Cashier limits/coupon benefits use basis points and financial values use satang. |
| Test infrastructure | Used upstream's separate Vitest projects and real in-process Convex backend. Browser transport now awaits server operations and refreshes the intended query snapshot; unseen cross-till refund tests intentionally hold a stale local snapshot so the backend cap is still exercised. Missing historical references use valid deleted Convex IDs with readable test aliases. |
| Architecture | Took upstream scorecard verbatim. Extracted `CloseNothingDue.tsx` and `chat-shortcuts.tsx` to stay under the 1,000-line limit. Removed obsolete optional-client mocks and backend imports. Added the three endpoint access-inventory entries. |
| Generated API | Updated `convex/_generated/api.d.ts` by hand for the new domain command and private lookup module. No codegen/deployment command was invoked. Application, test and Convex typechecks validate the resulting API. |

## Snapshot/WIP feature disposition

The port compares actual source against the merge base and upstream; it does not assume snapshot commit `7e921b99` is an ancestor of upstream. The customer, display, lease, order lifecycle/link and booking-money implementations already have upstream counterparts; those counterparts were retained instead of reviving the old files.

| WIP feature | Final location / disposition |
| --- | --- |
| Customer corrections, archived/merged identities and safe contacts | `convex/pos/customers.ts`, `pos/private/customerModel.ts`; retained with the UX and upstream guards. |
| Payment amendments, void-unreceived flow, fee/order lifecycle and source links | `convex/pos/commands`, `pos/private/paymentCorrections.ts`, `orderLifecycle.ts`, `orderLinks.ts`; retained in satang with upstream audit/ledger behavior. |
| Stay balances, payment/refund corrections and source charge math | `convex/shared/orderMath.ts`, `shared/stayMoney.ts`, `convex/bookings/private/money.ts`, `stayCorrections.ts`; retained using upstream integer math. |
| Display take-over/replacement, release and heartbeat/lease protections | `convex/pos/displays.ts`, POS private display implementations, `shared/displayLease.ts`; retained. |
| Checkout history, issued-vs-corrected receipt, record sharing, customer/entity pickers and task/dialog UX | Retained in the UX components and real-backend tests. |
| Stay spa summary and atomic stay checkout added after the snapshot | Ported as the new services/bookings/POS interfaces described above. |
| Past calendar quick-create | Upstream's resort-day rejection wins for calendar taps/drags. Explicit historical entry remains in the Record past stay form; shared-time tests cover its title and notification default in multiple browser zones. The two calendar-entry tests now cover future quick-entry, with an added past-slot rejection test. |
| Inferred unitemised/legacy cancellation controls and old `held`/`startAt` shapes | Not resurrected. Explicit persisted unrecorded payments exercise the cancellation/reason/retry/draft behavior; draft orders and explicit optional schedules use upstream's current schema. |

## Schema, guardrails and constraints

- **No schema changes beyond upstream.** `convex/schema.ts` and all domain `tables.ts` files match `origin/main`; there are still 74 tables. No new field, index, migration or backfill is required by this port.
- **No architecture scorecard exemption or rule change.** `scripts/arch-scorecard.mjs` matches upstream byte-for-byte, `.arch-phase` remains 4. Knip lists retained historical UX audit scripts as entry points, rather than deleting them.
- The optional-client test mock and the deleted MarketingAccessScreen were not restored. The live application uses upstream's mandatory data/auth flow.
- No push, PR, deployment, Convex deployment connection, real Clerk session, `verify:integration`, `test:dev` or `test:e2e` was used. Backend tests use `convex-test` in process.

## Money boundary map

These are the port-specific application and test adapters. The upstream satang cutover throughout the other domains is retained. Values inside shared/backend rules remain safe integer satang; percentages are integer basis points. Human text alone uses baht/percent.

| File:line | Boundary |
| --- | --- |
| [src/components/checkout/CatalogPane.tsx:260](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/CatalogPane.tsx:260) | Custom item text (baht) → integer satang. |
| [src/components/checkout/OrderPanel.tsx:651](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/OrderPanel.tsx:651) | Custom-price draft comparison/rendering uses satangToBaht; writes use parseMoneyInput. Discount text uses the shared parser below. |
| [src/components/checkout/OrderPanel.tsx:677](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/OrderPanel.tsx:677) | Custom-price writes/approval payloads use integer satang. |
| [src/components/checkout/discount-input.ts:25](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/discount-input.ts:25) | Discount text → satang or basis points; shared lineStaffDiscount/roundRatio determine the amount and equivalent basis-point percentage. |
| [src/components/checkout/discount-input.ts:45](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/discount-input.ts:45) | Stored amount/percentage → human baht/percent form text. |
| [src/components/checkout/PayPanel.tsx:519](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/PayPanel.tsx:519) | Cash defaults/chips show baht; received text is parsed to satang before confirmation and settlement. |
| [src/components/checkout/PayPanel.tsx:632](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/PayPanel.tsx:632) | Split row text → satang before remainder, coverage and tender construction. Empty rows still cannot claim Covered. |
| [src/components/checkout/checkout-ui.ts:47](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/checkout-ui.ts:47) | Thai note thresholds/steps and the maximum are satang. Labels and change summaries format satang. |
| [src/components/checkout/checkout-ui.ts:158](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/checkout-ui.ts:158) | Receipt/share totals, deposit, refunds and net use satang directly; removed the previous refund-only division/conversion. |
| [src/components/checkout/PaymentRecord.tsx:160](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/PaymentRecord.tsx:160) | Correction drafts display baht; comparisons, dirty checks, frozen requests and status summaries parse to satang. |
| [src/components/checkout/ReceiptView.tsx:353](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/ReceiptView.tsx:353) | Receipt refund/net/line displays consume satang directly; keep issued receipt and corrected payment records separate. |
| [src/components/checkout/OrderStrip.tsx:757](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/OrderStrip.tsx:757) | Order-picker refund display consumes satang directly. |
| [src/components/checkout/FinancialHistory.tsx:188](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/FinancialHistory.tsx:188) | Ledger source totals/refunds/net retained stay in integer satang, with shared rounding. |
| [src/components/checkout/refunds.ts:31](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/refunds.ts:31) | Refund text ↔ satang parsing/formatting; existing caps and approval payload amounts remain satang. |
| [src/components/checkout/staff-approvals.ts:35](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/staff-approvals.ts:35) | Exact cashier limit labels convert basis points to percent. |
| [src/components/checkout/staff-approvals.ts:73](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/checkout/staff-approvals.ts:73) | Approval summary converts basis points before rounding its display to one decimal; payload stays exact. |
| [src/components/admin/AppointmentFinancials.tsx:103](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/AppointmentFinancials.tsx:103) | Refund defaults display baht, cap validation compares parsed satang, and mutation/confirmation amounts are satang. |
| [src/components/admin/BookingFinancials.tsx:407](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/BookingFinancials.tsx:407) | Stay refund default/cap and correction/payment reviews use upstream satang parsing and formatting. |
| [src/components/admin/BookingSheet.tsx:418](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/BookingSheet.tsx:418) | Stored custom stay total → baht text; dirty baseline converts the original total to the same baht text, so an untouched form is clean. Reviewed writes retain the integer pricing/revision contract. |
| [src/components/admin/OtaRatesDialog.tsx:71](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/OtaRatesDialog.tsx:71) | OTA entered rates → satang; stored rates render back to baht input. |
| [src/components/admin/admin-bookings-shared.ts:125](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/admin-bookings-shared.ts:125) | Shared stay money entry text → integer satang, with existing validation. |
| [src/components/admin/stay-spa.ts:34](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/stay-spa.ts:34) | Stay spa summary sums already-stored satang without reapplying a baht conversion. |
| [src/components/admin/TeamSettings.tsx:410](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/TeamSettings.tsx:410) | Cashier limits display percent from basis points; saves use percentToBasisPoints and the reviewed revision. |
| [src/components/admin/marketing/AffiliatesView.tsx:67](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/marketing/AffiliatesView.tsx:67) | Affiliate settlement draft renders stored satang as baht; upstream command payload retains satang. |
| [src/components/admin/marketing/coupon-form.ts:54](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/marketing/coupon-form.ts:54) | Checkout parser returns satang/basis points; coupon form converts back to human text before couponRulesFrom converts once at the command boundary. |
| [src/components/admin/marketing/coupon-form.ts:140](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/marketing/coupon-form.ts:140) | Coupon amount/percent, saving cap, minimum spend and budget drafts become satang/basis points once. |
| [src/components/admin/marketing/marketing-format.ts:28](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/marketing/marketing-format.ts:28) | Marketing money display uses satang; basis-point offer labels/discount percentages use upstream conversions. |
| [src/components/admin/marketing/dashboard/DashboardChart.tsx:18](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/src/components/admin/marketing/dashboard/DashboardChart.tsx:18) | Chart tick labels convert satang to baht for K/M abbreviations; chart values/CSV stay satang. |
| [convex/bookings/private/stays.ts:191](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/convex/bookings/private/stays.ts:191) | Calendar/Today balance projection uses upstream shared integer stay money; no new stored amount or per-row read. |
| [convex/pos/commands/openStayCheckout.ts:9](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/convex/pos/commands/openStayCheckout.ts:9) | Stay/appointment charges use upstream source/order math in satang; overflow and transaction safeguards retained. |
| [convex/pos/orders.ts:330](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/convex/pos/orders.ts:330) | Open-order picker returns the same integer totals, remaining due and refunds as manager listOrders. |
| [tests/browser/booking-desk-fixture.tsx:61](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/booking-desk-fixture.tsx:61) | Test-only villa/service/deposit helper arguments convert human fixture values to satang. |
| [tests/browser/booking-desk-fixture.tsx:74](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/booking-desk-fixture.tsx:74) | Test-only saved deposits are integer satang. |
| [tests/browser/booking-desk-fixture.tsx:131](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/booking-desk-fixture.tsx:131) | Test-only service price helper returns integer satang. |
| [tests/browser/staff-roles-fixture.tsx:223](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/staff-roles-fixture.tsx:223) | Test-only cross-till percentage controls convert human percent to basis points. |
| [tests/browser/marketing-dashboard-fixture.tsx:32](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/marketing-dashboard-fixture.tsx:32) | Custom negative-net scenario cash events are satang, preserving signed display expectations. |
| [tests/browser/checkout-history-r6-fixture.tsx:17](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/tests/browser/checkout-history-r6-fixture.tsx:17) | Historical ledger net-before/net-after and refund amounts are all satang. |

Machine-readable equivalent: [money-boundaries.tsv](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/docs/reviews/ux-main-sync/money-boundaries.tsv).

## Test changes

The complete file-by-file inventory contains **260 added/modified/deleted test files relative to `ux/integration`**, including tests inherited unchanged from upstream: [test-changes.tsv](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/docs/reviews/ux-main-sync/test-changes.tsv). Test fixtures/helpers changed relative to upstream are separately enumerated in [test-support-changes.tsv](/Users/macbook/.t3/worktrees/360-tour/t3-7a8e0a71-a4f51b3069bb21b1/docs/reviews/ux-main-sync/test-support-changes.tsv).

Material cases to review:

- New coupon adapter regression verifies human 20% / ฿500 becomes exactly 2,000 basis points / 50,000 satang, and nightly savings use stored satang.
- New standard/custom stay-price close regressions verify pristine baht drafts stay clean and send no mutation. Existing dirty-dismissal/retry tests remain.
- Calendar quick-entry cases now use future dates, retain villa/exclusive-end assertions, and add explicit refusal of past taps and drags. Browser resort-midnight checks remain and now assert no dialog opens for a rejected slot.
- Old legacy-inference cancellation/draft cases now use a persisted unrecorded payment. Reasons, reviewed revision, pending controls, unchanged retry key and unsaved-dismissal assertions remain.
- Schedule fixtures use explicit optional schedules in place of retired `startAt`; date/time presentation and blank-part assertions remain.
- The lazy-history hook is expected to render twice for its first real asynchronous query (loading, loaded). Assertions still require no pre-expansion subscription, retained mounts/cursors across collapse and reset on order change.
- Pending line-discount tests hold a real backend response explicitly, so Saving… and duplicate-submit checks are deterministic.
- Refund tests retain exact remaining-cap failures and frozen retries; cross-till fixture operations are awaited. Cash/split/corrections/limits/settlement assertions were converted to satang/basis points.

**No test file was deleted by this port relative to upstream.** The following 20 deletions are inherited from `origin/main`; they are listed explicitly rather than hidden in the merge. No additional UX test file was discarded to get a gate green.

| Deleted test file | Reason |
| --- | --- |
| `convex/facebook.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/inboxBackfill.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/instagram.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/knowledgeScale.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/legacyQa.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/line.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/orderBackfill.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/serverSecret.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `convex/whatsapp.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/e2e/demo-disclaimer.spec.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/booking-documents.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/chat-fallback.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/chat-session-cache.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/chat-session-recovery.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/instagram-webhook.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/line-webhook-handler.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/messaging-reply.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/meta-webhook.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/whatsapp-ai-context.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |
| `tests/unit/whatsapp-rich-webhook.test.ts` | Inherited unchanged from upstream: the old source/contract was retired in the architecture refactor. |

## Gate results

All commands use Node 22 and pnpm 10.30.3. The lockfile merged without conflict and was not regenerated.

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; unchanged lockfile. |
| `pnpm typecheck` | Passed: app, tests and Convex (3 scopes). |
| `pnpm exec eslint . --max-warnings 0` | Passed: 0 errors, 0 warnings. |
| `pnpm knip` | Passed: 0 reported findings. |
| `pnpm arch:score --phase "$(cat .arch-phase)"` | Passed: 32/32; rechecked after the final report commit. |
| `pnpm exec vitest run --maxWorkers=3 --testTimeout=30000` | Passed: 277 files, 3,263 tests. |
| `BOOKING_UI_PORT=4374 pnpm exec playwright test -c playwright.booking.config.ts --workers=2` | Passed: 592 tests; 271 existing conditional capture tests skipped (863 collected). No skip was added to make this port pass. |
| `pnpm build` | Compiled and passed Next's TypeScript step, then failed page-data collection: **`NEXT_PUBLIC_CONVEX_URL is required`**, first reported for `/[locale]/rooms/[id]`. No placeholder/deployment URL or Clerk credentials were supplied. |

Build is the remaining environment-backed blocker. No other missing build variable was reported before that failure; later requirements have not been inferred as passing.
