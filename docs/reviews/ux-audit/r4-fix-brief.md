# Round 4 fix brief — last gaps to 9+

Round-3 grades (`audit-r3`): Opus checkout 8.7 · desk 8.63 · admin 8.7 (1 of 19 screens 9+ everywhere); Codex 8.94 with 12 of 19. Evidence: `grade-r3-checkout.md`, `grade-r3-desk.md`, `grade-r3-admin.md`, `grade-r3-codex.md`.

Read `design-decisions.md` first: everything there is **locked** (six entries were added this round — business save bar, Block placement, external-payment label, discount placeholder, cash chips, chat status). Where a grade report asks for something that contradicts a locked decision, follow the decision.

## Rules
Same as `r2-fix-brief.md` (money safeguards, guards, tones, touch-target specs green with no new exceptions, no orphans, min 12px, update tests by replacing old assertions with equivalent checks of the new behaviour — never weaken money/approval/permission assertions). Ownership: **A** `src/components/checkout/**`, `src/lib/staff-approvals.ts`; **B** desk/calendar/chat files in `src/components/admin/` and `src/components/reui/event-calendar/**`; **C** `AdminSettingsView`, `TeamSettings`, `SegmentedTabs`, `src/components/admin/marketing/**`, `src/components/ui/**`, `src/hooks/**`, `src/app.css`.

## Package A — checkout
1. **Refund**: amount (All/Half), "Refund to" and reason use `ToggleGroup variant="segmented" tone="subtle"` (locked) — remove the black selected rules from `REFUND_CHIPS`. "Refund to" fits five options on one track on phone (no 3+2 wrap; `text-[13px]` on phone if needed); amount row has no empty column when Half is hidden; reason chips don't leave a lone orphan row. Submit `min-h-12 text-[15px]`. Keep the order number and service name visible inside the open refund form.
2. **Orders sheet**: description "Open orders on every till. Look up today's receipts by order number." (cashier lookup copy says "today's receipts"; permissions unchanged); an "Open" label above the list; a "Current" badge instead of "· on screen"; each row's accessible name includes customer and item count.
3. **Line editor**: the fourth secondary tender shows "Split" (`aria-label="Split payment"`) so nothing wraps; the coupon icon button is `variant="ghost"` like ⋯ with a visible "Coupon" label from `sm` up; History is hidden until it has entries (removes the blank band on desktop).
4. **Approvals**: on phone open as the same bottom-sheet panel as Orders (`CheckoutDialogContent panel`), not a side drawer; item name + order number as a 12px muted line above the 15px ask; percent shown to at most one decimal (display only); no wide gap between "Expires in …" and its ⓘ on touch.
5. **Catalog (iPad)**: tiles never put the photo alone on its own row — `flex-nowrap` with a `min-w-0 flex-1` text column.
6. **Receipt**: "Paid" chip `h-6 text-[13px]` with a ✓; amount in the sub-line in normal (not muted) text.
7. **Split**: same ฿ prefix and alignment on every payment row incl. the auto-filled last one; the per-row "Amount" label is `sr-only` (each box is already headed "Payment N"); last box header "Payment N · rest".

## Package B — desk, calendars, chats
1. **New booking**: fieldsets `gap-6` between groups, `gap-4` between fields, `gap-1.5` label→input; "Block these dates instead" per the locked decision (ghost + `Ban` icon under the dates, aligned to the form edge); coupon placeholder `placeholder:font-sans placeholder:font-normal`; phone footer sticks to the bottom (form `h-full`, fieldset `flex-1`, footer `pb-[max(env(safe-area-inset-bottom),1rem)]`), no blank band below it. Drop the local disabled-Create override once C's shared disabled style lands (keep it if it still looks identical — no visual regression).
2. **Staff calendar**: every appointment chip gets a status-coloured `border-l-[3px]` on a `bg-card` fill so Booked never looks like the grey hatched turnaround/time-off; a `size-3` status icon when the chip is too narrow for the badge (`@[12rem]:hidden`); the "Next 16:00 ↓" pill is positioned so every staff column header has the same height; label "2 appointments" (pluralised) instead of "2 in view".
3. **Chats**: status per the locked decision; iPad thread header fits in two rows (badge on the channel line); phone composer input and Send share height (`min-h-11`) and radius (`rounded-xl`).
4. **Hotel calendar**: the KPI tile reads "Balance due" with the always-visible caption "From today's guests"; phone agenda rows ≤ 3 lines, status once (no double "Paid"), amount `text-[15px] font-medium`. Staff list rows use the same row layout (status right).
5. **Sheets**: phone payment row ⓘ sits next to its button (`flex-none`, not pushed to the far edge); appointment sheet sub-lines `text-sm` like the others; the "Open stay" link row is `w-full justify-between` with the chevron at the right edge.
6. **Missing information**: phone filter reads "Status: New"; each phone card has one left edge (Resolve cell aligned with the text column); property name truncates on the meta line; resolve failures show under the affected row (not only above the list).

## Package C — settings, team, marketing, shared
1. **Shared**: `ui/button` default variant disabled = `disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100` (check every primary button still looks right disabled). `SegmentedTabs`: a right-edge fade + chevron whenever the strip overflows so no tab is cut mid-word ("AI ass"). One `StickyActionBar` in `src/components/ui/` (opaque `bg-card`, border-t, safe-area padding) used by the settings save bar and the coupon phone bar. Monospace code inputs use `placeholder:font-sans`.
2. **Business**: save bar per the locked decision (dirty-only; save errors in the bar in destructive text); defaults state lives once in the History card with a secondary "Save defaults" button; no stray divider at the top of History (`[&>details]:border-t-0`). Booking rules, AI assistant and Email tabs use the same serif title + card pattern as Business and Team.
3. **Team**: Change `font-medium text-muted-foreground hover:text-foreground`; role badges `font-medium`; panel capped at `max-w-4xl` on iPad/desktop; the action column a fixed width so the owner's badge aligns with the others; owner row `min-h-11` like the rest; the Rules card has no hanging divider or empty status block.
4. **New coupon**: one name — "Stays" — everywhere (selector, Summary, phone bar); the Summary's Rules line drops the repeated "Ongoing"; empty phone bar label "Add a code and discount".
5. **Dashboard**: changing range/basis shows a loading state on the figures with visible "Updating…" text and `aria-busy` on the region; trim the ⓘ copy to one plain sentence each; the "Paid bookings" caption "From tracked links"; property select `border-border shadow-none` to match its neighbours; no selected-looking ring on the hero tile (`ui/stat.tsx`).

## Done means
Typecheck, lint 0 errors, full vitest, full browser suite incl. touch-target specs; recapture `r4-<a|b|c>`; open every capture in your area; commit on `r4-<a|b|c>`; never push/PR/deploy/touch Convex.
