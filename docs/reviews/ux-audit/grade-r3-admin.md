# Grade r3: settings, team, coupons, marketing dashboard

Graded against `scorecard-rubric.md`, `visual-brief.md` and the locked decisions in `design-decisions.md`. Screenshots are from `docs/screenshots/audit-r3/`. I checked code for the states a screenshot can't show: `AdminSettingsView.tsx`, `TeamSettings.tsx`, `SegmentedTabs.tsx`, `marketing/CouponEditor.tsx`, `marketing/dashboard/*`, `ui/stat.tsx`, `ui/toggle-group.tsx`, `ui/button.tsx`, `hooks/use-unsaved-guard.tsx` and `tests/browser/touch-targets-c.spec.ts`.

Locked choices are scored on how well they're built, not on whether they were the right call. These include the reserved ⋯ column on Team rows, the amber "Invited · expires" badge, the subtle segmented tone outside checkout, and the single-column coupon page with Summary below the form.

---

### 1. Business settings (extra-settings-business-ipad.png, extra-settings-business-phone.png, ux-p7-business-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif 30px title, four Cards, and a clear lg 1/3 title column with fields in the other 2/3. Save is the only primary button. | — |
| Typography | 9 | Labels are 12px muted, section titles 15px semibold, descriptions 13px, and inputs 16px on phone (no iOS zoom). | Nit: "(optional)" appears on 9 of 13 labels. |
| Layout & spacing | 8 | The History card has a stray divider across its top, because `HistoryDisclosure` adds `border-t` inside a padded Card. The save bar is `bg-card/95 backdrop-blur`, so ghosted input outlines show through it on iPad and phone. The form does have `pb-20` under the bar. | `AdminSettingsView.tsx:425`: add `[&>details]:border-t-0` to the History `Card`, as `CouponEditor.tsx:804` already does. `:439`: change `bg-card/95 backdrop-blur` to `bg-card` (also in `TeamSettings.tsx:484`). |
| Consistency | 8 | Business and Team use a serif 30px page title over grouped Cards. Booking rules, AI and Email use `Panel` with a 16px bordered card header and the description hidden in an ⓘ (`AdminSettingsView.tsx:534-547`). That's two settings layouts under one tab bar. The save bar here is a floating rounded card, but the coupon bar is full-bleed. | Render every SettingsForm with `grouped` (serif title + 13px description, Card body). Pick one sticky-bar style for every admin form (see Coupon › Consistency). |
| Color & contrast | 9 | Neutral surfaces, dark primary Save, and a destructive border only on error. | — |
| Efficiency | 9 | Time zone is a searchable combobox, currency a select, and time uses `TimePicker`. Every field is directly editable. | — |
| Clarity | 8 | On first run the bar says "Using built-in defaults" next to Save, and the History row repeats it as "Default settings are active. Select Save to keep them." Neither says what Save does. The subtitle's second sentence ("The public website still shows its built-in content") makes people wonder what is live where. | Bar copy: "Not saved yet: these are the built-in defaults", with the button "Save defaults". Remove the History hint for this case (keep only "Last saved …"). Subtitle: "Used by the AI concierge, guest emails and the admin." |
| States & feedback | 8 | Dirty, saving spinner, 2.5s "Saved", stale-revision alert, read-only banner, loading spinner and focus-first-invalid all exist. A server error renders as an Alert above the History card (`:419`), far from the sticky bar where Save was pressed. The bar's status still reads "Unsaved changes". | In the bar's `role="status"` span, show `state.error` in `text-destructive` when present (e.g. "Couldn't save. Fix the highlighted fields"), and keep the inline Alert. |
| Responsive | 9 | Phone stacks the Cards. iPad and desktop get the 1/3 + 2/3 grid. The tab strip gets a 44px "More tabs" button. | Nit: the phone tab label clips to "AI ass" (see visual bugs). |
| Accessibility | 9 | `htmlFor` labels, `aria-invalid` + `aria-describedby`, labelled ⓘ, arrow-key tablist and focus rings. The Package C touch test covers every settings tab on phone and iPad. | — |

