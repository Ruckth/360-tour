# Round 6 fix brief — last consensus defects

Round-5 grades (`audit-r5`): Codex 8.94 with 16 of 23 screens 9+ everywhere; Opus checkout 8.85 · desk 8.7 · admin 8.7. Evidence: `grade-r5-*.md`. Scores have plateaued; this round fixes only **real defects** (lost drafts, overflow/wrap bugs, locked-rule violations, misleading data, jargon both graders named). No new taste changes. `design-decisions.md` is locked — four rows added this round (phone order header, phone chat header, missing-info property, refund context line). Rules and ownership as in `r4-fix-brief.md` (A checkout, B desk/calendars/chats/sheets incl. `BookingMoneyFields`, `BookingFinancials`, `AppointmentFinancials`, `AdminSessionActions`, `AdminSessionDetail`; C settings/team/marketing/`ui`/`hooks`/`app.css`). Drafts use `useUnsavedGuard(dirty)` + `confirmDiscard()` with the existing copy ("Discard unsaved changes?" / "Keep editing" / "Discard"); successful submits never prompt; never touch attempt keys, frozen retries, revision checks, approval or permission logic.

## Package A — checkout
1. **Receipt Correct payment / Void drafts**: report dirty state from `CorrectPayment` / `VoidPanel` (`PaymentRecord.tsx`) to `ReceiptView`; toolbar Close, Escape, New sale and in-app links go through the guard (`refundDirty || taskDirty`); bypass after a successful `onDone`.
2. **Order editor continuation cue** (`OrderPanel.tsx` ~293): a separate `shrink-0` row below the item scroller (still only when `moreBelow`), never an absolute gradient over live rows.
3. **Phone order header** (`OrderPanel.tsx` ~192): per the locked row — one row, glyph hidden `max-sm`, title `min-w-0 truncate`, Coupon icon + text, ⋯, ✕. Check 360px and 390px.
4. **Empty order copy**: "Choose an item to add it." (works for mouse and touch).
5. **Refund reason chips on phone**: short visible labels "Cut short" / "Complaint" / "Wrong charge" while the saved reason text stays the full wording ("Short treatment", "Guest complaint", "Wrong charge"); comfortable side padding, nothing touching.
6. **Receipt ledger text** (`FinancialHistory.tsx` ~157): no raw database IDs in the visible text — use the guest/service/date or order reference already in the view, else "Linked stay" / "Linked appointment" / "Customer"; raw IDs only inside a closed "Technical details" `Disclosure`.

## Package B — desk, sheets, chats
1. **Stay sheet money dialogs** (`BookingFinancials.tsx` ~375): external-payment and refund/correction drafts (method, time, amount, note/reason, notify) count as dirty vs. their opening values; X / Escape / outside click go through `confirmDiscard`; successful recording closes without a prompt.
2. **Appointment money dialog** (`AppointmentFinancials.tsx` ~95): same.
3. **MethodPicker** (`BookingMoneyFields.tsx` ~123): `variant="segmented" tone="subtle"`; remove the `data-[state=on]:bg-foreground/text-background` overrides; keep every option and 44px targets.
4. **Chat Staff follow-up** (`AdminSessionActions.tsx` ~73): capture the value on open; changed text is guarded on X / Escape / outside click; baseline resets on Save; focus return unchanged.
5. **Phone chat header** (`AdminSessionDetail.tsx` ~364, `AdminSessionActions.tsx` ~135): per the locked row — exactly two rows at 390px and 360px; "No reply needed" keeps its visible text at the right end of row 2; status shown once.

## Package C — settings, team, marketing
1. **Team expired invite** (`TeamSettings.tsx` ~354): Renew becomes a `size-11` ghost icon button (`RotateCw`, `aria-label="Renew invitation for <name>"`, tooltip "Renew invitation") in the reserved ⋯ slot; remove the extra text button; the action column never wraps.
2. **Booking rules units said once**: labels without the unit, suffix carries it — "Pre-arrival email" + "days before", "Review request email" + "days after", "Book up to" + "days ahead", "Chat booking quote expires after" + "min" (adjust others the same way); widen the suffix padding so text never overlaps; number inputs `sm:max-w-56` when a unit is set.
3. **Channels wording**: "Last message in", "Last reply", "Failed replies · 24 h", "Failed replies · 7 d"; the 7-day count uses the warning tone (matches the amber badge), 24 h uses destructive; when warning/failing with no `latestError`, a 13px muted line "N replies failed in the last 7 days".
4. **Dashboard negative net** (`DashboardTiles.tsx` ~98): when any part's net is negative, don't draw a positive-only proportion strip — show every signed amount (e.g. the labelled list with "−฿X" values) and a one-line note "Refunds exceed income for some sources."; positive periods unchanged.

## Done means
Typecheck, lint 0 errors, full vitest, full browser suite incl. touch-target specs (replace changed copy/layout assertions with equivalent checks; never weaken money/approval/permission assertions; list every test edit). Add a browser or unit test for each new guard (dirty → dismiss → prompt; success → no prompt). Recapture to `docs/screenshots/audit-r6-<a|b|c>/`, open every changed screen, commit on `r6-<a|b|c>`. Never push/PR/deploy/touch Convex.
