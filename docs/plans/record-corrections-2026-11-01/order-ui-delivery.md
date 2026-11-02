# Remaining checkout workflow integration delivery

Working tree only in `/Users/macbook/Development/360-tour-pos-checkout`, branch `fix/audited-record-corrections`. No commit, push, PR, merge, deployment, live write, install or subagent. Existing theme and concurrent checkout/customer/payment work were retained. Parent owns release and fixed-head reviews.

Read target AGENTS, installed Convex guidelines, installed Next `use-client` documentation, Impeccable skill/context/craft floor, implementation/checkout-delivery/financial-delivery/independent-audit, and the eventual orders-delivery and appointment-finance-stripe-delivery. The later parent instructions override Kiro's original plain-void fee policy.

## Delivered workflows

- Orders Unpaid has a direct Discard action, without a reason prompt. It loads the real selected order and captures its reviewed revision. Discarded has independent paging and explicit Restore review. Empty filtered pages still offer continuation. List entries retain customer/source information and show discard actor/time/reason.
- A pending discard/restore lives outside its list, so disappearance from Unpaid does not destroy a lost-response retry. First submitted revision, complete arguments, removal choice and attempt key stay frozen. Retry sends identical arguments. Pending guards duplicate submission, Close, Escape and outside dismissal; errors retain recovery choices. Leaving an unsuccessful attempt explicitly returns to current Orders review.
- Restore presents blocking source conflicts first, links to the actual competing order, and explicitly offers restore without conflicting rows. All-conflict orders remain discarded. Success displays returned removal names and warnings. Changed source rows keep their old price/details until Update; paid/unavailable source rows require removal before payment. Removed rows remain in readable snapshot history.
- Selecting the current discarded order keeps it on screen, read only. CheckoutView sends only paid/void states to receipt. Catalog, payment, customer attachment and booking attachment cannot edit the discarded order. Rows, customer/source links and history remain readable. A discarded receipt URL offers the real order instead of rendering a receipt. Copy explicitly says bookings/appointments are not cancelled.
- `AppointmentFeeAction` is exported **and mounted in AppointmentSheet**, alongside the preserved AppointmentFinancials. The actual appointment ID/details drive no-show or late-cancellation eligibility, whole-satang amount/cap, required reason and local reviewed-revision invalidation. Its real fee orders link to incumbent locale-aware checkout/receipt navigation. Lost-response recovery directs to the actual fee order rather than collecting another fee.
- AppointmentSheet's fee pending state guards Close/Escape/outside dismissal and appointment status/edit/navigation controls. Fee links cannot navigate during the write. The component callback is `onPendingChange`.
- Fee rows clearly say service not given, preserve their reason, and expose removal without quantity/discount/price overrides. Fees are not attached as ordinary appointment service rows. Backend no-show attachment refusal is preserved. Plain void retains actual fee money and continues to block a second fee; only `voidUnreceived` releases a previously paid fee. The fee control reads the actual void order to distinguish these cases because appointmentFees itself does not return the no-money flag.
- Receipt rendering accepts the parent's actual `getOrder.refunds` discriminated booking/appointment union. Recent projections show amount, method, reason, effective/recorded dates, actor and correct source reference. Original receipt lines, issue time, tenders, text sharing and printed article remain as issued.
- Browse all financial history exposes four independent typed streams: amendments, receipt activity, stay refunds and appointment refunds. Each has loading, empty, error/retry, loading-more and full continuation. Corrections show readable before/after tenders, customer/contact and received-date changes. Refund rows show actual source, actor/date/method/reason and recorded net snapshots; provider IDs are shown where supplied.
- Per-source refund balances use the full paginated reader, not the bounded getOrder preview. A partial page says Refunds shown and requests older refunds. Only an exhausted stream shows complete Refunded/Net retained amounts, using the actual original source line money from that receipt (after its real deposit). Missing original source lines do not produce invented gross/net amounts.

## Actual APIs and new module

Existing APIs are typed from generated `api.pos`, never invented arguments:

