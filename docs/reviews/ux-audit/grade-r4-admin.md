# Grade R4: settings, team, coupons, marketing dashboard

Graded against `scorecard-rubric.md`, `visual-brief.md` and `design-decisions.md` (locked decisions scored on how well they are carried out, not on the choice itself). I looked at every relevant capture in `docs/screenshots/audit-r4/` myself. For states a screenshot can't show, I read `AdminSettingsView.tsx`, `TeamSettings.tsx`, `SegmentedTabs.tsx`, `ui/sticky-action-bar.tsx`, `use-unsaved-guard.tsx`, `marketing/CouponEditor.tsx`, `marketing/dashboard/*`, the `ui/` primitives and `touch-targets-c.spec.ts`.

Note on captures: `extra-new-coupon-filled-ipad.png` (header buttons 36px tall) and `extra-settings-team-phone-full.png` (Invite button 36px tall) appear to have been captured without coarse-pointer emulation. Their siblings show 44px, and the code has `pointer-coarse:min-h-11` on `Button` and `ToggleGroupItem`. I treated these as capture artefacts, not product bugs.

---

### Settings › Business (extra-settings-business-ipad, -phone, -dirty-ipad, -dirty-phone, ux-p7-business-desktop)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif page title, then four grouped Cards. With no primary action until the form is dirty, the fields lead. | — |
| Typography | 9 | Labels 12px muted, group titles 15px semibold, descriptions 13px. Phone inputs are 16px, which stops iOS from zooming. | — |
| Layout & spacing | 9 | From lg up: `lg:grid-cols-[1fr_2fr]` left descriptions and right fields, aligned across all four Cards. Stacked on phone. The form gets `pb-20` while the bar shows. | — |
| Consistency | 9 | `Card` rounded-xl, TimePicker for check-in and check-out, the shared StickyActionBar. This is the model the other tabs should follow. | — |
| Color & contrast | 9 | Neutral palette. Focus ring is a clear 2px gold. The only filled button is Save (in the bar). | — |
| Efficiency | 9 | Contact fields in 2 columns, time zone as a searchable combobox, Discard in the bar. | — |
| Clarity | 8 | The History card reads "Using built-in defaults", yet every field shows real data, and nothing says what happens if you never press "Save defaults". The Identity description "The name and welcome guests see" doesn't parse ("welcome" means the tagline). | `AdminSettingsView.tsx` `HistoryDisclosure hint`: use `"Using built-in defaults · not saved yet"` (the button label stays as locked). In `businessGroups` Identity description: `"Your name and tagline, as guests see them"`. |
| States & feedback | 9 | Bar only when dirty or on error, with the error shown in the bar (`role="alert"`). Validation after blur or submit. "Saved" toast. "Settings changed on another device" alert. Loading spinner. Read-only banner. | — |
| Responsive | 9 | iPad uses the 1/3–2/3 split. Phone stacks cleanly and the bar runs full-bleed above the safe area. | — |
| Accessibility | 9 | Every field has a `Label htmlFor`, plus `aria-invalid`/`aria-describedby` and InfoTip labels. Targets are covered by touch-targets-c. | — |

