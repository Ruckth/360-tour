# Round 5 fix brief — defects only

Round-4 grades (`audit-r4`): Codex 8.98 with 17 of 23 screens 9+ everywhere; Opus checkout 8.81 · desk 8.84 · admin 8.6. Evidence: `grade-r4-checkout.md`, `grade-r4-desk.md`, `grade-r4-admin.md`, `grade-r4-codex.md`.

This round fixes only **defects both graders flagged or that break a locked rule** — no new taste changes. `design-decisions.md` is locked (four entries added: strong-selection scope, Team width, refund methods track, Split inside the track). Same rules as `r2-fix-brief.md`.

## Checkout
1. **Strong chips outside the tender track** (locked): therapist `Chip` and discount-request reason chips (`OrderPanel.tsx` ~1002, `ReasonField`) use the subtle selected style.
2. **Catalog tile text clipped on iPad** ("per night · up to 4 gu…", `CatalogPane.tsx` ~231): metadata wraps to two lines (`line-clamp-2`, no `truncate`); three columns only from `@min-[52rem]` (~125).
3. **Phone coupon control unlabelled**: show the "Coupon" text on phone too (drop `max-sm:sr-only`).
4. **Order card shrinks when payment opens** on iPad/desktop (`extra-cash-panel-desktop` vs `extra-line-open-desktop`): the order column keeps the same height in both states.
5. **Approvals touch gap**: the ⓘ next to "Expires in 5 min" doesn't push the row down on touch (`pointer-coarse:-my-3` on the tip trigger or equivalent).

## Desk
6. **Hotel calendar phone List**: no inner scroller under a scrolling page — when `phone && view === "agenda"` use `scrollMode="page"` + `w-full` (as the staff calendar does, `AdminBookingsView.tsx` ~348).
7. **Staff calendar legend**: Booked and Break/time off must not share the Clock icon (use `Coffee` for breaks/time off); turnaround uses its own `Timer` icon + `border-dashed bg-muted/60` instead of the "Not working" hatch.
8. **Chats phone "No reply needed"**: visible text label on phone, not a bare ✓✓ icon.
9. **Missing information**: property name never truncates — the phone meta line wraps (property on its own line), `whitespace-normal break-words`; desktop select-all checkbox aligned with the row checkboxes.
10. **New booking iPad**: the Custom price row lines up with the Coupon field (same label slot + `h-11` row); on phone the footer border never cuts the coupon label.

## Settings
11. **Channels**: replace the developer banner ("Could not check website environment variables: Request failed (404)") with "Couldn't check channel setup. Recent message activity is still shown." — technical detail behind a disclosure. `channelHealthMeta`: show "Receiving" when recent events exist and nothing failed; "Not checked" (not "Unknown") when the setup check failed. Human names instead of raw env var names in rows. Serif "Channels" title + description like other tabs; rows as a `divide-y` list, not cards inside a card.
12. **Booking rules**: visible units on every number field (`NumberField` suffix: "min", "days", "nights"…) included in the accessible name (`aria-describedby`); time picker placeholder "No cutoff".
13. **Team**: stable person key on rows (not role-dependent) and focus returns to that row's Change button after saving a role.
14. **Email**: Sender name placeholder reads as a hint ("Same as business name"), not a value.
15. **New coupon**: Summary card padding matches the form card (`p-5 sm:p-6`).
16. **Dashboard**: "Not tracked" and "Staff-entered" clearly distinct in the breakdown bar (slate `--chart-s0b`, ≥ 3:1 against its neighbour); the date range appears once (subtitle only).

## Done means
Typecheck, lint 0 errors, full vitest, full browser suite incl. touch-target specs (update copy/layout assertions to equivalent checks; never weaken money/approval/permission assertions); recapture `r5`; inspect every changed screen; commit on `r5`; never push/PR/deploy/touch Convex.
