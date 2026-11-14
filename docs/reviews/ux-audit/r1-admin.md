# R1 audit: settings, team, coupons, marketing dashboard

Graded against `scorecard-rubric.md` and `visual-brief.md`. Screenshots are in `docs/screenshots/audit-r1/`. States the screenshots can't show were checked in code. The screenshots have no app chrome (no sidebar, header or Marketing section nav), so the chrome is not graded here.

Scale: 9 means ship with at most a nit. Every score under 9 has a fix.

---

### Business settings (extra-settings-business-ipad, extra-settings-business-phone, ux-p7-business-desktop)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif title, four titled Cards, no competing actions; Save only appears once something changes. | — |
| Typography | 9 | Labels 12px muted, section titles 15px semibold, 13px descriptions. Inputs go to 16px on phones to stop iOS zooming in. | — |
| Layout & spacing | 8 | On desktop (1280) the Currency `Select` is 36px tall next to the 40px Time zone combobox, so their bottom edges are 4px apart. Check-in and Check-out are also 36px while every text input is 40px. `SelectTrigger` defaults to `h-9`; `Input` is `h-10`. The "Not saved yet · History" Card at the bottom looks orphaned. | `AdminSettingsView.tsx` L353 and L363: change the trigger class to `h-10 w-full font-normal`. Better, make `SelectTrigger` default to `h-10` in `ui/select.tsx` and drop the per-screen `h-10 sm:h-9` overrides. Fold the "Last saved …" line into the History disclosure summary, e.g. `History · last saved 7 Nov by Narin`. |
| Consistency | 8 | Business times use a 48-row `Select`, but Booking rules in the same Settings uses `TimePicker`. Two time controls in one area. Field labels here are 12px muted, but Team's invite form and the coupon form use the default `Label` (14px medium foreground). | Use `TimePicker variant="compact"` for check-in and check-out too: delete the `field.type === "time" && section === "business"` branch at L361–365. Settle on one form-label style: add `text-xs font-normal text-muted-foreground` to `ui/label.tsx`'s default, or add a `FieldLabel` and use it in TeamSettings `InviteForm` and CouponEditor. |
| Color & contrast | 9 | Neutral palette; `--input` keeps field borders at 3:1 or better. | — |
| Efficiency | 9 | The Save bar only shows when the form is dirty, Discard is next to it, and the tab is in the URL. | — |
| Clarity | 8 | The footer says "Not saved yet · showing built-in defaults" above a form full of real, personal contact details. The two contradict each other. | When `updatedAt` is missing, show `Defaults in use · save once to keep them`. Otherwise show `Last saved …`. |
| States & feedback | 9 | Loading spinner; errors shown on blur and on submit; error Alert; spinner on Save; "Saved" for 2.5s; read-only banner; `useUnsavedGuard` covers tab switches, links and page unloads. Nit: the "Settings changed on another device" notice renders under the sticky bar as a plain `<p>`, where it's easy to miss. | (nit) Render it as `<Alert variant="warning">` above the first Card. |
| Responsive | 8 | Phone: six tabs overflow and the trailing ChevronRight has `pointer-events-none`, so Email and Channels can only be reached by sideways scrolling, which people don't discover. iPad and desktop make good use of the `lg:grid-cols-[1fr_2fr]` layout. | `SegmentedTabs.tsx` L140–144: make the overflow chevron a real button: `pointer-events-auto` and `onClick={() => listRef.current?.scrollBy({ left: 160, behavior: "smooth" })}`, with `aria-label="More tabs"` and `size-11`. Or, at `max-sm`, swap the tablist for a `Select` labelled "Section". |
| Accessibility | 9 | Every field has `Label htmlFor`, `aria-invalid` and `aria-describedby`; InfoTips have labels and 44px hit areas; targets use `pointer-coarse:min-h-11`; tabs support arrow keys. Nit: the time `SelectTrigger` has both a label and `aria-label="Check-in time, 14:00"`, so screen readers say the value twice. | (nit) Drop the `aria-label` on the triggers that have a `Label`. |

**Average 8.6**

---

