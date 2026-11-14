# Round 3 fix brief — agreed fixes + locked decisions

Round-2 grades (`audit-r2`): Opus checkout 8.6 · desk 8.4 · admin 8.5; Codex 8.81 with 6 of 19 screens 9+ everywhere. Evidence: `grade-r2-checkout.md`, `grade-r2-desk.md`, `grade-r2-admin.md`, `grade-r2-codex.md`.

Across rounds, fresh graders reversed each other on several taste calls. Those are now **locked** (see `design-decisions.md`); don't change them. Everything below is either a defect or a fix both graders asked for.

## Rules
Same as `r2-fix-brief.md` (ownership, money safeguards, guards, tones, touch-target specs stay green, no orphans, min 12px). Ownership: **A** checkout + `AdminShell.tsx` account trigger; **B** desk/calendars/chats; **C** settings/team/marketing + `src/components/ui/**`, `src/hooks/**`, `src/app.css`.

## Package A — checkout
1. **Line editor on iPad** is clipped after Price with Remove item hidden. While a line is open, hide the coupon row; secondary tenders in one row of 4 at `lg`; give the order panel `lg:w-[420px]`; add a bottom fade/continuation cue whenever the scroller has more below.
2. **Line editor drafts**: a typed price or reason survives, or collapsing/switching rows/dismissing the sheet asks "Discard unsaved changes?" (use `useUnsavedGuard` + `confirmDiscard`).
3. **Split per-payment method picker**: `ToggleGroup variant="segmented" tone="subtle"` (locked). Mode track above stays strong.
4. **Refund on iPad**: the Items card must not scroll inside itself (remove `lg:max-h-…/overflow-y-auto`); the receipt column is `lg:sticky lg:top-6`. One chip class for All/Half, Refund to and Reason (`h-11 rounded-full border bg-background … aria-pressed:bg-foreground aria-pressed:text-background`), "Refund to" `grid-cols-3 @md:grid-cols-5`.
5. **Cash quick chips**: pressed = `ring-2 ring-foreground bg-foreground/5` so they never outweigh Confirm.
6. **Catalog**: phone account trigger is an initials avatar (not a second ⋯); the empty "View order"/"No items yet" bar is not tappable; no empty bordered footer band on an empty order; 3 catalog columns when the pane is ≥ 46rem.
7. **Receipt**: on phone the paper sits in a closed "Receipt preview" disclosure (still prints in full); line Refund is `variant="ghost"` (locked); guard link/unlink appointment dialog drafts (Escape, overlay, Cancel, Back) in `AfterPayment.tsx`.
8. **Orders**: copy "Find a paid order by its order number (#)."; filter uses `tone="subtle"`.
9. **Approvals**: ask line `text-[15px] font-semibold`, no "·" ("Mint asks for …").

## Package B — desk, calendars, chats
1. **New booking**: one-row footer (Total left, Create booking right); "Block these dates instead" moves under the dates; Custom price is a compact 48px switch row; Coupon visible in the first iPad view; the Price card is never sliced by the footer (use a separator, no mask). Disabled Create: muted background, full-opacity muted text.
2. **Sheets**: payment actions stack full width on phone (`grid grid-cols-1 sm:flex`) with the ⓘ aligned; "Paid elsewhere…" → **"Record external payment…"**; dirty notes ask before Take payment / navigation; "Notes saved." under the Save notes button; one surface (`Card p-4`) for every block incl. appointment history; **Mark arrived** sits inline with the status badge at default size (locked).
3. **Chats**: status is a text chip on phone too ("Needs you" / "AI on" / "Waiting for staff"), never a dot alone; drop the heading `aria-label` override so the accessible name matches the visible text; "AI couldn't answer" → "Waiting for staff"; "Save answer for AI" only under questions the AI escalated; "Chats" page title serif like other pages; one label "No reply needed" (icon-only on phone with that `aria-label`); phone subtitle truncates on one line.
4. **Missing information**: phone "Open chat" moves into ⋯ (no separate row); facts picker shows "Loading approved facts…" while the first page loads and no "no match" before it finishes; "Open chat" and "Create fact" same size.
5. **Calendars**: the month grid never hides a week inside an inner scroller — the page scrolls, rows grow (locked); legend explains every icon; pending uses `CircleDashed`; staff grid starts on the hour (no unlabelled hatched strip); "Next 16:00 ↓" and "2 today"; phone agenda card shrinks to its rows; hotel and staff calendars use the same search control and the same view name ("List"); grey day header reaches the card edge; phone KPI amounts have room (no edge-touching).

## Package C — settings, team, marketing, shared
1. **Shared**: `ui/button` size `sm` → `text-[13px] pointer-coarse:text-sm`. `use-unsaved-guard`: share one module-level "replaying" flag across all guards so nested dirty guards can't prompt in a loop.
2. **Business**: when built-in defaults are in use and the user can edit, show the sticky bar "Using built-in defaults" with Save enabled; copy "Default settings are active. Select Save to keep them."; invalid save focuses the first `[aria-invalid="true"]` field; History card aligned with the cards above (same padding), defaults text inside its hint.
3. **Team**: rule rows — labels `text-sm text-foreground`, subheading `text-xs text-muted-foreground`; heading "Who can do this without asking", options "Any cashier" / "Manager only"; discount as a `w-28` number field with "%" suffix, no wrapping label; invite = amber warning badge "Invited · expires 26 Nov", expired = destructive (locked); Change `variant="ghost"`; keep the ⋯ spacer at every width so Change buttons align (locked); one-line card description.
4. **New coupon**: single `max-w-3xl` column always; the Summary card appears *below* the form only once a valid discount exists (locked — no empty column, no layout jump); %/฿ toggle items `h-10` to match the input; Villas control `w-full` like Covers; phone sticky bar shows the summary ("20% off · Villa nights") once set; "Applies to: Stays / Spa / Both".
5. **Dashboard**: "Staff-entered" colour ≥ 3:1 against white (`src/app.css`); copy "credited to the last link clicked", "Visitors who allowed tracking"; "Select a source to hide or show it" on non-touch, "Tap a source…" on touch.

## Out of scope (accepted)
- Intercepting browser Back/Forward for unsaved drafts: App Router has no reliable hook; reload/close (`beforeunload`) and in-app links are guarded. Recorded in `design-decisions.md`.

## Done means
Same as round 2: typecheck, lint 0 errors, full vitest, full browser suite incl. touch-target specs; recapture `r3-<a|b|c>`; inspect every capture in your area; commit on `r3-<a|b|c>`; never push/PR/deploy/touch Convex.
