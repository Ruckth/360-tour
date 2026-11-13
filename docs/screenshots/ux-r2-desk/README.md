# Round 2: booking desk, after

After screenshots for the round-2 desk pass. The before shots are the final audit's
(`docs/reviews/ux-audit/final-screens/` on `ux/final-audit`).

Capture again with:

    CAPTURE_UX_R2_DESK=1 BOOKING_UI_PORT=4363 pnpm exec playwright test -c playwright.booking.config.ts ux-r2-desk-screenshots

## Counts, before → after

Measured with the final audit's scripts (`tests/browser/ux-audit/final-*.audit.ts` from `ux/final-audit`, run on
this branch with the new labels as selectors), iPad 1180×820 / phone 390×844, desk fixture at 12 Nov 2026 10:00.
Controls are on screen / on page.

| Screen or task | Before | After |
|---|---|---|
| Hotel calendar toolbar, controls | 12 (iPad and phone) | 8 iPad, 7 phone |
| Hotel calendar page, controls · words | 23 · 125 iPad, 21 · 121 phone | 19 · 120 iPad, 18 · 99/118 phone |
| Today strip on a phone | 4 columns, "Balance due ฿44,300" clipped | 2 columns, nothing clipped |
| Stay popover, controls · words | 5 · 25 | 4 · 22 (Take payment ฿X, Book spa, Details, ⋯) |
| Stay sheet, controls · words | 9 · 61 | 7 · 53 |
| Stay sheet, closed sections | Price breakdown, Payments and refunds (n), History | History |
| Appointment sheet, words | 52 | 48 (Payment row gone) |
| Appointment ⋯ items (booked, started) | 8 | 6 |
| Appointment sheet, filled buttons while a balance is due | 2 | 1 |
| New appointment for later today (h2b): taps · fields · scrolls | 4 · 1 · 1 | 4 · 1 · 0 |
| New appointment dialog, sentences | 4 | 1 |
| New appointment for today | past-work form: time box, no Auto | open-time chips, Auto staff |
| Book spa dialog, controls · words | 16 · 64 | 15 · 54 |
| Already paid (was Record payment) dialog, controls · words · sentences | 11 · 55 · 2 | 8 · 32 · 1 |
| Already paid from the calendar (p), taps | 3 | 4 (it now sits in ⋯) |
| Book spa for a staying guest (m), taps | 5 | 5 |
| Guest leaves (n), taps | 5 iPad / 6 phone | 5 / 6 |
| Arrivals (o), taps | 3 | 3 |
| New booking, sentences | 2 | both removed; booking-desk.spec asserts ≤ 1 |
