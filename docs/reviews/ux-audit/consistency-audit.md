# Cross-page consistency audit (after P0–P8)

Fresh-eyes review of `ux/integration` after every package merged. Ranked, most impactful first.

1. **Payment has four names.** Stay popover "Checkout ฿X" + "Record payment" (BookingQuickActions.tsx:144,171); sheets "Take payment" + "Already paid…" (BookingFinancials.tsx:126,133, AppointmentFinancials.tsx:76-78); dialog titled "Record payment" (BookingFinancials.tsx:336). → "Take payment ฿X" and "Already paid…" everywhere; dialog title "Already paid". Popover: Take payment · Book spa · Details; Already paid…, Copy pay link, Cancel stay in ⋯.
2. **What's owed has five names**: "Due" (OrderPanel.tsx:243, OrderStrip.tsx:593,703), "฿1,200 due" (OrderPanel.tsx:142), "Balance due" (BookingFinancials.tsx:89, TodayStrip.tsx:17), "Balance", "Unpaid". → "Balance due" for every amount; "Unpaid" only as a status chip.
3. **Appointment sheet has two filled primaries** (Take payment, Mark arrived; AppointmentSheet.tsx:170) and a Payment row repeating the money block. → next step outline while a balance is due; delete the Payment row.
4. **Three date formats, two clocks** (28 toLocale* calls; receipt "14 Nov 2026, 03:07"; link review "2026-11-14 11:00"; Book spa "1:30 / 3:00" without AM/PM). → one formatter, `d MMM, HH:mm`.
5. **Raw IDs on screen**: CONF-…, SVC-… under titles and in order lines; "(last_touch_30d@1)" (DashboardView.tsx:365); "/villas/tideglass" on missing-info cards; "by ploy@…" (BookingSheet.tsx:296). → "Copy reference" in ⋯; names not emails; "Last touch · 30 days".
6. **History is several sections on bookings** (BookingFinancials.tsx:151,179); "Order history" vs "History"; "Deleted villa history" on every Settings tab (AdminSettingsView.tsx:107). → one History with tabs; deleted-villa history on Properties only.
7. **Disclosures differ**: 14 hand-made `<summary>`s, triangles vs chevrons vs boxed; labels More / More rules / More options. → one Disclosure component, label "More".
8. **Success feedback has five patterns** (toast only in ApprovalsPanel; own Undo bar in MissingInformation; admin-bulk banner; StaffRoster notice; coupon banner "· Dismiss" MarketingBits.tsx:340; AdminBookingsView.tsx:350 overwrites the drag hint). → the shared toast with optional Undo.
9. **Leaving a dialog has four labels**: Close / Cancel / Back / Done; "Cancel" also means "Cancel stay" and withdrawing a request. → ✕ only; destructive confirms "Keep stay" / "Keep appointment".
10. **Waiting shown twice** (bar + disabled "Waiting for approval", OrderPanel.tsx:257). → drop the disabled button; bar's "Cancel" → "Withdraw".
11. **Coupon editor keeps the ฿/% toggle** checkout removed. → reuse the checkout field, placeholder "20% or 500".
12. **ReasonField used three ways** (chips only + "Own reason" under More in Correct; unlabeled in refund/discount; "Reason" in void/link). → label "Reason", chips and input visible everywhere.
13. **Money buttons that don't say the money**: "Save correction", booking "Record refund" (BookingFinancials.tsx:398,456); cash vs split word order. → "Record refund ฿X", "Confirm ฿1,200 cash · no change".
14. **Method names differ**: "Transfer" vs "Bank transfer" (refunds.ts:19, admin-bookings-shared.ts:85); "PromptPay QR" wraps, confirm says "PromptPay". → "PromptPay" and "Transfer" everywhere.
15. **Team rule labels don't match actions** (TeamSettings.tsx:32-34). → "Correct payment", "Refund", "Void".
16. **Chat vs conversation** (AdminSessionActions.tsx:94-96,155). → "chat".
17. **Phone checkout header is three rows**. → one row: Customer chip, Orders icon, ⋯ (Add booking, New order).
18. **Hotel bookings cramped on phone** (search "Gues", filter "All v…", drag hint on touch). → expanding search icon, villa filter in ⋯, hide hint on touch.
19. **Missing-info cards offer two ways to resolve** plus a redundant "New" badge, "Context" label and path. → select is primary with "Create fact" as its last option; Ignore in ⋯.
20. **Panels with more than one sentence** (Record payment, Link review, New partner, Clear order OrderPanel.tsx:173, New booking).
21. **Record payment always asks date, time, note**. → "Received now · Change".
22. **Dashboard on phone: seven controls before the first number**. → Export CSV, Definitions, Refresh into ⋯.
23. **Book spa shows a time input and time chips** plus "Booked · Unpaid." → chips + "Other time…".
24. **People as emails on Team and stays, names in Approvals**. → display names everywhere.
25. **Save buttons named differently** ("Save business profile", "Save rules", "Save partner"). → "Save", or "Publish". Required check-in/out times offer "Clear": remove.

## Naming glossary
Balance due · Paid / Unpaid (chips only) · Take payment ฿X · Already paid… · Refund ฿X / Record refund ฿X · Correct payment · Void · Remove (take off a record) · Delete (erase a whole record, confirm names it) · Discard (orders only) · Withdraw (an approval request) · Keep … (safe button in destructive confirms) · ✕ closes a dialog · Done (finish a self-saving task) · Save / Publish · History · More · Reason · PromptPay, Transfer, Cash, Card · chat · Customer (who pays) · Guest (who stays)
