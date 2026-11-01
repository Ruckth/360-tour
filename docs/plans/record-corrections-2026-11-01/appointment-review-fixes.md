# Appointment review fixes S1/S2

Implemented against HEAD `799dfdfd45f54f63cf87b465eb01cc7c41b4a8bb` in `/Users/macbook/Development/360-tour-pos-checkout`. Read `AGENTS.md`, `convex/_generated/ai/guidelines.md`, the fixed-`c863f12` review at `/tmp/sol-record-corrections-review-c863f12.md`, and the original audit, implementation, integration and appointment delivery documents. This note supersedes only their S1/S2 behavior. Parent-owned C1/C2/C3 work was preserved.

## S1: proven legacy manual mistaken-payment reversal

The pre-PR `09a8450` implementation of `adminServices.markAppointmentPaid` used `recordAppointmentChange` to write exactly one `paymentStatus: unpaid → paid` change, kind `payment`, admin email actor, with no reason. It did not write a payment ledger entry, tender, paidAt or paidBy. The old POS settlement wrote reason `Paid at checkout` and could also change price. The implementation uses that real distinction rather than treating a paid flag as manual-origin evidence.

`getAppointmentFinancials` now returns `legacyManualPayment: { changeId } | null`. Eligibility requires all of:

- Paid appointment, finite positive price, absent explicit paid/refunded/financial-revision counters and absent paidAt/paidBy/refundedAt.
- No payment ledger row (including cancelled/provider entries), no refund ledger row, and no issued/retained-money receipt in the existing financial source reader.
- A complete bounded history read (maximum 200); exactly one financial change matching the old manual signature, email actor, matching currency before/after, no reason, and exactly the one unpaid-to-paid change. Other monetary changes or ambiguous/missing/truncated history refuse eligibility. This is deliberately conservative; a historical price/currency correction also requires separate review rather than guessing its payment amount.

The mounted earlier-payment area exposes **Not received…** only with that backend proof. It explains that original tender/received date are unknown. The existing confirmation dialog requires a reason, captures the reviewed revision and evidence ID, blocks duplicate submissions/dismissal during the mutation, freezes submitted inputs after an ambiguous failure, and retries the identical payload/key even if subscribed data changes.

`correctAppointmentPaymentEntry` accepts exactly one of optional `paymentId` or `legacyChangeId`. A legacy reference supports only `action: cancel`, without tender or effective-time amendment. The authenticated mutation rechecks all evidence, revision and open-order protection. In one transaction it sets unpaid/zero counters, preserves service lifecycle/price/currency, appends appointment and generic history with actor/reason/current correction effective/recorded time and the original change ID, and inserts a durable correction attempt. It does **not** manufacture an original payment row, original tender, original paidAt or original paidBy. The original change remains intact. Receipt-owned money directs staff to the receipt; refunded/unknown/provider money is refused. Modern manual correction now also explicitly refuses stripe/provider/order methods and refund-ledger/refundedAt evidence, beyond aggregate refund checks.

Exact committed retries are recognized before the stale revision/evidence check, write nothing and cannot erase a later real payment. A different actor or fingerprint is refused. The existing modern-payment fingerprint shape remains compatible with persisted pre-fix correction attempts; actor is checked from its existing stored field.

### Exact essential schema hunk owned by this worker

Only `appointmentPaymentCorrections` changed. Parent concurrently edited other schema areas; those are not this worker's changes.

```diff
 appointmentPaymentCorrections: defineTable({
-  appointmentId: v.id('serviceAppointments'), paymentId: v.id('appointmentPayments'), idempotencyKey: v.string(),
+  appointmentId: v.id('serviceAppointments'), paymentId: v.optional(v.id('appointmentPayments')), legacyChangeId: v.optional(v.id('appointmentChanges')), idempotencyKey: v.string(),
   requestFingerprint: v.string(), actor: v.string(), recordedAt: v.number(), reason: v.string()
 })
```

No appointmentPayments schema change or reconstructed payment is needed. Existing correction documents remain valid. The mutation enforces exclusive source selection.

## S2: completed/unpaid historical staff creation

`createAppointmentRecord` derives `completed` only with the explicit authenticated admin historical policy, `source: admin`, and actual service `end < Date.now()`. It uses service duration, not the turnaround-buffer end. At exactly the service end, during service, and for future/public entry, the default remains booked. Every creation remains unpaid. The persisted appointment, generic creation snapshot and appointment creation change all use the same derived status.

