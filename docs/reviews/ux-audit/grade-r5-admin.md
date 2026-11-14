# Grade r5: Settings, coupons and marketing dashboard

Grader: senior product designer pass, using fresh eyes. Sources: `docs/screenshots/audit-r5/` (extra-settings-*, extra-new-coupon-*, extra-marketing-dashboard-*, ux-p7-*, ux-p8-*) and the code for states that screenshots can't show (`AdminSettingsView.tsx`, `TeamSettings.tsx`, `SegmentedTabs.tsx`, `marketing/CouponEditor.tsx`, `marketing/dashboard/*`, `ui/sticky-action-bar.tsx`, `ui/stat.tsx`, `ui/toggle-group.tsx`, `hooks/use-unsaved-guard.tsx`, `tests/browser/touch-targets-c.spec.ts`).
Locked decisions (dirty-only Business save bar, built-in defaults line with "Save defaults", Team ⋯ column, Team `max-w-4xl`, invite badges, coupon single column with the Summary below, subtle tone) are scored on how well they are executed, not on whether they were the right choice.

Touch-target coverage: `touch-targets-c.spec.ts` measures every visible control on all six settings tabs, the coupon editor (with More and Choose villas open) and the dashboard, at 390 and 1180 with touch emulated. It also checks Team row alignment and that the tab overflow reaches Email and Channels. So 44 px targets on these screens are enforced, not assumed.

---

### Shared: settings tab strip (`SegmentedTabs`, all extra-settings-*-phone.png)
Not counted as a screen. It affects every settings tab on the phone.

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Underlined tabs, and the selected tab is clear. | — |
| Typography | 9 | 14 px medium, muted when not selected. | — |
| Layout & spacing | 8 | The baseline is an inset shadow on the tablist, so the overflow `mask-image` fades the baseline too. The rule visibly breaks just before the More-tabs button, which draws its own `border-b`. | Move `shadow-[inset_0_-1px_0_var(--color-border)]` from the tablist to the outer `<div className="flex min-w-0">` in `SegmentedTabs.tsx`, and drop `border-b border-border` from the More button so the rule runs unbroken under the mask. |
| Consistency | 9 | The same component is used for every admin sub-nav. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 8 | The More button only scrolls right. At the end it goes disabled (`opacity-40`) and the only way back to Business or Team is a swipe. | When `scrolled && !overflow`, render `ChevronLeft` with `aria-label="Earlier tabs"` that runs `scrollTo({ left: 0, behavior: "smooth" })` instead of a disabled right chevron. |
| Clarity | 9 | — | — |
| States & feedback | 9 | The guard confirms before switching tabs when there are unsaved changes (`confirmDiscard`). | — |
| Responsive | 8 | See the two rows above. The phone works, but the strip looks broken at both ends. | Same fixes. |
| Accessibility | 9 | `role=tablist`, arrow keys, Home and End, roving tabindex, `aria-controls` panels, 44 px More button. | — |

---

### Business (extra-settings-business-ipad.png, -phone.png, -business-dirty-ipad.png, -dirty-phone.png, ux-p7-business-desktop.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif title, then four titled Cards. The Save bar appears only when the form is dirty, so the single primary action stands out. | — |
| Typography | 9 | Section 15/semibold, 13 px descriptions, 12 px labels, "(optional)" marked and required fields left unmarked. | — |
| Layout & spacing | 9 | From lg, a 1/3 description column and a 2/3 field column. The dirty bar adds `pb-20`. Nit: "Save defaults" sits under the History summary with `mb-2` instead of on the summary row (ux-p7-business-desktop.png). | Nit: put "Save defaults" at the right of the History summary row. |
| Consistency | 9 | `Card` surfaces, shared `TimePicker`, `StickyActionBar`. | — |
| Color & contrast | 9 | Neutral. Destructive is used only for errors. | — |
| Efficiency | 9 | Contact fields are two-up and time zone is a searchable combobox. | — |
| Clarity | 9 | Plain group descriptions, and policy help sits behind ⓘ. | — |
| States & feedback | 9 | Inline errors with `aria-invalid`, focus moves to the first invalid field, the save error shows in the bar, "Saved" toast, conflict alert with "Load current settings", read-only banner, spinner while loading, guard on reload and in-app links. | — |
| Responsive | 9 | Phone is a single column with a full-bleed bar. iPad and desktop use the 1/3 + 2/3 layout. | — |
| Accessibility | 9 | Every field has a label. ⓘ has a 44 px hit area and is named "About …". Select and combobox are labelled. | — |

