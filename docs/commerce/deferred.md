# Commerce: deferred to later waves

- W4: nightly voucher expiry mutation + cron; test retained package paid value, finite and unlimited expiry, pause and return (moved from W1 round 3). W1 keeps nullable expiry storage, the pure expiry rules (`benefitExpiresAt` / `benefitState`), the `by_status_and_effectiveExpiresAt` index and the receipt reader.
- W4: Preview date discrepancy (astra round 3): align the Preview receipt's sale, voucher issue and package purchase dates, then place later events after them.