### Settings › Team (extra-settings-team-ipad, -ipad-full, -dirty-ipad, -desktop, -phone, -phone-full, -dirty-phone, ux-p7-team-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Invite is the only primary button. Names lead each row and roles recede as muted badges. | — |
| Typography | 9 | Name 15px medium, email 13px muted, badge 12px, section titles 15px semibold. | — |
| Layout & spacing | 8 | The root is `max-w-4xl` inside the `max-w-6xl` settings column. Team cards stop at about 933px on iPad and desktop while the tab rule and every other tab run to the full width, leaving a dead right strip and a ragged right edge between tabs. | `TeamSettings.tsx` root: `grid max-w-4xl gap-4` → `grid gap-4`. Give `Section` the Business layout: `Card className="grid gap-5 p-5 lg:grid-cols-[1fr_2fr] lg:gap-8 lg:p-6"`, with title, ⓘ and Invite in the left column and the list or rules on the right. |
| Consistency | 8 | Rules feedback works differently from the Business form. Success is an inline "✓ Saved" (Business uses a Toast). A save error sits above the bar (Business puts it in the bar). The bar label is `text-[13px]` (Business: `text-sm`). | `RulesForm`: show the message as `<span role={state.error?"alert":"status"} className={cn("mr-auto text-sm", state.error?"text-destructive":"text-muted-foreground")}>{state.error \|\| "Unsaved changes"}</span>` inside `StickyActionBar`, keep the bar visible when `state.error` is set, and replace the inline Saved with `<Toast current={{id: revision, message: "Saved"}} />`. |
| Color & contrast | 9 | Amber "Invited · expires 27 Nov" chip per the locked decision. Role badges neutral. Segmented controls use the subtle tone. | — |
| Efficiency | 9 | "Change" reveals Desk and Marketing selects in place and applies immediately. Only removal asks for confirmation. | — |
| Clarity | 9 | "Who can do this without asking", "Discount without approval", "Role changes apply immediately." Nit: the visible label "Change" relies on `aria-label` for its object. | (nit) "Change role" from `sm:` up, e.g. `Change<span className="max-sm:hidden"> role</span>`. |
| States & feedback | 9 | Spinners for people and rules, per-row status or error lines, a "Rules changed on another device · Reload latest" path, invite validation, "No cashiers" badge, unsaved guard on the invite form and on tab switches. | — |
| Responsive | 9 | Phone stacks the badge under the email with actions on the same line. The reserved ⋯ column (locked) leaves "Change" floating about 44px in from the edge, which is acceptable. | — |
| Accessibility | 9 | `aria-label="Change roles for …"`, `aria-expanded/controls`, labelled toggle groups, ⋯ reserved and aligned (tested in touch-targets-c). | — |

### Settings › Booking rules (extra-settings-bookingRules-ipad, -phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Seven equal-weight number inputs in one flat grid. Nothing tells you which ones guests feel and which are internal timers. | Group the fields into three Business-style Cards (see Consistency). |
| Typography | 9 | Same scale as Business. | — |
| Layout & spacing | 8 | Unrelated fields are paired ("Hold unpaid bookings" next to "Chat summary valid for", "Minimum nights" next to "Maximum advance booking days"), and the odd last field leaves a blank half-row. | Groups: **Stay limits** (Minimum nights, Book up to, Same-day cutoff) · **Holds** (Unpaid hold, Chat summary) · **Guest emails** (Pre-arrival, Review). |
| Consistency | 7 | Business uses titled groups with left descriptions. This tab is one untitled Card. | In `SettingsForm`, generalise `businessGroups` into a per-section `groups` array in `SECTIONS` and render bookingRules through the same `lg:grid-cols-[1fr_2fr]` Card branch. |
| Color & contrast | 9 | Neutral. | — |
| Efficiency | 9 | Numeric keypad (`inputMode="numeric"`). | — |
| Clarity | 6 | No units on screen: "Hold unpaid bookings for 30" (minutes, but only inside the ⓘ), "Chat summary valid for 15". "Pre-arrival email days before check-in" is a clumsy label. "Choose time" doesn't say that empty means no cutoff. The description is one long sentence joined by a semicolon. | Render number fields with `NumberField suffix`: "min" (hold, chat summary), "days before" (pre-arrival), "days after" (review), "nights", "days ahead". Labels: "Pre-arrival email", "Review email", "Book up to". Pass `placeholder="No cutoff"` to the TimePicker. Description: "Limits for online villa bookings. Staff bookings skip stay limits and unpaid expiry." |
| States & feedback | 9 | Shared SettingsForm: dirty bar, field errors, toast, remote-change alert. | — |
| Responsive | 9 | Clean single column on phone. | — |
| Accessibility | 8 | The unit sits only in a tooltip, so a field's accessible name is just "Hold unpaid bookings for" with no unit. | Put the unit text in the suffix and reference it: `aria-describedby={`${id}-unit`}` on a `<span id=…-unit className="sr-only">minutes</span>`. Or make the visible label "Hold unpaid bookings (minutes)". |

