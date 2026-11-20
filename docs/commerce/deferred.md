# Commerce: deferred to later waves

- W4: nightly voucher expiry mutation + cron; test retained package paid value, finite and unlimited expiry, pause and return (moved from W1 round 3). W1 keeps nullable expiry storage, the pure expiry rules (`benefitExpiresAt` / `benefitState`), the `by_status_and_effectiveExpiresAt` index and the receipt reader.
- W4: Preview date discrepancy (astra round 3): align the Preview receipt's sale, voucher issue and package purchase dates, then place later events after them.
- W2B: phone panel sizing (astra round 5, minor). At 390 px the Edit · History and Approvals panels grow with their content, so Show guest (y=712 → 106) and the Approvals top control (y=754 → 483) move as rows arrive; 820, 1180 and 1440 hold position. Present in round 4 as well. Fix before the returns desk rehearsal.
- W5: package publishing command stores each changed part's `label`. Staff History reads names live (≤ 20 a page, same-key swaps first, the page ends before a row it cannot name), but a single edit naming more than 20 records shows its stored labels, or the content key, for the rest.
- W5, before enabling package publishing: live History pagination — a package edit landing while staff History is open can hide an audit row until the sheet is reopened, even after History reports it is exhausted (sol round 6). Make paging complete under live inserts and test it; block publishing until then.
- W5: wide-package History latency (sol round 6) — measure and meet the History ceiling for packages with many contents.