**Average 8.6**

### 2. Team (extra-settings-team-ipad.png, -ipad-full, -desktop, -phone, -phone-full, ux-p7-team-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Invite is the clear primary button. But four bold black "Change" buttons, plus semibold role badges, make a heavier column on the right than the names (15px medium) on the left. The eye reads "Change Change Change" before it reads the people. | `TeamSettings.tsx:339`: give the Change button `className="font-medium text-muted-foreground hover:text-foreground"`. `:334`: role `Badge` gets `font-medium`. |
| Typography | 9 | Name 15px medium, email 13px muted, badges 12px, sub-label "Who can do this without asking" 12px. | — |
| Layout & spacing | 8 | (a) The Owner badge sits about 9px right of the other role badges: the `w-[7.25rem]` spacer (`:335`) is narrower than Change + ⋯. (b) On phone, Narin's row is about 20px shorter than the others because it has no action line. (c) The Rules card ends with an empty `role="status"` div (`pt-3`) under the last row's divider, so there's a blank band and a hanging rule. | (a) Put the actions in a fixed column on every row, `w-[7.5rem] shrink-0 justify-end`. For the owner, render `<Button size="sm" variant="ghost" className="invisible" tabIndex={-1} aria-hidden>Change</Button>` plus the `size-11` spacer, so the widths match. (b) Add `min-h-11` to the badge row (`:333`). (c) Render the status div only when it has content, and add `last:border-b-0` to the rule rows. |
| Consistency | 9 | Same Card, same subtle segmented control, dirty-only rounded save bar matching Business, amber/destructive invite badges as locked. | — |
| Color & contrast | 9 | Amber only for pending invites and destructive only for expired ones. Muted role badges stay readable. | — |
| Efficiency | 9 | Change → two selects that apply immediately. Only removal confirms. Invite defaults to Cashier. | — |
| Clarity | 9 | "Rules for all cashiers", "Any cashier / Manager only" and "Role changes apply immediately." Role definitions sit in the ⓘ. | Nit: "Manager · Marketing Viewer" mixes two role systems in one chip. |
| States & feedback | 9 | Per-row spinner and inline success/error, invite validation, expired → Renew, stale-rules "Reload latest", dirty-only save bar with Discard, and an unsaved guard on tab switch. | — |
| Responsive | 8 | Phone is well built (badge + Change on a second line, segmented controls full width). On iPad and desktop the rows and rules run the full `max-w-6xl` (≈1080px), so names and roles are about 800px apart, and "Refund" sits a full screen-width away from its toggle. | Cap the Team panel at `max-w-4xl` (wrap `TeamSettings` in `<div className="grid max-w-4xl gap-4">`), or use Business's `lg:grid-cols-[1fr_2fr]` card layout with the title and description on the left. |
| Accessibility | 9 | "Change roles for X" + `aria-expanded/controls`, labelled ⋯, `aria-hidden` spacers, segmented `aria-label="Refund permission"`. Touch test covers the open Invite form and the Change panel. | — |

**Average 8.7**