### Settings › AI assistant (extra-settings-ai-ipad, -phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Three fields, serif title, description. | — |
| Typography | 9 | On scale. | — |
| Layout & spacing | 9 | Tone and max words paired, instructions full width. | — |
| Consistency | 9 | A single group, so one Card with the page title is enough. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | — | — |
| Clarity | 8 | "Extra instructions" is an empty box with no example. What belongs there is explained only behind the ⓘ. | `SECTIONS.ai` extraInstructions: `placeholder: "e.g. Always mention free airport pickup for stays of 3+ nights."` |
| States & feedback | 9 | Shared form states. Max-words range is validated. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | — | — |

### Settings › Email (extra-settings-email-ipad, -phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | — | — |
| Typography | 9 | — | — |
| Layout & spacing | 9 | — | — |
| Consistency | 9 | Same single-Card pattern as AI. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | — | — |
| Clarity | 7 | Sender name shows the business name as a *placeholder*, so it reads like a saved value. "Default notification email" doesn't say which address actually receives alerts. | `SECTIONS.email.fields`: `placeholder: \`Same as business name (${s.businessName})\`` for Sender name. For owner email, `placeholder: s.contactEmail ? \`Uses ${s.contactEmail}\` : "Uses the default address"` (or the real fallback address from settings). |
| States & feedback | 9 | Shared form states. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | — | — |

### Settings › Channels (extra-settings-channels-ipad, -phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | No page title. The amber error banner is the loudest thing on the page, and four identical grey "Unknown" badges hide whether messages are actually flowing, even though last-event times show they are. | Add the grouped page header the other tabs use: `<h2 className="font-serif text-3xl">Channels</h2>` plus a 13px muted description, "Messages coming in from LINE, WhatsApp, Messenger and Instagram." Derive the badge from activity when the env check fails (see States). |
| Typography | 8 | Channel names are `text-sm font-semibold` (14px). Row titles should be 15px. | `ChannelsPanel` h3: `text-[15px] font-medium`. |
| Layout & spacing | 8 | Card in card: each channel is a `rounded-lg border` box inside a `Card` with its own `border-b` header, which doubles the borders and leaves 16px gutters. | Render channels as `ul className="divide-y divide-border"` rows (`py-4`) inside one Card, or drop the outer Panel Card and make each channel its own `Card`. |
| Consistency | 7 | It's the only settings tab without a serif title and subtitle. It uses the ⓘ-in-header `Panel` and a local `Stat` instead of `ui/stat` and Business's group header. | Use `Panel grouped` for the page header and give "Messaging channels" and "Backend services" Business-style group headers (15px title + 13px description). |
| Color & contrast | 8 | Failures show only as a red number, while the badge stays grey "Unknown" because the config check failed. | `channelHealthMeta`: check `failed24h`/`failed7d` *before* the `configured === undefined` branch, so failures still produce the failing or warning badge. |
| Efficiency | 9 | Retry is inline. | — |
| Clarity | 6 | "Could not check website environment variables: Request failed (404)" is developer language. "Unknown" tells the owner nothing. "Backend services: Convex environment variables" shows raw env var names. | Banner: "Couldn't check channel setup. Message activity below is still live." with `{config.message}` behind an InfoTip. Badge label "Setup not checked". Give Backend services rows a human label (e.g. "Stripe payments", "Email sending") with the env name as 12px muted mono beneath. |
| States & feedback | 8 | When the env check fails, every status collapses to "Unknown" even though webhook data is present. | In `channelHealthMeta`: if `configured === undefined && channel.lastEventAt && channel.failed24h === 0`, return `{ tone: "success", label: "Receiving" }`. |
| Responsive | 8 | Phone tab strip shows a half-clipped "g rules" at the left edge (`extra-settings-channels-phone`). | `SegmentedTabs`: when scrolling the selected tab into view, snap to the previous tab's left edge (`scroll-snap-type:x mandatory` on the list, `snap-start` on tabs) so no label is cut. |
| Accessibility | 9 | Retry is labelled. Badges are text, not colour only. | — |

