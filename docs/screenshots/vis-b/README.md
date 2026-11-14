# Package B visual redesign

Light-mode Chromium captures of the same fixture data and actions used by `docs/screenshots/now/`. Phone: 390×844. iPad: 1180×820. Missing-information desktop: 1280×820.

Reproduce all 13 captures:

```sh
CAPTURE_VIS_B=1 BOOKING_UI_PORT=4372 pnpm exec playwright test -c playwright.booking.config.ts vis-b-screenshots --workers=1
```

| State | Phone | iPad |
| --- | --- | --- |
| New booking, 20–23 November, total ฿36,000 | [phone](new-booking-phone.png) | [iPad](new-booking-ipad.png) |
| Anna Schmidt stay, including spa balance | [phone](stay-sheet-phone.png) | [iPad](stay-sheet-ipad.png) |
| Ken Tanaka appointment | [phone](appointment-sheet-phone.png) | [iPad](appointment-sheet-ipad.png) |
| Hotel calendar, November | [phone](hotel-calendar-phone.png) | [iPad](hotel-calendar-ipad.png) |
| Anna Müller chat | [phone](chats-phone.png) | [iPad](chats-ipad.png) |
| Missing information, New reports | [phone](missing-information-phone.png) | [iPad](missing-information-ipad.png) |

[Missing information at desktop width](missing-information-desktop.png).

The booking fixture retains its fixed 12 November 2026, 10:00 Bangkok clock. Chat and missing-information fixtures use their original relative `Date.now()` labels, so wall-clock labels differ from the archived captures. No screenshot pixels are edited.

The initial booking capture shows all three group headings. Coupon and any additional conditional fields scroll within the form; the separate footer keeps the total and Create booking visible without covering fields. The phone calendar uses smaller balance text to fit the four-up strip; the other KPI values remain 28px.

All 13 final images were opened and visually inspected. The capture run also passed all six inbox layout and follow-up checks, including enlarged text, paused AI, staff routing, failed-send warnings, and closed reply windows.

Implementation anchors:

- Brief 6: `NewBookingDialog.tsx:211` groups the form with 24px gaps; `:449` separates the 18px total and ghost block action from the scroll area.
- Brief 7: `BookingSheet.tsx:225` and `AppointmentSheet.tsx:168` put ghost Edit, More, and Close in the header. Their `Detail` rows use fixed 96px labels, muted 13px labels, and 14px values. `BookingFinancials.tsx:214` and `AppointmentFinancials.tsx:77` use 36px sans tabular amounts in rounded cards.
- Brief 8: `AdminSessionDetail.tsx:357` combines guest identity, state, and tools in one header; contact details live behind Info. `AdminSessionActions.tsx:123` keeps No reply needed labelled for assistive technology and icon-only on phones. Paused AI and staff routing remain visible in the header.
- Brief 9: `MissingInformationPanel.tsx:479` gives questions 15px medium type and muted 12px metadata; `:541` puts the 256px resolve select, ghost Create fact, and More on one desktop row. Phone controls remain side by side.
- Brief 12: `AdminBookingsView.tsx:293` places 13px day numbers at top left, fades outside days, and makes overflow a pill. `TodayStrip.tsx:46` uses four columns on phones and 28px KPI counts. `AdminCalendarHeader.tsx:45` raises the month title's hierarchy.

No shared UI primitives, global styles, backend implementation, or deployment configuration were changed. Mutation handlers, attempt keys, revisions, and permission conditions retain their existing behavior.

Verification passed: typecheck; lint (two existing unused-variable warnings in `scripts/arch-scorecard.mjs`); all 258 unit files / 3,188 tests; all 402 browser tests, with 135 tests skipped. The separate final screenshot/inbox run passed 19 tests. [Command tails and environment](verification.txt).