### Team (extra-settings-team-ipad.png, -ipad-full.png, -dirty-ipad.png, -phone.png, -phone-full.png, -dirty-phone.png, -desktop.png, ux-p7-team-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Invite is the single primary action. People come before Rules. | — |
| Typography | 9 | Names 15 px medium, emails 13 px muted, badges 12 px. | — |
| Layout & spacing | 9 | The Change column lines up, and the ⋯ slot is kept on every row (locked). The Rules rows use label left and control right. | — |
| Consistency | 8 | The two save flows on one page give different feedback. Business, Booking rules, AI and Email show the error inside the Save bar and confirm with a "Saved" toast. Rules for all cashiers shows the error as a `<p>` above the bar and confirms with an inline "✓ Saved" line. Its bar label is `text-[13px]` where the others use `text-sm`. | In `TeamSettings.tsx` `RulesForm`: render `state.error` inside the `StickyActionBar` as `<span role="alert" className="mr-auto text-sm text-destructive">`, show the bar while `dirty \|\| state.error`, replace the inline Saved line with `<Toast current={{ id: revision, message: "Saved" }} />`, and change the label class to `text-sm`. |
| Color & contrast | 8 | "Change" is a ghost button with `text-muted-foreground`: grey text and no button shape, next to grey badges. It reads like a label or a disabled control (the brief bans ambiguous text-buttons). | `PersonRow` Change: `variant="outline" size="sm"` and drop `text-muted-foreground` (keep `aria-label`). It stays a neutral secondary button and Invite stays the only primary. |
| Efficiency | 9 | Role changes are inline and apply at once. Only removals ask for confirmation. Invite defaults to Cashier. | — |
| Clarity | 9 | "Who can do this without asking", "Any cashier / Manager only", "Role changes apply immediately." | — |
| States & feedback | 9 | Spinners while loading, per-row status and error lines, Copy link falls back to showing the link, expired invite shows red with Renew, stale rules show "Reload latest", "No cashiers" badge, invite validation. | — |
| Responsive | 9 | Phone puts badge and actions on their own line and makes the toggles full width. iPad and desktop keep `max-w-4xl` (locked). | — |
| Accessibility | 9 | "Change roles for {name}", "More for {name}", toggles labelled per rule, focus returns after a role change. | — |

### Booking rules (extra-settings-bookingRules-ipad.png, -desktop.png, -phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | One flat Card holds seven unrelated fields in a 2-column grid: payment hold, chat quote expiry, two email timings, stay limits and cutoff. Nothing groups them or ranks them. | Use the Business pattern in `SettingsForm`: add `bookingRulesGroups` = **Stay limits** (minNights, maxAdvanceDays, sameDayCutoff, "What guests can book online") · **Holds** (unpaidHoldMinutes, chatQuoteValidityMinutes, "How long dates and chat quotes stay reserved") · **Guest emails** (preArrivalDaysBefore, reviewDaysAfter, "When automatic emails go out"), rendered with the same `Card className="grid gap-5 p-5 lg:grid-cols-[1fr_2fr] lg:gap-8 lg:p-6"`. |
| Typography | 9 | — | — |
| Layout & spacing | 8 | On iPad and desktop, 1–3 digit numbers sit in 517 px-wide inputs, and "Same-day booking cutoff" is an orphan that leaves half a row empty. | The grouped layout above fixes the orphan. Also add `sm:max-w-56` to the `NumberField` wrapper when `field.unit` is set. |
| Consistency | 8 | Business uses titled grouped Cards. This tab (like AI and Email) uses a bare grid Card. | Same grouping as above. |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | Unit suffixes, sensible defaults, "No cutoff" placeholder. | — |
| Clarity | 7 | Units appear twice ("Pre-arrival email days before check-in" + "days", "Maximum advance booking days" + "days"). "Chat summary valid for" is internal jargon. Five of seven fields need an ⓘ tap to be understood. The page description is a two-clause semicolon sentence. | Relabel in `SECTIONS.bookingRules`: "Pre-arrival email" with suffix `days before`, "Review request email" with suffix `days after`, "Book up to" with suffix `days ahead`, "Chat booking quote expires after" with suffix `min`. Raise `pr-16` to `pr-28` for the longer suffixes. Description: "Limits for online villa bookings. Staff bookings ignore stay limits and holds." |
| States & feedback | 9 | Uses the shared SettingsForm (validation, bar, toast, conflict, guard). | — |
| Responsive | 8 | Desktop just stretches the iPad grid (extra-settings-bookingRules-desktop.png). | Fixed by the grouping and the max widths above. |
| Accessibility | 9 | Unit is announced through the `sr-only` describedby. ⓘ buttons are named. | — |

