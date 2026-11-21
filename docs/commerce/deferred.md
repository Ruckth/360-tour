# Commerce: deferred to later waves

- W4: nightly voucher expiry mutation + cron; test retained package paid value, finite and unlimited expiry, pause and return (moved from W1 round 3). W1 keeps nullable expiry storage, the pure expiry rules (`benefitExpiresAt` / `benefitState`), the `by_status_and_effectiveExpiresAt` index and the receipt reader.
- W3, before enabling Products: show and confirm stock in hand from the pay panel.
- W5: package publishing command stores each changed part's `label`. Staff History reads names live (≤ 20 a page, same-key identity swaps prioritized ahead of count-only edits, the page ends before a row it cannot name), but a single edit naming more than 20 records shows its stored labels, or the content key, for the rest.
- W4: guest-facing voucher pages and redemption read the same last usable day (`lastUsableAt`, convex/shared/commerce/validity) as the desk's slips, receipt and history; the `giftSlipExpires` (“Use by {date}”) and `packageLine` (“until {date}”) catalog strings are not rendered yet and must use it when they are (PR #93 astra round 3).
- W2B, before activation: physical iPad p95 on shaped hotel Wi-Fi; the local start/settle latency gate is re-measured on a quiet host before activation.
- W2B, before the cutover rehearsal: a panel whose registration failed before the pause stays usable as today but is unknown to the server; during the pause its Confirm is refused (`CHECKOUT_PAUSED`). The rehearsal runbook asks each till to finish or reload open panels before the pause.
- W3 / W4 / W5: four-till stock, voucher and session contention respectively.
- W5: wide-package History latency (sol round 6) — measure and meet the History ceiling for packages with many contents.
