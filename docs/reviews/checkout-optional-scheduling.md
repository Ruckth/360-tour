# Checkout optional scheduling: final audit

User-approved behavior: checkout without a booking accepts independently optional date and time fields, with no date-only mode or scheduling help paragraphs. Staff can link a paid service or room charge to its appointment or stay later, without changing the issued receipt or collecting another payment.

Kiro implemented the feature in an isolated checkout. Codex tested, refactored, and audited it against `34451d6654c26a308d19c9b8045710b1aa702eb2`; the final branch also incorporates the newer `f8d9db6` mainline changes. The original checkout's uncommitted work was preserved.

## Standards

- P2, resolved: source-side link lookups could let a bounded page of undone links hide the active receipt. Active ownership is now read independently from recent history. A transaction regression covers this case.
- P3, resolved: active line/source ownership readers used first-result queries. They now use `unique()` so ambiguous ownership fails explicitly, following the Convex guidelines.
- No additional material maintainability findings. Codex consolidated payment-correction handling for checkout sources and later links, and removed redundant null assertions after row validation.

## Spec

- P2, resolved: failed time saves or clears left an optimistic value visible despite the stored value being unchanged. The input now restores the persisted value when the write fails; a UI regression covers both operations.
- P2, resolved: source-side undo history hid the active receipt, as above. Link/unlink operations also update the order's operational modification timestamp so source lists reflect the most recent change.
- Original receipt rows, tender, total, and issue date remain unchanged. Linking uses a separate ledger and audited corrections. Optional schema additions preserve untouched legacy scheduling semantics without a backfill.

## Additional Codex checks

- Recent undo history stays visible beyond a page of archived links.
- Refunds locate the exact linked stay payment even after older cancelled payments fill the receipt's history page.
- Optional inputs preserve either part independently and accept clearing; payment accepts unset schedules.
- Transaction coverage checks matching service/villa, overapplication, open orders, stale revisions, retries, refunds, both void paths, and payment-date corrections.
- The generated API module declarations were compared with the installed Convex generator; the existing component declarations were preserved.

Standards: two findings, both resolved; worst initial severity P2. Spec: two findings, both resolved; worst initial severity P2. No known unresolved audit findings.