### Team (extra-settings-team-ipad, extra-settings-team-phone, ux-p7-team-phone)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The screen has no primary action: Invite is a small outline button. Five 44px outline "Change" buttons, and further down four black `Cashier/Manager` pills, outweigh the people's names. | Make Invite the screen's one primary: `TeamSettings.tsx` L163, change `variant="outline"` to `variant="default"`. Lighten the rules toggles; see Consistency. |
| Typography | 9 | Name 15px medium, email 13px muted, badges 12px semibold. | — |
| Layout & spacing | 8 | Phone: every row keeps an empty 44px slot (`<span className="size-11">`, L336) for a ⋯ that only Lek has. Mint's, Ploy's and Sun's "Change" sit 48px in from the card edge, with Lek's ⋯ out on the right. iPad: the discount input plus "%" ends about 14px before the toggles below it. The "Who can do each action…" caption floats between rows. | L336: `className="size-11 max-sm:hidden"`. L322 owner spacer: add `max-sm:hidden`. Give the % row's right edge the toggles' width: `w-[7.5rem]` on the input-plus-% wrapper, or right-align both to the same column. Make the caption a group header: `text-[13px] font-medium text-foreground pt-4`, worded "Without approval". |
| Consistency | 8 | The InviteForm labels are the default `Label` (14px medium), while the row editor in the same file uses 12px muted (L346). The "No cashiers" badge uses the `Badge` default `rounded-lg`; the other badges are `rounded-full`. The rules toggles use the same heavy black segmented style as the checkout tender picker, but these are settings. | Give the InviteForm labels `text-xs font-normal text-muted-foreground`. L380: add `rounded-full`. In `ui/toggle-group.tsx`, add a `tone="subtle"` option for the segmented variant: selected `bg-background text-foreground shadow-sm`, track `bg-muted`. Use it in `RulesForm` (L463). |
| Color & contrast | 8 | An invite that is still valid ("Invite expires 26 Nov") and an expired invite (`inviteState`) both get `TONES.warning` amber. Colour doesn't tell pending apart from broken. | L318: pending gets the neutral style (`Badge variant="muted"`), text `Invited · until 26 Nov`. Only `grant.expired` gets a problem tone (`TONES.danger`), text `Invite expired`. |
| Efficiency | 9 | Change opens the role selects inline, and picking a role saves it. Invite defaults to Cashier. Removing access asks first. | — |
| Clarity | 9 | "Owner · all access" and "Manager · Marketing Viewer" read clearly; the rule labels are short. | — |
| States & feedback | 9 | Spinners while loading; a status or error line under the row; a "Saved" tick; a stale-revision reload notice; the Save bar only when dirty, wired to `useUnsavedGuard` through `onDirtyChange`. Nit: while a role saves, every row is disabled and the edited row shows no spinner. | (nit) Show `<Spinner>` next to "Change" on the row where `busy === person.email`. |
| Responsive | 9 | Phone: the badge drops to its own line under the email. iPad: a single-line row. | (Spacer fix is under Layout.) |
| Accessibility | 9 | "Change roles for Lek", "More for Lek", each toggle has an `aria-label`, buttons are 44px on touch. | — |

**Average 8.6**

---