### New coupon (extra-new-coupon-desktop, -ipad, -phone, -filled-desktop, -filled-ipad, -filled-phone, ux-p8-new-coupon-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif "New coupon", Save & publish as the single primary, Save as draft outline (moved into ⋯ on phone). Summary appears only once a discount is valid (locked). | — |
| Typography | 9 | Code in mono, the rest sans. Summary hero "20% off" is 28px semibold. Labels 12px. | — |
| Layout & spacing | 8 | The Summary Card uses `px-4 pt-4` / `p-4` while the form Card uses `p-5 sm:p-6`, so the Summary content sits 8px left of the form content (x=247 vs 255 on iPad, 297 vs 305 on desktop). | `CouponEditor.tsx` Summary: `header className="… px-5 pt-5 sm:px-6 sm:pt-6"`, body `className="grid gap-3 p-5 sm:p-6"`. |
| Consistency | 9 | Card radius, subtle segmented controls, shared StickyActionBar on phone. | — |
| Color & contrast | 9 | Neutral "Not saved" chip. The unselected "฿" is muted but readable. | — |
| Efficiency | 9 | Four decisions above the fold, the rest folded under "More · campaign, dates, limits, terms". The publish confirm is a safeguard, so it stays. | — |
| Clarity | 8 | Summary rows read "Booking — Ongoing", "Stay — Ongoing", "Rules — No minimum": "Ongoing" is vague and the labels are cryptic. With a discount but no code, the phone bar says "20% off · Stays" and doesn't prompt for the missing code. | Summary terms: "Book by" / "Stay dates" / "Limits". Have `formatRange` return "Any dates" when both ends are empty. Phone bar second line: `{!code ? "Add a code" : saveHint}`. |
| States & feedback | 9 | Skeleton, not-found card, read-only role screen, errors focused on submit (opens More if needed), saving spinner, archived callout, notices. | — |
| Responsive | 9 | Phone sticky bar plus ⋯, bottom padding `pb-[calc(5rem+…)]` (the full-page filled phone shot clears the bar). iPad and desktop use the centred `max-w-3xl` per the locked decision. | — |
| Accessibility | 9 | %/฿ have aria-labels. Labelled fieldsets and legends. Villa checkboxes inside labels with focus-visible rings. 44px targets tested. | — |