Existing public future/grid rules, archived-source rules, roster warnings, historical-overlap reasoning and current/future occupancy checks remain in force. In particular, the historical occupancy/archived-source policy still uses the full blocked window; changing the default status does not grant a new overlap override.

The mounted staff form displays **Completed · Unpaid. Checkout can collect payment for this service.** for ended work, and **Booked · Unpaid.** otherwise. It submits the actual time/staff/service, without trusting a client-supplied status/payment flag. Backend tests collect payment through real `openOrderFor`/`settleOrder` on the completed unpaid service and retain completed status.

Only obsolete existing historical assumptions changed: finance lifecycle assertions now retain completed, and the completed-service rescheduling test no longer performs a redundant completed-to-completed forward transition; its revision expectations follow the actual single payment write. Its receipt, price, stale-revision, time and payment checks remain.

## Regression results

Final focused regression command:

```sh
pnpm exec vitest run convex/appointmentFinance.test.ts convex/appointmentCorrections.test.ts convex/adminServices.test.ts convex/staffCalendarChanges.test.ts convex/serviceSlots.test.ts convex/serviceBookings.test.ts convex/roster.test.ts convex/rosterHistory.test.ts convex/pos.test.ts tests/unit/appointment-finance.test.ts tests/unit/appointment-entry.test.ts tests/unit/new-appointment-dialog.test.ts tests/unit/schedule-changes.test.ts tests/unit/staff-booking-helpers.test.ts
```

**14 files, 231 tests passed.** The new/updated appointment finance, corrections, entry helper and mounted component suites contribute 65 passing tests. Coverage includes the faithful pre-PR manual record without fabricated creation history; unknown, POS, provider, duplicate, price-change, unexpected payment-time, history-overflow and refund evidence; open checkout and paid/plain-void receipts; reason/review guards; durable exact replay and unchanged late replay after a new POS collection; atomic correction/history/source references; unknown original tender/date retention; mounted reason/pending/Escape/lost-response/review-freezing behavior; ended/running/exact-end/future/public creation; matching creation histories; mounted historical/current form submission; and subsequent real POS collection.

Scoped ESLint passed on all 12 owned TS/TSX files (including the narrow schema edit). Owned-file `git diff --check` passed. An initial combined `pnpm typecheck` passed; a subsequent run overlapped parent C1 edits and temporarily failed on parent `convex/bookings.ts` references to not-yet-added `legacyStripePaymentIntentId`/`legacyStripeGross`. Final app/test/backend typecheck outcomes are recorded below after the integrated schema is present. No browser, build, full-unit run, package installation, codegen, deployment, live writes, commits, pushes or child agents were performed. Existing Node engine warning remains: project requests Node 22, local runtime is Node 24.19.0.

## Remaining parent integration and release work

- No appointment UI/backend wiring is outstanding for S1/S2. The existing adminServices generated module reference resolves these changed signatures through the schema/source types; no generated file was edited.
- Parent owns all C1/C2/C3/Stripe/stay work and its verification. This worker preserved their concurrent files/schema hunks and makes no correctness claim for those changes.
- Parent must perform independent fixed-head review, combined final checks/browser coverage as required, git/PR/checks/reviews/merge. No release or PR action was taken by this worker.
- Unknown/ambiguous/over-200-entry legacy histories intentionally remain unavailable for automatic manual reversal. Original tender/time is never reconstructed. Separate evidence review is required for those records.

Owned implementation/test files: `convex/lib/appointmentFinance.ts`, `convex/lib/serviceSlots.ts`, appointment endpoint arguments in `convex/adminServices.ts`, the exact appointment-only schema hunk above, `src/components/admin/AppointmentFinancials.tsx`, `src/components/admin/NewAppointmentDialog.tsx`, `src/components/admin/appointment-entry.ts`, `convex/appointmentFinance.test.ts`, `convex/appointmentCorrections.test.ts`, `tests/unit/appointment-finance.test.ts`, `tests/unit/appointment-entry.test.ts`, new `tests/unit/new-appointment-dialog.test.ts`, and this note.

Final integrated type validation: `pnpm typecheck:app`, `pnpm typecheck:tests` and `pnpm typecheck:convex` all **passed**, exit code 0. Scoped lint remained clean after the final source/test edits. S1/S2 implementation is complete and edits are frozen for parent review.

PR https://github.com/Ruckth/360-tour/pull/34, head 799dfdfd45f54f63cf87b465eb01cc7c41b4a8bb, checks and reviews pending.