### New coupon (extra-new-coupon-ipad, extra-new-coupon-phone, ux-p8-new-coupon-phone)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Three dark fills sit within 300px of each other: the selected "%", the selected "All villas" (both `bg-foreground`), and "Save & publish" (`bg-primary`, navy). The primary doesn't stand out. | Switch both coupon segmented controls to the `tone="subtle"` toggle proposed under Team (white thumb on a muted track). That leaves Save & publish as the only solid fill. |
| Typography | 9 | Serif title, code in mono, 14px labels, hints at 12px. | — |
| Layout & spacing | 8 | iPad: the Discount input sits about 5px lower than the Code input. The row is `flex items-center` and the segmented track is 52px (`h-11` plus `p-1`) against a 44px input. Desktop and iPad: typing the first digit of a discount sets `hasAside`, which moves the container from `max-w-3xl` to `max-w-7xl`, so the whole form jumps sideways while you type. | `CouponEditor.tsx` L484: change `flex items-center gap-2` to `flex items-start gap-2`, and give the ToggleGroup `p-0.5` with item class `h-10 pointer-coarse:h-10` so it matches the input height. L412: always use `max-w-7xl` and `lg:grid-cols-[minmax(0,1fr)_22rem]` for new coupons. Until a discount is set, the aside shows one muted 13px line: "Set a discount to see the summary". |
| Consistency | 8 | "Covers" uses radio cards (`ChoiceGroup`); right below it, "Villas" uses a segmented control. Two patterns for the same single choice, one above the other. Labels are 14px medium; Settings uses 12px muted. The primary is navy and the segmented selection is near-black, so two "dark" colours. | Make Villas a two-option `ChoiceGroup` ("All villas · every villa", "Choose villas"), or make Covers a three-way segmented control. Pick one. Apply the shared label style from Business › Consistency. |
| Color & contrast | 8 | Navy `--primary` (L 0.28) next to near-black `--foreground` (L 0.18) fills looks like a mistake rather than a meaning. | Fixed by the `tone="subtle"` toggle above. Alternatively set segmented `data-[state=on]:bg-primary` everywhere, so there is only one dark. |
| Efficiency | 9 | Defaults: %, Accommodation, All villas. The rarely used rules fold under "More". Save as draft moves into ⋯ on phones. Publishing asks to confirm, which is a correct safeguard. | — |
| Clarity | 8 | The Villas segmented control has no visible label (only an sr-only legend), so it isn't clear it belongs to Accommodation. The Discount placeholder "20%" reads like a value that's already filled in; Code says "e.g. SUMMER15". The phone bar says "Not saved" on an untouched form. | Add a visible `Villas` label (12px muted) above the toggle at L522. L489: change the placeholder to `e.g. 20` (`e.g. 500` for baht). L825: show `New coupon` instead of `Not saved` when `!code`. |
| States & feedback | 8 | Strong: validation on submit focuses the first error and opens "More"; spinner while saving; save notices; locked-code hint; archived callout; skeleton; not-found and no-access states. **Gap:** unsaved edits are only guarded by the back link and `beforeunload`. Clicking the sidebar or the Marketing section nav with a dirty form throws the work away without asking. It doesn't use `useUnsavedGuard`. | Replace the custom `beforeunload` effect and the `leave()` handler (L350–364) with `const { confirmDiscard } = useUnsavedGuard(dirty);`. That hook already catches every in-app link, the back link included. |
| Responsive | 9 | Phone: the sticky bottom bar is in thumb reach and the bottom padding matches its height. iPad: a focused 720px column suits a short form. | — |
| Accessibility | 9 | Labels, fieldset legends, toggles labelled "% percent" and "฿ baht", 44px targets, `has-[:focus-visible]` rings on the choice cards. Nit: `aria-describedby` points at `-hint` ids that often don't exist. | (nit) Only add each id when its element renders. |

**Average 8.4**

---