### Marketing dashboard (extra-marketing-dashboard-ipad, -phone, ux-p8-dashboard-desktop)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The "Net collected" hero (40px, two columns wide) wins instantly. Other tiles 28px. The chart follows. | — |
| Typography | 9 | `Stat` gives label 12px, value 28 or 40px sans tabular, caption 13px. Legend amounts in sans money. | — |
| Layout & spacing | 9 | 2 + 3 grid on iPad and desktop, with the 5th tile spanning the leftover. 2-up on phone with the breakdown folded. Tile heights are equal. | — |
| Consistency | 8 | On touch the toolbar controls are `pointer-coarse:h-12` (48px), while every other admin input and button is 44px (`min-h-11`). The KPI section title sits outside its cards but the chart title sits inside a card header. | `DashboardView.tsx`: replace `pointer-coarse:h-12` with `pointer-coarse:h-11` on the property `SelectTrigger`, ViewOptions, Export CSV, and change MoreMenu `pointer-coarse:size-12` to `pointer-coarse:size-11`. Do the same for "Show as table" in `DashboardChart.tsx`. |
| Color & contrast | 8 | In the hero breakdown bar, "Not tracked" (`--chart-s0` #b3aea6) and "Staff-entered" (`--chart-s0b` #7d827b) are two neutral greys that are hard to tell apart in an 8px bar. | Give Staff-entered a distinct cool slate, e.g. `src/app.css` `--chart-s0b: #5b6b80` (dark `#8a9bb0`). Or stripe it: `background: repeating-linear-gradient(90deg,var(--chart-s0b) 0 3px,transparent 3px 5px)`. |
| Efficiency | 9 | Range is remembered per device. Phone puts Refresh, View options and Export in ⋯. Add spend sits right on the ROAS tile. | — |
| Clarity | 8 | The status line "Sales made 8 Oct–6 Nov 2026" is repeated straight away by the subtitle "Sales made in these dates · credited to the last link clicked". | Status line: drop the `{basis} {formatRange}` span. Subtitle in `DashboardTiles`: `` `${formatRange(from,to)} · credited to the last link clicked` `` (pass the range in). |
| States & feedback | 10 | Layout-matched skeleton, error callout with retry, failed refresh keeps the old figures with a warning, truncated-read warning, non-THB note, empty range with a "Show the last 90 days" action, first-run setup CTA, `aria-busy`. | — |
| Responsive | 9 | Phone 2-up with the breakdown disclosure. iPad uses the full width. Desktop capped at `max-w-7xl`. | — |
| Accessibility | 9 | Chart `role="img"` with summary label plus a table toggle, `aria-pressed` series chips with 44px coarse targets, sr-only h1, coarse-pointer copy ("Tap a source"). | — |

---

## Visual bugs
1. **Summary misaligned with form**: `extra-new-coupon-filled-ipad.png`, `extra-new-coupon-filled-desktop.png`, `extra-new-coupon-filled-phone.png`. Summary content is inset 16px against the form's 24px (20px on phone), so the left edges are 8px apart (4px on phone).
2. **Ragged right edge / dead column on Team**: `extra-settings-team-ipad.png`, `extra-settings-team-desktop.png`, `extra-settings-team-dirty-ipad.png`. Cards end about 210px short of the tab rule, while Business cards (`extra-settings-business-ipad.png`) reach it.
3. **Half-clipped tab label**: `extra-settings-channels-phone.png`. "g rules" is cut at the left edge of the settings tab strip.
4. **No left affordance on the scrolled tab strip**: `extra-settings-ai-phone.png`, `extra-settings-email-phone.png`. Business (and Team) are scrolled off to the left with only a right "More tabs" chevron, so nothing hints that tabs exist to the left.
5. **Indistinguishable greys**: `extra-marketing-dashboard-ipad.png`, `ux-p8-dashboard-desktop.png`. The "Not tracked" and "Staff-entered" segments and legend dots in the hero breakdown bar.
6. **Placeholder reads as a value**: `extra-settings-email-ipad.png`, `extra-settings-email-phone.png`. Sender name "Auralis Cove Retreat" is placeholder text.
7. **Card-in-card double borders**: `extra-settings-channels-ipad.png`, `extra-settings-channels-phone.png`.
8. **Floating "Change"** (nit, comes from the locked ⋯ column): `extra-settings-team-phone.png`, `ux-p7-team-phone.png`. "Change" sits mid-right, attached to neither the badge nor the edge.
9. **Capture inconsistency, not a product bug**: `extra-new-coupon-filled-ipad.png` (36px header buttons) and `extra-settings-team-phone-full.png` (36px Invite) look non-touch compared with their siblings. Re-capture with `hasTouch`/coarse pointer.

## Averages
| Screen | Avg | All 9+? |
|---|---|---|
| Settings › Business | 8.9 | no (Clarity 8) |
| Settings › Team | 8.8 | no |
| Settings › Booking rules | 8.2 | no |
| Settings › AI assistant | 8.9 | no (Clarity 8) |
| Settings › Email | 8.8 | no (Clarity 7) |
| Settings › Channels | 7.8 | no |
| New coupon | 8.8 | no |
| Marketing dashboard | 8.8 | no |
| **Area** | **8.6** | **0 of 8 screens at 9+ in every category** |
