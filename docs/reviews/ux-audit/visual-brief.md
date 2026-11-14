# Visual redesign brief (after the honest re-grade)

Graded from docs/screenshots/now/ against the befores: 6 improved, 5 marginal, 5 not improved. The earlier pass simplified structure (fewer controls, folding, labels) but changed almost no visual design: type scale, weight, surfaces, radius, spacing are as before. The cash panel and iPad receipt got visually worse.

## Rules for every screen
- Keep every function, approval and money safeguard (attempt keys, revisions, permissions). Visual/layout only.
- Existing tokens and shadcn components only; no new dependencies. `ui/info-tip.tsx`, `ui/toggle-group.tsx`, `ui/time-picker.tsx`, `ui/card.tsx` exist.
- **Money**: amounts always `font-sans tabular-nums` (the serif ฿ collides with digits). Serif only for page titles and labels like "Balance due".
- **One surface**: cards use `Card` (rounded-xl), not square `border bg-card` sections.
- **Type scale**: label 12px muted · body 14px · row title 15px medium · section title 15–16px semibold · hero number 28–40px semibold sans.
- One primary button per view; others outline/ghost. No ambiguous text-buttons.
- Sticky bars never cover content (add matching bottom padding); show Save bars only when dirty.

## Package A — checkout and receipt (src/components/checkout/*)
1. **Pay / cash panel** (PayPanel, OrderPanel): "Balance due" 12px muted + amount 40px semibold sans at top. Tenders as one segmented control (ToggleGroup, `rounded-full bg-muted` track, selected `bg-foreground text-background`, h-11); "Split" a ghost button at the row's end. Cash input h-14 text-2xl right-aligned with ฿ prefix. Quick chips (Exact · next note · next big note) h-11 equal width. **Change** block `bg-muted/50 rounded-xl p-4`: "Change" 14px left, amount 32px semibold emerald right, only when received > due. Confirm h-14 "Confirm cash" pinned with `mt-auto` (no dead space). Payment time one 13px muted line "Received now · Edit time" (underlined link). Split: one row per line (compact segmented method, w-32 amount, ×); "Remaining" back as a 28px hero row, amber while > ฿0.
2. **Receipt + refund on iPad** (ReceiptView, AfterPayment, RefundForm, FinancialHistory): `grid-cols-[5fr_7fr]`. Left: the receipt paper only, no buttons on it (matches print). Right: "Items" Card — per line: name 15px medium, amount right, amber "Not scheduled" chip, "Link appointment" outline + "Refund" ghost. Refund form opens inside that card under its line; "Refund to" a segmented control, not a native select; submit destructive-outline. History disclosure below. Header: New sale primary, Print outline, Share into ⋯. Phone: same order stacked.
3. **Order line editor** (OrderPanel, OrderStrip): inset settings list, 48px rows, label left / control right, dividers: "Discount · up to 10%" + w-32 input; "Schedule — Any therapist · Not scheduled ›"; "Price ฿1,200 ›" (replaces Change price). Last row "Remove item" centred destructive text with top border.

## Package B — bookings desk and chats (src/components/admin booking/appointment/calendar/chat files)
6. **New booking** (NewBookingDialog): three titled groups with 24px gaps — Stay (villa; check-in/out side by side even on phone), Guest (name + guests, phone, email), Price (custom price, coupon). "Block these dates instead" → ghost button left in footer. Footer total 18px semibold.
7. **Stay & appointment sheets** (BookingSheet, AppointmentSheet, BookingFinancials, AppointmentFinancials): money font fix; "Edit" and ⋯ move into the header beside ✕ as ghost icon buttons; key-value rows label 13px muted fixed 96px, value 14px.
8. **Chat header phone** (ChatsView, AdminSessionDetail): one line — name 16px semibold, channel · property 13px muted; phone/email behind ⓘ; "No reply needed" icon button on phone (label from sm); merge the "Needs you" strip into the header.
9. **Missing info** (MissingInformationPanel): ~64px rows, question 15px medium, meta 12px muted; right side inline: Resolve select w-64, "Create fact" ghost, ⋯. Phone: select and button side by side.
12. **Hotel calendar** (AdminBookingsView, TodayStrip, AdminCalendarHeader): day numbers top-left 13px; out-of-month days `text-muted-foreground/50`; "+N more" a small pill under bars; KPI tile values 28px; phone: compact 4-up strip.

## Package C — settings, marketing and shared primitives (AdminSettingsView, TeamSettings, admin/marketing/**, src/components/ui/**, src/app/globals.css)
Shared (land first; A and B use the same classes inline until then): money style (sans tabular ฿), segmented control on toggle-group, a `Stat` tile (label · ⓘ · value · one-line hint), `Card` as the standard surface.
3. **Marketing dashboard KPIs** (dashboard/DashboardTiles, DashboardScreen): "Net collected" hero tile 2 columns wide, value 40px; others 3-up iPad/desktop, 2-up phone, label 12px muted + ⓘ, value 28px semibold, at most one 13px caption; formulas/explanations into ⓘ; fold the business-total bar into the hero tile; Card radius.
4. **Business settings** (AdminSettingsView): four Cards — Identity (name, tagline) · Contact (email, phone, WhatsApp, LINE ID, LINE URL; 2 columns) · Location & currency (address, currency, time zone) · Check-in, check-out & policy. lg+: section title 15px semibold + one-line 13px muted description in a left 1/3 column, fields right 2/3. Replace hour/minute selects + "Clear" with `ui/time-picker.tsx`. Drop "(required)"; mark "(optional)". Save in a sticky bar only when dirty, with bottom padding.
10. **Team** (TeamSettings): name 15px medium, email 13px muted; role as a `Badge` right before "Change"; invited → amber "Invited · 26 Nov" chip; dirty-only Save bar.
11. **New coupon** (CouponEditor): title `font-serif` (only the code stays mono); Card radius; hide Summary until a discount is set, then lead with "20% off" at 28px; phone bottom padding equal to the sticky bar.