- `discardOrder({orderId,expectedRevision,idempotencyKey,reason?}) -> {replayed}`.
- `restoreCheck({orderId}) -> null | {discarded,revision,conflicts,blocking,rowsLeft}`. Conflicts retain their actual kind/blocking/line/name/message/competing-order fields.
- `restoreOrder({orderId,expectedRevision,idempotencyKey,removeConflictingRows?}) -> {replayed,removed,warnings}`. Initial reviewed inputs are reused after lost responses.
- `addAppointmentFee({orderId?,appointmentId,kind:'no_show'|'late_cancellation',amount,reason?}) -> {orderId,lineId,replayed}`.
- `appointmentFees({appointmentId})` returns its real bounded rows, amount/reason/actor/date and order state/reference.
- `getOrder.refunds`: actual selected fields plus `sourceType:'booking'`/`bookingId` or `sourceType:'appointment'`/`appointmentId`. No frontend-only endpoint contract or schema fields were added.

New authenticated read-only module **`convex/orderHistoryPages.ts`**, with names deliberately separate from `pos.orderHistory` and existing recordHistory:

- `orderHistoryPages.corrections({orderId,paginationOpts})`: billCorrections `by_billId_and_sequence`, descending.
- `orderHistoryPages.audit({orderId,paginationOpts})`: billAudit `by_billId_and_at`, descending.
- `orderHistoryPages.bookingRefunds({orderId,paginationOpts})`: bookingRefunds `by_billId`, descending, rows tagged `sourceType:'booking'`.
- `orderHistoryPages.appointmentRefunds({orderId,paginationOpts})`: appointmentRefunds `by_billId`, descending, rows tagged `sourceType:'appointment'`.

All four require admin, accept only integer page sizes 1–50, and return native `{page,isDone,continueCursor,...}` pagination. They use existing indexes, no collect, schema changes or merged cursor. Production adapters use `api.orderHistoryPages` after the **parent's** normal codegen; this worker did not edit generated files. Backend hooks are `useCorrectionHistory`, `useAuditHistory`, `useBookingRefundHistory`, `useAppointmentRefundHistory`; each starts at 20. Existing ordinary item history is unchanged and remains separately paginated.

**Fee API limitation:** Kiro's actual addAppointmentFee has no expectedRevision or idempotencyKey arguments. UI invalidates a reactive changed review and freezes its submitted payload; backend checks live eligibility, cap and uniqueness atomically. UI cannot enforce a server reviewed-revision comparison that this API does not provide. No unsupported argument is sent. A lost create response is recovered through appointmentFees and its actual order link; it does not falsely claim replay-by-key. Parent was informed during implementation. If atomic fee review revision is required, that is a narrow POS-owner API extension, not an unimplemented checkout argument.

## Fixture behavior and test seams

FixtureBackend now mirrors real discard/restore state, revision/replay, source release, competing chargeable rows, settled/changed sources, retained links/history and empty-order refusal. Orders really page. Fee rows have actual feeAppointmentId/fee fields, cannot merge into ordinary extras, and do not modify the appointment lifecycle/price/payment. Both paid and plain-void fee orders remain live for uniqueness; a proven no-money void does not. A refunded appointment receipt cannot be reversed as unreceived.

Stay fixture price uses the actual shared `bookingChargeTotal({total,providerRefundWaived})`. Deposit remains actual net received money; waived money is never turned into a deposit. Source updates preserve this distinction. Appointment settlement/reversal mirrors explicit amountPaid/amountRefunded counters.

Factory input supports actual externally recorded `appointmentRefunds`, existing `recordedRefunds` (now with correct sourceType), and per-ledger `financialHistory` snapshots. Receipt views project the actual booking/appointment union, retaining issued money. The older imported stay projection does not invent unknown net snapshots; the full production reader supplies those fields.

Fixture-only `setAppointmentSnapshot`, `setBookingSnapshot` and `appointmentSnapshot` let tests model source edits by independent admin writers. They are not CheckoutActions and are not called by production UI. They notify fixture subscribers; restoring never overwrites those source snapshots. External appointment refund snapshots remain visible through both the reader and getOrder projection.

