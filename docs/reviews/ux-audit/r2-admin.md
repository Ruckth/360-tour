# Round 2 · admin screens: before → after

Settings and Team, Chats and facts, and Marketing on `ux/r2-admin` (from `ux/integration`). Measured in headless Chromium on the offline fixtures, iPad 1180×820 and phone 390×844, with the counters from [final-audit.md](final-audit.md) (`measure.ts`, `helpers/sentence-count.ts`).

- Script: [r2-admin.audit.ts](../../../tests/browser/ux-audit/r2-admin.audit.ts). Its locators accept the old and the new labels, so the same file measured both sides.
  `R2_PHASE=before|after BOOKING_UI_PORT=4364 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts r2-admin`
- Raw data: [results-r2-admin/before](results-r2-admin/before/) (run on `ux/integration` UI) and [results-r2-admin/after](results-r2-admin/after/). After screenshots: [docs/screenshots/ux-r2-admin/](../../screenshots/ux-r2-admin/).
- `final-tasks.audit.ts` i, i2 and j were made label-tolerant and pass on the new UI.

## Tasks (taps · fields, scrolls)

| Task | iPad before | iPad after | Phone before | Phone after |
|---|---|---|---|---|
| Set the discount limit from a fresh Team tab | 1 · 1, 0 | 1 · 1, 0 | 1 · 1, **2** | 1 · 1, **0** |
| Invite a cashier, then set the limit (i) | 3 · 2, 0 | 3 · 2, 0 | 3 · 2, **1** | 3 · 2, **0** |
| Give a person Marketing access (i2) | 2 · 0, 0 | **3** · 0, 0 | 2 · 0, 0 | **3** · 0, 0 |
| Resolve a report with an existing fact | 2, 0 | 2, 0 | 2, 0 | 2, 0 |
| Create a fact from a report (to the open form) | 1, 0 | **2**, 0 | 1, 0 | **2**, 0 |
| Ignore a report | 1, 0 | **2**, 0 | 1, **1** | **2**, **0** |
| Coupon → publish → QR card → Print (j) | 8 · 2, 0 | 8 · 2, 0 | 8 · 2, **1** (Print) | 8 · 2, **0** |

i2, Create fact and Ignore each gain a tap by design: the selects open behind Change, Create fact is the resolve select's last option, and Ignore sits in ⋯.

## Screens

| Screen | Measure | Before | After |
|---|---|---|---|
| Settings › Team | controls on page (iPad) | 25 | **20** |
| | native selects in People | 8 | **0** |
| | People controls | 11 | **7** |
| | words on page | 57 | 57 (names added, rule labels shorter) |
| | discount limit on screen at the start, phone | no | **yes** |
| | people shown by email only | 5 | **0** |
| Settings › Business | Deleted villa history on the tab | 1 | **0** (moved to Properties) |
| | Save label | "Save business profile" | **"Save"** |
| Missing information | controls on page, iPad | 20 | **17** |
| | controls per card | 5 | **4** |
| | words on page, iPad | 82 | **62** |
| | "New" badges · "Context" labels · raw paths | 3 · 3 · 3 | **0 · 0 · 0** |
| New coupon | controls on page | 13 | **11** |
| | words on page, iPad | 52 | **48** |
| | ฿/% toggle | yes | **no** (one field, "20% or 500") |
| Coupon · just published | Dismiss on "is live" | 1 | **0** |
| QR card, phone | Print on screen without scrolling | no | **yes** |
| Marketing dashboard, phone | controls before the first number | 8 | **6** |
| | "last_touch_30d@1" on screen | 1 | **0** ("Last touch · 30 days") |
| New partner | words in the sheet | 42 | **33** |
| | sentences | 0 | 1 ("Nothing is sent to the partner.") |
| | Save label | "Save partner" | **"Save"** |

The iPad dashboard keeps 8 controls before the first number: the ⋯ is phone-only.