### 3. New coupon, empty and filled (extra-new-coupon-ipad/phone/desktop.png, extra-new-coupon-filled-ipad/phone/desktop.png, ux-p8-new-coupon-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif title, with "Save & publish" as the one primary and "Save as draft" outline (moved into ⋯ on phone). Summary leads with 28px "20% off". | — |
| Typography | 9 | Labels 12px muted, mono only in the code, money-class discount and 28px summary value. | Nit: the Code placeholder renders in mono while the Discount placeholder is sans. Add `placeholder:font-sans` at `CouponEditor.tsx:460`. |
| Layout & spacing | 9 | `max-w-3xl` column as locked. The Summary appears below the form once a valid discount exists, with no jump. Phone bottom padding `calc(5rem + tab bar + safe area)` covers the 68px bar. | — |
| Consistency | 8 | The phone action bar is full-bleed with `border-t` (`:808`). Settings and Team save bars are floating `rounded-xl border` cards. Two sticky-bar designs for the same job. The Summary card header has a `border-b` divider, while the form Card above has none. | Pick one bar: use the full-bleed style for every admin form bar on phone, and the floating card from `sm:` up, as a shared `StickyActionBar` in `src/components/ui/`. Use it in `AdminSettingsView.tsx:439`, `TeamSettings.tsx:484` and `CouponEditor.tsx:808`. |
| Color & contrast | 9 | Neutral. The focus ring uses the brand ring token, and "Not saved" is a neutral badge. | — |
| Efficiency | 9 | Sensible defaults (%, Stays, All villas). Rarely used rules fold into "More · campaign, dates, limits, terms". The discount echo ("20% = ฿840–฿1,700 a night") saves mental math. The publish confirm is a real guest-facing safeguard. | — |
| Clarity | 7 | One concept has three names: the segment says **Stays**, the Summary says **Accommodation, all villas**, and the phone bar says **Villa nights** (`:242`). The Summary repeats "Ongoing" three times (Booking / Stay / "Rules: Ongoing, no minimum"). On an empty form the phone bar's left label is "New coupon", which just repeats the title. | Use "Stays" everywhere: `summaryScope` → "Stays" / "Spa" / "Stays & spa", and `scopeLabel` → "Stays, all villas". `couponRulesLine` should drop the date part when Booking and Stay rows exist (show "No minimum · no limit"). Empty phone bar label: "Add a code and discount". |
| States & feedback | 9 | Skeleton, not-found card, no-draft-access message, archived callout, NoticeBar for save/publish results (including "saved as a draft, but it isn't live"), saving spinner, unsaved guard, and focus-first-error that opens "More" when needed. | — |
| Responsive | 9 | On phone the actions move to a thumb-reach bottom bar with a live summary. iPad and desktop keep header actions. | — |
| Accessibility | 9 | Labels and legends for every group, `aria-invalid/-describedby`, and a villa checkbox label that shows a focus ring. The `%` and `฿` items reach 44px on touch through `pointer-coarse:min-h-11`. | Nit: `aria-label="% percent"` reads as "percent percent". Use `"Percent"` / `"Baht"`. |

**Average 8.7**

### 4. Marketing dashboard (extra-marketing-dashboard-ipad.png, extra-marketing-dashboard-phone.png, ux-p8-dashboard-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Net collected" hero spans 2 columns at 40px, with the business-total bar folded in, per the brief. Secondary tiles are 28px and the chart sits below. | — |
| Typography | 9 | `Stat`: 12px label + ⓘ, 28/40px sans tabular values, one 13px caption. Chart ticks are 12px tabular. | — |
| Layout & spacing | 9 | Hero + 3-up + wide ROAS tile on iPad and desktop, 2-up on phone (odd last tile spans). Toolbar wraps cleanly. | — |
| Consistency | 8 | Toolbar controls side by side have different edges: "Last 30 days" is an outline Button (light `border-border`), and "All properties" is a SelectTrigger (darker `border-input` + shadow). The hero adds `ring-1 ring-foreground/10` on top of the Card border, so it looks selected or focused rather than emphasised. | `DashboardView.tsx:301`: `SelectTrigger className="… border-border shadow-none"` to match the outline buttons. `ui/stat.tsx`: drop `ring-1 ring-foreground/10` for `hero`; size and span already carry the emphasis. |
| Color & contrast | 9 | Source colours are consistent between legend and bars. The green/amber dot means fresh/updating. Hidden series are struck through as well as greyed. | — |
| Efficiency | 9 | Range is remembered per device, Marketing/Finance is one tap, and "Add spend" sits in the tile that needs it. Phone puts Refresh/View options/Export in ⋯. | — |
| Clarity | 8 | The ⓘ copy is overloaded and jargon-heavy. Booked rate's tip has three sentences ("converted sessions ÷ sessions started in range… current-link paid stay without a session · counted separately"). The hero tip is a long run-on of every bucket and percentage. The "Paid bookings · Stays paid" caption is a tautology. | `DashboardTiles.tsx`: Booked rate tip → "Paid bookings from tracked visits ÷ tracked visits in these dates." Move the session/edge-case notes to the Export dialog or breakdown footnote. Hero tip → "Collected minus refunds (not profit). Business total includes untracked and staff-entered sales." `HINTS["Paid bookings"]` → "From tracked links". |
| States & feedback | 9 | Skeleton matching the final layout. Error card with Try again. Refresh failure keeps the old figures and gives the as-of time. Truncated and non-THB callouts, an empty range with "Show the last 90 days", a first-run empty state with CTAs, and a refreshing opacity with a pulsing dot. | — |
| Responsive | 9 | Phone: tracking breakdown in a disclosure, actions in ⋯, 2-up tiles. Desktop is capped at `max-w-7xl`, not stretched. "Tap" vs "Select" copy follows the pointer type. | — |
| Accessibility | 9 | Chart is `role="img"` with a summary label plus an sr-only table. Legend chips are `aria-pressed`, `min-h-11` on coarse pointers, and covered by the touch test. sr-only h1. | — |

