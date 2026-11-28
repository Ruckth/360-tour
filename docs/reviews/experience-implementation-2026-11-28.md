# Experience implementation review

The November 28 backlog covers 183 distinct changes. The browser scenarios below use synthetic resort data. The staff end-to-end suites run the built application with a freshly seeded local Convex backend and dedicated Clerk test identities. Component-browser suites exercise responsive layout and interaction against controlled fixtures.

| Area | Findings | Examples verified or covered by release tests |
| --- | ---: | --- |
| Guest website, tour, concierge and booking | 34 | Phone consent and sticky pricing, locale persistence, tour focus return, calendar selection, international phone entry, contact review, payment-link access and confirmation recovery. [Guest booking](../../tests/e2e/guest-completion.spec.ts) · [Tour](../../tests/e2e/villa-tour.spec.ts) |
| Hotel desk | 8 | Today groups and currency totals, linked checkout, calendar legend, name search, stale move quotes and linked spa visits. [Hotel calendar](../../tests/e2e/hotel-calendar-tools.spec.ts) |
| Hotel and staff forms | 14 | Concurrent OTA listing edits, recovery from a multi-villa conflict, repeat conflict navigation and keyboard focus in the linked roster. [Routed forms](../../tests/e2e/hotel-form-recovery.spec.ts) |
| Spa and staff scheduling | 11 | All-date lookup, next visible appointment, stay attachment and saving three Friday shifts from a 390 px phone. [Phone schedule](../../tests/e2e/spa-phone-schedule.spec.ts) |
| Navigation, inbox, leads and team | 27 | Authorized Today counts and record links, draft recovery, prior branch restoration, mobile lead search, CSV export and deletion cancellation. [Today and search](../../tests/e2e/admin-today-search.spec.ts) · [Leads](../../tests/e2e/leads-desk.spec.ts) |
| POS, receipts and returns | 33 | Preserve a filtered order list after opening a receipt, review current basket conflicts before restoration, retain masked refund destinations and remove actions from expired approvals. [Order workflows](../../tests/browser/ux-p2b-open-orders.spec.ts) · [Returns](../../tests/browser/returns-desk.spec.ts) |
| Marketing and profitability | 23 | Coupon publish retry, quoted service selection, applied and draft finance filters, attribution controls, and report refresh. [Profitability](../../tests/e2e/profitability.spec.ts) · [Coupon publishing](../../tests/browser/marketing-coupon.spec.ts) |
| Properties and settings | 17 | Villa deep links, returning to a saved OTA draft, phone-width channel diagnostics and keyboard hotspot placement. [Property settings](../../tests/e2e/admin-property-settings.spec.ts) · [Hotspots](../../tests/e2e/admin-hotspots.spec.ts) |
| Stock and purchasing | 16 | Branch-scoped document and supplier lookup, receiving and transfer conflicts, and navigation at 320 px and 390 px. [Stock workflows](../../tests/e2e/stock-workflows.spec.ts) |

## Operational scope

- Recording actual hotel attendance requires operations approval. The server and UI share the same default-off setting. Today continues to distinguish scheduled arrivals from recorded attendance.
- Leads and their CSV share company scope. The underlying lead and villa records lack branch ownership. Hotel and Chats check primary-resort access. Stock and checkout use the working branch. The Today page labels each dataset accordingly.
- International guest numbers use E.164 storage. New guest-facing messages are present in all 11 locales. Native-speaker review of the new translations and hardware screen-reader testing remain manual.
- Calendar lookup covers the year around the resort date. Next appointment and next open slot use 30-day and 14-day windows, respectively. Staff can attach an appointment to an eligible stay through its scheduled checkout date.
- The payment tests use the local backend. They do not settle live payments.


## Independent implementation audit

Fresh GPT-6.2 Sol reviewers assessed the application changes against the original findings. The following scores cover the whole backlog. They combine sampled source review, focused regressions and browser evidence. They do not measure conversion, satisfaction or realized time savings.

| Dimension | Score out of 10 | Evidence informing the assessment |
| --- | ---: | --- |
| Coverage | 9 | All seven original ownership groups have routed changes and traceable test cases. Some operational edge cases remain source-reviewed. |
| Workflow | 9 | Tests follow navigation and verify the destination, including opening an exact record, preserving a filter or returning to an active draft. |
| Recovery | 8 | Tested cases include a refused roster write, overlapping lead requests, an unavailable queue count, a taken appointment slot and a rejected payment link. |
| Responsive design and accessibility | 8.5 | Real phone views cover layout, touch targets, keyboard entry, focus return and the Friday roster edit. |
| Correctness | 8.5 | The server rechecks the current user, record and financial state for sensitive writes. Concurrent edits and restricted roles have dedicated regressions. |
| Verification evidence | 8 | Authenticated workflows supplement fixture-based browser and unit coverage. Several rare states still rely on direct domain or component tests. |

All four production route bundles passed their existing size budgets after the Hotel desk was moved behind its own route. The isolated production build measured 224,313 Brotli bytes for Home, 221,497 for Room, 355,384 for Property and 441,987 for Checkout. Checkout gzip measured 511,667 bytes. The repository measures these again in CI.