### Marketing dashboard (extra-marketing-dashboard-ipad, extra-marketing-dashboard-phone, ux-p8-dashboard-desktop)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The 40px hero tile works, but the black "Marketing" pill in the toolbar and the black "Net collected" pill in the chart header are the heaviest marks on the page and compete with it. | Use the `tone="subtle"` segmented control for the toolbar's basis switch (`DashboardView.tsx` L315) and the chart's measure switch (`DashboardChart.tsx` L92). |
| Typography | 9 | Hero 40px, tiles 28px semibold sans in tabular numerals, labels 12px muted, breakdown 13px. The ฿ is in the sans font. | — |
| Layout & spacing | 8 | Toolbar control heights don't match. Desktop: date, property, View options and Export are 36px (`sm:h-9`), while the Marketing/Finance track is 54px. iPad: 44px against 54px. The chart header has the same problem ("Net collected / Paid bookings" 52px, "Show as table" 36px). The section title is indented 4px (`px-1`) from the "Updated" line and the tile edges. | `ui/toggle-group.tsx`, segmented variant: track `p-0.5`; item `h-8 sm:h-8 pointer-coarse:h-10`, plus `after:absolute after:-inset-0.5` on the item for a 44px hit area. The track then measures 36px on desktop and 44px on touch, matching the buttons next to it. `DashboardTiles.tsx` L123: drop `px-1`. |
| Consistency | 8 | The property `Select` text is semibold (`SelectTrigger` default `font-semibold`), but every Settings select is `font-normal`. Segmented heights differ from neighbouring buttons (see Layout). | `ui/select.tsx`: set `font-normal` as the default. Remove the `font-normal` overrides in AdminSettingsView and TeamSettings. |
| Color & contrast | 9 | Chart series colours are distinct; Not tracked is grey; the status dot is green when fresh and amber while updating. | — |
| Efficiency | 9 | The last range is remembered per device; Refresh is inline; on phones, Export and View options move into ⋯ so the figures come first. | — |
| Clarity | 8 | Captions repeat what's already on screen. The section is "Results from tracked links", the Net collected hint says "From tracked links", and the Paid bookings hint says "From tracked links" again. "Discounts granted" has the hint "Coupon savings granted". The ROAS hint says `${roas.campaigns} campaigns with spend`, so one campaign reads "1 campaigns". | `DashboardTiles.tsx` `HINTS`: change "Paid bookings" to `Stays and orders paid`, change "Discounts granted" to `Given at checkout`, and drop the hero `hint` when `!p.cash`. L44: use `` `${pluralize(roas.campaigns, "campaign")} with spend` ``. |
| States & feedback | 10 | Skeleton matching the real layout; error callout with retry and reassurance; failed refreshes keep the old figures and show a warning; first-run empty state with actions that depend on role; empty range offers "Show the last 90 days"; truncated and non-THB callouts; `aria-busy` with dimming. | — |
| Responsive | 9 | Phone: 2-up tiles and the breakdown under a disclosure. iPad: hero plus 3-up grid. Desktop is held to `max-w-7xl`. | — |
| Accessibility | 9 | Legend chips are 44px on touch, InfoTips have 44px hit areas, the chart has an sr-only table and an `aria-label` on the stacked bar, the date button names the full range. | — |

**Average 8.7**

---

## Visual bugs

| File | Bug |
|---|---|
| ux-p7-business-desktop.png | Currency select (36px) and Time zone combobox (40px) side by side: bottom edges are 4px apart. Check-in and check-out selects are 36px against 40px inputs. |
| extra-settings-business-phone.png, extra-settings-team-phone.png, ux-p7-team-phone.png | The settings tab strip cuts off at "AI assistan", and the chevron over it can't be tapped. Email and Channels are hidden. |
| extra-settings-team-phone.png, ux-p7-team-phone.png | "Change" buttons sit about 48px in from the card's right edge on every row except Lek's (an empty ⋯ spacer). |
| extra-settings-team-ipad.png | Discount input plus "%" ends about 14px before the Cashier/Manager toggles below it, so the right edges don't line up. |
| extra-new-coupon-ipad.png | Discount input sits about 5px lower than the Code input in the same row (centred against the 52px segmented track). |
| ux-p8-dashboard-desktop.png, extra-marketing-dashboard-ipad.png | Toolbar: the Marketing/Finance pill is 54px tall, the controls beside it 36px (desktop) or 44px (iPad). Same mismatch between "Net collected / Paid bookings" and "Show as table". |
| ux-p8-dashboard-desktop.png, extra-marketing-dashboard-ipad.png | "Results from tracked links" is indented 4px from the "Updated" line and the tile edges. |
| (code, all coupon sizes) | Typing the first discount digit widens the container from `max-w-3xl` to `max-w-7xl`, so the form shifts sideways mid-typing (iPad and desktop). |

No faint text was found: `--muted-foreground` measures about 5.3:1 on `--muted` and 6:1 on the card.

## Averages

| Screen | Average |
|---|---|
| Business settings | 8.6 |
| Team | 8.6 |
| New coupon | 8.4 |
| Marketing dashboard | 8.7 |
| **Area** | **8.6** |