### AI assistant (extra-settings-ai-ipad.png, -phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Short and clear. | — |
| Typography | 9 | — | — |
| Layout & spacing | 8 | "Max words per reply" is a half-width (517 px) field for a 3-digit number. | Give `maxWords` a `unit: "words"` so it renders through `NumberField`, and add `sm:max-w-56` (same rule as Booking rules). |
| Consistency | 8 | It is the only numeric setting without a unit suffix, so it doesn't match Booking rules or the Team % field. | Same: `unit: "words"`. |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | — | — |
| Clarity | 8 | "Extra instructions" is an empty box with no placeholder. The example only lives in the ⓘ. | Add `placeholder: "e.g. Mention free airport pickup for stays of 3+ nights. Never promise early check-in."` to `extraInstructions`. |
| States & feedback | 9 | Shared form. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | — | — |

### Email (extra-settings-email-ipad.png, -desktop.png, -phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | — | — |
| Typography | 9 | — | — |
| Layout & spacing | 9 | — | — |
| Consistency | 9 | — | — |
| Color & contrast | 9 | Placeholders are muted and clearly different from the footer value. | — |
| Efficiency | 8 | The only way to see the sender name or footer in a real email is to make a booking. | Add an outline `Button size="sm"` "Send test email to me" under the footer field (Email tab only) that calls a `settings.sendTestEmail` action using the saved values. Disable it while the form is dirty, with the hint "Save first". |
| Clarity | 8 | "Default notification email" as a placeholder doesn't say which address gets the alerts. | Show the resolved fallback: placeholder `Uses ${server.ownerNotificationEmail ?? "the address set on the server"}` (the address is already known from `api.settings.serverConfig`; expose the masked address, not just a boolean). |
| States & feedback | 9 | Shared form. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | — | — |

### Channels (extra-settings-channels-ipad.png, -desktop.png, -phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | WhatsApp ("Needs attention") sits in fixed order between healthy rows with the same weight. The one problem doesn't lead. | In `ChannelsPanel`, sort `health.channels` by severity (failing, then warning, then not configured, then the rest) before mapping. |
| Typography | 9 | — | — |
| Layout & spacing | 9 | 4-up stats on iPad and desktop, 2×2 on the phone. | — |
| Consistency | 8 | "Technical details" uses a raw `<details>` with the browser's ▶ marker instead of the shared `Disclosure` chevron. Channels cards have a `border-b` header bar while Team's `Section` cards don't. | Replace the raw details with `<Disclosure label="Technical details" className="mt-1 text-xs">`. In `Panel` (non-grouped), drop `border-b border-border px-5 py-4` for Team's `px-5 pt-5` header so both card headers match. |
| Color & contrast | 8 | The 7-day failure count is red (`text-destructive`) while its status badge is amber "Needs attention", so the two disagree on severity. | In `Stat`, take a tone instead of a boolean: Failed (24 h) > 0 uses `text-destructive`, Failed (7 d) > 0 uses `TONES.warning.text`. |
| Efficiency | 8 | "Needs attention" leads nowhere. You have to open Chats and look for the failures yourself. | On rows with failures, add `ButtonLink variant="ghost" size="sm"` "View failed replies" → `/admin/chats?channel=<id>&status=failed` (or the closest existing inbox filter). |
| Clarity | 7 | "Last event" is webhook jargon, "Failed (24 h)" doesn't say what failed, and WhatsApp's amber badge has no reason line when `latestError` is absent. | Labels: "Last message in", "Last reply", "Failed replies · 24 h", "Failed replies · 7 d". When the status is warning or failing and there's no `latestError`, render `<p className="mt-1 text-[13px] text-muted-foreground">{n} replies failed in the last 7 days</p>`. |
| States & feedback | 9 | Loading spinners per panel, config-error alert with Retry and details, "Never" and "No messages yet", "Not configured" with the missing setup listed, latest error shown. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | The status badge has text, not just colour. Summary is `min-h-11`. | — |

### New coupon (extra-new-coupon-ipad.png, -phone.png, -desktop.png, -filled-ipad.png, -filled-phone.png, -filled-desktop.png, ux-p8-new-coupon-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif title, "Save & publish" is the single primary action, and the Summary leads with "20% off" at 28 px. | — |
| Typography | 9 | The code is mono and its placeholder sans. Discount uses `.money`. | — |
| Layout & spacing | 9 | Single `max-w-3xl` column (locked). The phone has bottom padding equal to the bar. | — |
| Consistency | 9 | Subtle segmented controls, `Card`, shared `Disclosure`. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | Two fields and two defaulted choices, with the rest folded under More. Live price echo ("20% = ฿840–฿1,700 a night"). Phone puts Save as draft in ⋯. | — |
| Clarity | 8 | The scope control says "Both" but the bar and summary say "Stays & spa". The Summary rows read "Booking · Ongoing", "Stay · Ongoing", "Rules · No minimum", which takes a moment to decode. | `CouponEditor.tsx`: rename the third `ToggleGroupItem` to "Stays & spa". Summary terms: "Book by" / "Stay dates" / "Limits". In `formatRange`, return "Any dates" instead of "Ongoing" when both ends are empty. |
| States & feedback | 9 | Errors appear on submit and focus the first one (opening More if needed). Saving spinner, publish confirmation, live/draft notice, partial-failure message, read-only and not-found states, skeleton, unsaved guard. | — |
| Responsive | 9 | Phone has a sticky bar with a live summary. iPad and desktop put the actions in the header. | — |
| Accessibility | 9 | "Discount unit" group with "Percent" and "Baht" labels, `aria-describedby` hints, villa checkboxes inside 44 px labels. | — |

