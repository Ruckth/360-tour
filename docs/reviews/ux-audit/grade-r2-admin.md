# R2 admin audit: settings, team, coupons, marketing dashboard

Graded from `docs/screenshots/audit-r2/` (iPad 1180×820 and phone 390×844, touch-emulated; desktop 1280/1440) plus the component code for states the screenshots can't show. Scale and format follow `scorecard-rubric.md`. A 9 means I'd ship it with only a nit.

## Summary

| Screen | Avg |
|---|---|
| Business settings | 8.6 |
| Team settings | 8.0 |
| New coupon | 8.4 |
| Marketing dashboard | 8.9 |
| **Area** | **8.5** |

One fix touches every screen: `size="sm"` buttons render `text-xs` (12px semibold). On touch screens they grow to 44px tall (`pointer-coarse:min-h-11`) but keep 12px labels, so every primary action here is small text in a tall box: Invite, Change, Save as draft, Save & publish, Add spend, View options, Export CSV. Fix once in `src/components/ui/button.tsx`: change size `sm` to `h-9 px-3 text-[13px] pointer-coarse:text-sm`.

---

### Business settings (extra-settings-business-ipad.png, extra-settings-business-phone.png, ux-p7-business-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif title, four titled Cards, 1/3 label column with 2/3 fields from lg up. When nothing has changed there's no competing action. | — |
| Typography | 9 | Labels 12px muted, inputs 14px (16px on phone, so iOS doesn't zoom), card titles 15px semibold, descriptions 13px. Nit: "(optional)" repeats on 8 of 13 labels. | — |
| Layout & spacing | 8 | Group cards use `p-5 lg:p-6`, but the History card uses `px-5 py-3`, so its text starts at x≈109 against x≈113 for the cards above (desktop). "Defaults in use · save once to keep them" sits alone above a divider, then History comes below it. | `AdminSettingsView.tsx` History card: `className="mt-4 px-5 py-3 lg:px-6"`. Drop the separate `<p>` and pass the text as the disclosure hint: `hint={settings.updatedAt ? …"Last saved…" : "Using built-in defaults"}`. |
| Consistency | 9 | Card surface, TimePicker (clock + chevron), Select and Combobox all share the same trigger height and radius. | — |
| Color & contrast | 9 | Neutral palette; destructive only on errors; muted text ≈6:1 on white. | — |
| Efficiency | 9 | Save bar shows only when the form is dirty; Discard is one tap; the time zone is a searchable combobox. | — |
| Clarity | 7 | The page says "save once to keep them", but no Save button exists until a field is edited (the bar renders only on `dirty \|\| state.saved`). Users are told to do something they can't do. The fields also show real values (Auralis Cove Retreat…), so "Defaults in use" reads as wrong. | When `!settings.updatedAt && !readOnly`, show the sticky bar with the label "Using built-in defaults" and an enabled **Save** (no Discard). Change the condition to `(dirty \|\| state.saved \|\| !settings.updatedAt) && !readOnly`. |
| States & feedback | 8 | Good: saved check for 2.5s, saving spinner, stale-revision alert with "Load current settings", read-only banner, loading spinner, unsaved-change guard on tab switch, links and unload. Gap: an invalid submit only adds an Alert at the bottom of the form and never moves focus. On phone the invalid field (e.g. Business name) is off screen. | In `SettingsForm.submit`, after `setSubmitted(true)` with errors: `requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())`. CouponEditor's `focusError` already does this. |
| Responsive | 9 | Phone stacks to one column with 44px inputs; iPad and desktop get the label column. Nit: the tab strip clips "AI assis…" under the More-tabs chevron. | — |
| Accessibility | 9 | Every field has `htmlFor`, `aria-invalid` and `aria-describedby`; InfoTips are labelled; tabs support arrows, Home and End; covered by `touch-targets-c.spec.ts`. | — |

**Average 8.6**

---

### Team settings (extra-settings-team-ipad.png, extra-settings-team-phone.png, ux-p7-team-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Invite is the only primary. But four bordered, bold "Change" buttons form a loud column that outweighs the names. | `TeamSettings.tsx` PersonRow: change the Change button to `variant="ghost"` (keep `size="sm"` and its aria-label). |
| Typography | 7 | Rules rows invert the hierarchy: "Discount without approval", "Refund", "Void" are 12px muted (`FieldLabel` is imported as `Label`), while the "Without approval" subheading above them is 13px medium foreground. Row labels read like captions. Change and Invite labels are 12px. | In `RulesForm`, import the plain `Label` from `ui/label` and give row labels `className="text-sm font-normal text-foreground"`. Restyle the subheading to `pt-5 pb-1 text-xs font-medium text-muted-foreground`. Apply the shared button fix. |
| Layout & spacing | 7 | Phone: Lek's Change sits about 48px left of every other row's Change, because only invited rows have ⋯ and the spacer is `size-11 max-sm:hidden`. Phone: "Discount without approval" wraps to two lines beside a fixed `11rem` column. "%" sits outside the input, unlike the coupon NumberField, which puts its unit inside. | Spacer: drop `max-sm:hidden` (`<span aria-hidden className="size-11" />`). Rules row: `grid-cols-[minmax(0,1fr)_auto]`, and swap the input for `NumberField` from `marketing/MarketingBits` with a `%` suffix at `w-28`. |
| Consistency | 8 | The pending invite chip is the same grey `Badge variant="muted"` as role chips. Elsewhere, state uses StatusBadge tones. The Team header has no description line, but Business does. | Invite state: `<StatusBadge tone="warning" label={state} />` (expired stays `danger`). Header: add `<p className="mt-2 text-[13px] text-muted-foreground">Who can sign in, and what cashiers can do without a manager.</p>`. |
| Color & contrast | 8 | "Invited" doesn't stand out from role chips; pending is a warning state but is shown neutral. | Same StatusBadge `warning` fix as above. |
| Efficiency | 9 | Change opens inline selects that apply immediately; Invite defaults to Cashier; removal is confirmed. | — |
| Clarity | 7 | "Without approval" over rows with a "Cashier \| Manager" choice is ambiguous: does Manager mean managers act without approval, or that it needs a manager? "Invited · until 26 Nov" leaves the reader to work out that the invite expires. | Subheading: "Who can do this without asking". Segment labels: "Any cashier" / "Manager only" (values unchanged). `inviteState`: "Invited · expires 26 Nov". |
| States & feedback | 9 | Spinners while loading, a row-level saving spinner, inline row status messages, invite validation, dirty-only rules bar with Saved check, stale "Reload latest", "No cashiers" badge. | — |
| Responsive | 8 | Phone puts role and Change on a second line, which is good, but the misalignment and label wrap above make the phone layout look squeezed. iPad leaves a wide empty gap between name and role badge. | Covered by the Layout fixes. On iPad, keep the badge next to the action with `sm:justify-end` (no `mr-auto` from `sm`): `className="max-sm:mr-auto …"`. |
| Accessibility | 9 | "Change roles for X" with `aria-expanded`/`aria-controls`, labelled MoreMenu, labelled selects, touch spec. Nit: the rules `Label htmlFor` points at a ToggleGroup div (not labelable); its `aria-label` covers it. | — |

**Average 8.0**

---

### New coupon (extra-new-coupon-ipad.png, extra-new-coupon-phone.png, ux-p8-new-coupon-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Serif title and a single primary "Save & publish". But a placeholder card, "Set a discount to see the summary", is always shown: alone in the iPad right column, and as a dead card under the form on phone. The brief said to hide Summary until a discount is set. | `CouponEditor.tsx` aside: replace the placeholder Card with `null` on phone and a dashed hint on lg: `<Card className="hidden border-dashed bg-transparent p-5 shadow-none lg:block">`. |
| Typography | 8 | Labels 12px, the code stays mono, Summary leads at 28px once set. Action labels are 12px. On phone the ⋯ hides Save as draft, so 12px "Save & publish" is the only visible label. | Shared button fix. |
| Layout & spacing | 7 | The Discount input is 44px and the %/฿ toggle is 48px (segmented `p-0.5` + `h-11`), so their bottom edges don't line up (iPad and phone). Villas segment is `sm:w-80` while Covers spans full width, leaving a ragged right edge. On phone, Covers pills use `px-2`, so "Spa services" nearly touches its neighbours. | Discount row: `items-stretch` and on the toggle `className="shrink-0 p-0.5 [&>button]:h-10 pointer-coarse:[&>button]:h-10"`, or give the input `pointer-coarse:h-12`. Villas: `className="w-full"` to match Covers. Covers copy: see Clarity. |
| Consistency | 9 | Segmented `tone="subtle"` matches dashboard and team; labels match settings; Card radius. | — |
| Color & contrast | 9 | Neutral; destructive only on errors and Archive. | — |
| Efficiency | 9 | Sensible defaults (Villa nights, All villas, %); "20" automatically becomes 20%; rare rules folded under More. Publishing a coupon reasonably asks for confirmation. | — |
| Clarity | 8 | The phone bottom bar repeats "New coupon", which the title already says, and nothing on screen summarises the coupon. "Covers" is an odd label, and "Villa nights / Spa services" is long for a 3-up control. | Bottom bar: show `benefitLabel(rules.benefit)` plus `scopeLabel(...)` (e.g. "20% off · Villa nights") when a value is set, otherwise the code. Label "Applies to", options "Stays / Spa / Both". |
| States & feedback | 9 | Focus moves to the first error (and opens More if needed), skeleton, not-found card, archived callout, read-only hint, saving spinner, NoticeBar, unsaved guard. | — |
| Responsive | 8 | Phone sticky bar is thumb-reachable and the page has matching bottom padding (`pb-[calc(5rem+…)]`). The cramped Covers control and the dead summary card are phone-specific. | Covered by Layout and Hierarchy fixes. |
| Accessibility | 9 | `%`/`฿` toggle items have aria-labels; fieldset legends; error ids in `aria-describedby`; villa checkboxes `min-h-11`; covered by touch spec. | — |

**Average 8.4**

---

### Marketing dashboard (extra-marketing-dashboard-ipad.png, extra-marketing-dashboard-phone.png, ux-p8-dashboard-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The 40px "Net collected" hero tile is 2 columns wide with the business-total bar folded in; the other tiles are 28px. You can't miss it. | — |
| Typography | 9 | `Stat`: label 12px muted, value 28/40px semibold sans tabular, caption 13px; ฿ in sans; chart title 16px. | — |
| Layout & spacing | 9 | Hero plus 3+2 grid on iPad and desktop, 2-up on phone with an odd last tile spanning both columns; desktop is capped, not stretched. Nit: "Add spend" is absolutely positioned bottom-right, away from the caption it relates to. | — |
| Consistency | 9 | Same segmented control for Marketing/Finance and Net collected/Paid bookings; Card radius everywhere. Nit: filter controls are 48px (`pointer-coarse:h-12`) against 44px elsewhere. | — |
| Color & contrast | 8 | The "Staff-entered" swatch and its segment in the hero bar (`--chart-s0b`) are almost white on white, below 3:1 for graphical objects. Its legend dot and the "Not tracked" grey are hard to tell apart. | In `src/app.css`, darken `--chart-s0b` to ≥3:1 on `--card` (e.g. `oklch(0.72 0.01 80)`), and keep it distinct from `--chart-s0`. |
| Efficiency | 9 | Range remembered per device; presets; property filter; Export, View options and Refresh fold into ⋯ on phone. | — |
| Clarity | 8 | Jargon on the surface: "Last touch · sales made in these dates", "After cookie consent". "Tap a source to hide or show it" also shows on a mouse desktop. | Subtitle: "Sales made in these dates · credited to the last link clicked". Tracked visits hint: "Visitors who allowed tracking". Chart hint: "Select a source to hide or show it". |
| States & feedback | 10 | Skeleton matching the layout, error card with Retry, a failed refresh keeps the old figures and shows a callout, empty range, truncated warning, onboarding CTA, pulsing as-of dot while refreshing, "—" for unknown values. | — |
| Responsive | 9 | Phone: hero full width with a "Tracking breakdown" disclosure, 2-up tiles, filters in two rows. iPad uses the 5-column grid. | — |
| Accessibility | 9 | Chart has a table alternative; legend chips use `aria-pressed` and line-through (not colour alone); the bar has an `role="img"` label; InfoTips are labelled; touch spec covers it. | — |

**Average 8.9**

---

## Visual bugs

1. **extra-settings-team-phone.png, ux-p7-team-phone.png**: Lek's "Change" button is misaligned, about 48px left of the other rows' Change buttons. Cause: the spacer `size-11 max-sm:hidden` is missing on phone.
2. **extra-settings-team-phone.png**: "Discount without approval" wraps onto two lines beside the fixed `w-44` input.
3. **extra-settings-team-ipad.png**: rules row labels (Refund, Void, Discount without approval) are 12px muted, so they look fainter and smaller than the "Without approval" subheading. The hierarchy is inverted.
4. **extra-settings-team-ipad.png / phone**: the "Invited · until 26 Nov" chip is the same grey as role chips, so the pending state is invisible.
5. **extra-new-coupon-ipad.png, extra-new-coupon-phone.png, ux-p8-new-coupon-phone.png**: the Discount input (44px) and the %/฿ toggle (48px) differ in height, so their bottom edges don't line up.
6. **extra-new-coupon-ipad.png**: the Villas segmented control (`w-80`) and the full-width Covers control above it leave a ragged right edge.
7. **extra-new-coupon-phone.png**: Covers pills are cramped. "Spa services" nearly touches its neighbours and the selected "Villa nights" pill has almost no side padding.
8. **extra-new-coupon-ipad.png**: the "Set a discount to see the summary" card floats alone at the top of an empty right column.
9. **ux-p7-business-desktop.png**: the History card is inset 4px less than the group cards (x≈109 vs 113), and the "Defaults in use" line sits orphaned above a divider.
10. **extra-settings-business-phone.png, extra-settings-team-phone.png**: the tab strip clips "AI assis…" under the More-tabs chevron gradient. This is the intended overflow cue, but it reads as truncated text. Consider `pr-11` on the tablist so the last visible tab ends before the chevron.
11. **ux-p8-dashboard-desktop.png, extra-marketing-dashboard-ipad.png**: the "Staff-entered" bar segment and legend dot are nearly invisible on white.
12. **ux-p8-dashboard-desktop.png**: "Tap a source…" copy shows on a mouse desktop.