**Average 8.8**

---

## Visual bugs

1. **ux-p7-business-desktop.png**: the History card has a stray horizontal rule across its top (`HistoryDisclosure` `border-t` inside `Card`, `AdminSettingsView.tsx:425`). Fix: `[&>details]:border-t-0`.
2. **extra-settings-business-ipad.png, extra-settings-business-phone.png**: the translucent save bar (`bg-card/95 backdrop-blur`) shows ghosted input outlines underneath, so it reads as overlap. Fix: opaque `bg-card`. (In ux-p7-business-desktop.png the bar also sits over the Check-in/Check-out time row. That's partly the full-page capture, but no screenshot shows the `TimePicker` row unobstructed, so it went unreviewed visually.)
3. **extra-settings-team-ipad.png, -ipad-full, -desktop**: Narin's "Owner · all access" badge is offset about 9px right of the other role badges (spacer `w-[7.25rem]` ≠ Change + ⋯ width).
4. **extra-settings-team-phone.png, -phone-full, ux-p7-team-phone.png**: the owner row is shorter than the others (no action line), so the list rhythm is uneven.
5. **extra-settings-team-ipad-full.png, -phone-full**: the Rules card ends with a hanging divider and a blank band (empty status div + `border-b` on the last row).
6. **extra-settings-business-phone.png, extra-settings-team-phone.png**: the fourth tab is clipped mid-word ("AI ass") against the More-tabs chevron. Fix: when `overflow`, add a right-edge fade `[mask-image:linear-gradient(to_right,#000_85%,transparent)]` to the tablist in `SegmentedTabs.tsx`.
7. **extra-marketing-dashboard-ipad.png, ux-p8-dashboard-desktop.png**: the "All properties" select has a darker border and a shadow, unlike the date button and outline buttons next to it.
8. **extra-marketing-dashboard-ipad.png, ux-p8-dashboard-desktop.png**: the hero tile's extra ring makes it look focused or selected.
9. **extra-new-coupon-*.png**: the Code placeholder is monospace and the Discount placeholder is sans, side by side.
10. **extra-new-coupon-filled-phone.png**: the sticky bar sits over the Summary's Stay/Rules rows. This is a full-page capture artifact (the image is 1017px tall and the page has matching bottom padding), not a real bug.

## Averages

| Screen | Average | 9+ in every category |
|---|---|---|
| Business settings | 8.6 | No |
| Team | 8.7 | No |
| New coupon | 8.7 | No |
| Marketing dashboard | 8.8 | No |
| **Area** | **8.7** | **0 of 4** |