## Mount instructions and ownership

Already mounted in `src/components/admin/AppointmentSheet.tsx`:

`<AppointmentFeeAction key={\`fee:${appointment._id}\`} appointment={appointment} onPendingChange={setFeePending} />`

`AppointmentFinancials` and existing appointment history remain mounted. If relocating the fee action, preserve its actual appointment document and callback; the host must reject closure/navigation while pending. The exported action supplies its own production checkout backend context and error boundary. `AppointmentFeeControls` is the same actual UI against a supplied fixture provider in unit tests.

Owned changes: checkout directory, new AppointmentFeeAction, the narrow authorized AppointmentSheet mount/fee guard, new orderHistoryPages reader/test, checkout unit tests, browser checkout fixture/workflow test, and this note. No pos/orderLinks/adminServices/payments/customers/schema/billMath mutation was made by this worker. Parent's latest source/fee/waiver semantics were consumed without editing those files.

## Verification

- `pnpm exec vitest run convex/orderHistoryPages.test.ts convex/orderLifecycle.test.ts convex/pos.test.ts tests/unit/pos-*.test.ts tests/unit/appointment-finance.test.ts`: **19 files, 244 tests passed**. This includes the new 16-case lifecycle/finance UI suite plus existing checkout/payment/customer regressions and current actual backend lifecycle/POS tests.
- `pnpm exec vitest run tests/unit/pos-appointment-fee-sheet.test.ts`: **1 file, 1 test passed**. Mounts real AppointmentSheet + AppointmentFeeAction, preserves financials/history, verifies exact actual fee payload, guards Close/Escape/status actions while pending, and follows the real returned order link after success.
- Dedicated backend history tests authenticate all four readers, reject non-admin/anonymous callers and invalid page sizes, handle empty ledgers, and page through **61 records in each stream** without duplicates or cross-order leakage beyond getOrder's 20/50 previews.
- UI coverage includes direct selected-order discard, identical lost-response discard/restore retries, explicit competing-source removal/all-conflict refusal, paid-elsewhere restore warning, archived customer preservation, noneditable/nonpayable discarded view, retained original rows/removal snapshots, amount/reason/review invalidation, fee duplicate/open/paid/plain-void/no-money-void guards, source edits while discarded, waiver/deposit accounting, imported appointment refund provenance/per-source net and atomic reversal refusal, financial continuation/error/retry/empty states, and paging beyond 50 audit rows.
- **Full `pnpm typecheck` passed** (app, tests, Convex) after the parent fixed its backend target-library issue and generated API. The three owned test type errors were repaired with actual provider children and narrow booking refund IDs, without suppressions. A final supplemental test-only typecheck covers the subsequently added sheet test.
- Scoped normal ESLint on all touched checkout/admin/reader/test/browser files: clean. Owned tracked `git diff --check`: clean. Impeccable detector on the nine changed UI targets: `[]`.
- Browser file `tests/browser/checkout-workflow.spec.ts`: direct discard/read-only/restore, source-conflict removal/history, immutable fee row, and receipt history past20/original tender. **Parent's integrated browser run confirms all four passed.** Early worker runs exposed and fixed test locator errors; no geometry/product failure was inferred from those. Parent reported the unrelated enlarged-layout Execution context destroyed failure happened during concurrent HMR. The ordinary CatalogPane layout was restored to its original direct flex-child structure.
- No final full browser/build/full-repository unit claim is made by this worker. Parent owns the final frozen-tree run and independent fixed-head reviews. Local runtime still reports Node 24.19.0 versus package Node 22.x.

## Handoff status

Owned implementation is ready for the parent's frozen-tree browser/type/lint/build/review gates. No unresolved external-owner type errors remained in the successful full typecheck. Remaining contract limitation is the explicit fee reviewed-revision gap above; frontend status/amount/source uniqueness checks and lost-response order recovery are delivered. Parent's POS aggregation/reversal/counter/waiver work is now integrated, rather than deferred to a guessed future contract.
