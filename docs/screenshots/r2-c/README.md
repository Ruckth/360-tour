# Round 2 Package C captures

Captured from `r2-c` with:

```sh
CAPTURE_NOW=1 CAPTURE_DIR=r2-c BOOKING_UI_PORT=4383 pnpm exec playwright test -c playwright.booking.config.ts now-screenshots --workers=1
```

All 50 capture tests passed. All 12 Package C images were opened at full resolution and checked against the round-2 brief and scorecard rubric:

- Business: matched currency/time-zone heights, consistent compact time pickers, defaults/history footer and phone spacing.
- Team: primary Invite, neutral pending badge, aligned phone Change actions and discount/rule control edges, subtle rule choices.
- Coupon: stable two-column layout and summary placeholder, aligned fields, visible Villas label, one choice pattern, readable phone Covers options and untouched New coupon footer.
- Dashboard: subtle view/metric choices, equal toolbar/chart control heights, aligned section title and short accurate captions.

The other 38 captures were skimmed for shared-primitive regressions. Checkout cash/split, new booking and missing-information screens were also inspected at full size. Checkout retains the strong selected tone; shared selects retain readable values and muted placeholders. Existing Package A/B work remains owned by those packages.

The full booking browser suite passed after the final coupon adjustment: 443 passed, 163 opt-in capture tests skipped. The 18 Package C touch-target tests pass at both 390×844 and 1180×820, including expanded forms and the settings overflow button; no target-size exceptions are used.

Validation completed:

- `pnpm typecheck`: passed.
- `pnpm lint`: 0 errors, 2 existing unused-variable warnings in `scripts/arch-scorecard.mjs`.
- Node 22: `pnpm vitest run --maxWorkers=4 --testTimeout=20000 --no-file-parallelism`: 259 files and 3,194 tests passed. Files were serialized after host contention caused timeouts; the requested test timeout was retained.
- `BOOKING_UI_PORT=4383 pnpm exec playwright test -c playwright.booking.config.ts --workers=4 --fully-parallel --timeout=60000`: 443 passed, 163 opt-in captures skipped.
- Final capture command above: 50 passed.