### Marketing dashboard (extra-marketing-dashboard-ipad.png, -phone.png, ux-p8-dashboard-desktop.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The 40 px hero tile spans 2 of 5 columns, with the other tiles 3-up on iPad and desktop. | — |
| Typography | 9 | `Stat`: 12 px label, 28/40 px sans tabular values, one 13 px caption. | — |
| Layout & spacing | 9 | The hero matches the height of two tile rows. The odd last tile spans two columns. | — |
| Consistency | 9 | `Stat` and `Card` everywhere, subtle toggles. | — |
| Color & contrast | 8 | In the hero breakdown, "Staff-entered" is rust (`--chart-s0b`). Next to red failure numbers and amber warnings it reads as a warning, though it's just a neutral source. The "Updated" dot is always emerald, even for an old read. | `DashboardTiles.tsx` parts: Staff-entered `color: "var(--muted-foreground)"`, so tracked is brand and everything untracked is grey. In `DashboardView` context, use `bg-emerald-500` only when `Date.now() - report.asOf < 60 * 60 * 1000`, otherwise `bg-muted-foreground`. |
| Efficiency | 9 | Remembered range, presets, phone actions in ⋯, Add spend inside the ROAS tile. | — |
| Clarity | 8 | The hero says "Net collected ฿1,091,700", but in Marketing view that's tracked links only. The larger "Business total ฿1,515,900" sits under it, so a manager reads the wrong number as the business net. | In the Marketing view, label the hero "Net from tracked links" (`label={p.cash ? "Net collected" : "Net from tracked links"}`) and keep "Business total" as is. |
| States & feedback | 9 | Skeleton, error Callout with Try again, a failed refresh keeps the old figures, truncated warning, first-run empty with CTAs, empty range with "Show the last 90 days", non-THB note. | — |
| Responsive | 9 | Phone: two-up filters, ⋯, "Tracking breakdown" folded, tiles 2-up. iPad and desktop: 5-column grid. | — |
| Accessibility | 9 | Chart is `role=img` with a summary label and an sr-only table. Series toggles use `aria-pressed`. The sr-only `h1` names the page. | — |

---

## Visual bugs
1. **Tab strip baseline fades out** before the More-tabs button on the phone: the mask also covers the inset-shadow rule. Seen in extra-settings-business-phone.png, -bookingRules-phone.png, -team-phone.png, -ai-phone.png, -email-phone.png, -channels-phone.png.
2. **More-tabs chevron left disabled at the end, with no way back**: extra-settings-channels-phone.png (faded chevron, "g rules" clipped at the left, no left control).
3. **Mixed disclosure markers**: the browser ▶ on "Technical details" next to the chevron disclosures elsewhere. Seen in extra-settings-channels-ipad.png, -desktop.png, -phone.png.
4. **Severity colour mismatch**: red "2" under an amber "Needs attention" badge. Seen in extra-settings-channels-*.png.
5. **"Save defaults" stacked under the History summary** instead of on its row (nit): ux-p7-business-desktop.png.
6. **Capture inconsistencies, not product bugs**:
   - extra-new-coupon-filled-ipad.png, extra-new-coupon-filled-phone.png and extra-settings-team-ipad-full.png were taken without a coarse pointer: inputs, Invite and Save are 36–44 px where the touch captures show 44–48 px.
   - extra-new-coupon-filled-phone.png is a full-page capture with the fixed bar painted mid-page.
   - Re-capture them touch-emulated at viewport height.
7. **Fixture copy mismatch**: the Email footer says "Spin & Stay…" while the business is "Auralis Cove Retreat" (extra-settings-email-*.png). Fix the fixture so it doesn't confuse graders.

## Per-screen averages
| Screen | Avg | All categories 9+? |
|---|---|---|
| Business | 9.0 | Yes |
| Team | 8.8 | No (Consistency 8, Color 8) |
| Booking rules | 8.4 | No |
| AI assistant | 8.7 | No |
| Email | 8.8 | No |
| Channels | 8.4 | No |
| New coupon | 8.9 | No (Clarity 8) |
| Marketing dashboard | 8.8 | No (Color 8, Clarity 8) |
| *(Shared tab strip, not counted)* | *8.7* | *No* |

**Area average: 8.7.** **Screens 9+ in every category: 1 of 8 (Business).**
