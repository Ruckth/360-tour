# Ease POS checkout study for the 360-tour staff checkout

I read the frontend on `origin/main` at `2b0c174e4` (2026-10-28) using `git show`, because the local `ease-international` worktree is on an older branch (`feat/team-insights`). Nothing was edited. All paths below are under `ease-international/src/app/(app)/checkout/` unless they start with `src/` or are root-level docs.

## 1. Ease checkout layout and flow

**Desktop/iPad landscape** (`CheckoutClient.tsx`)
1. **Customer strip at the top.** It defaults to "walk-in #N" (`nextWalkinNumber`). Tapping it opens `_components/CustomerSearchDialog.tsx`. Beside it sit a staff pill (`ServiceTeamEditor`, only on the legacy single-provider payload), `BranchSelect`, and the `บิลค้าง` (unpaid bills) trigger from `DraftBillManager.tsx`.
2. **Tabs** (`_components/CategoryTabs.tsx`, `TAB_KEYS` in `_hooks/useCheckout.ts:809`): frequent, service, product, course, voucher.
3. **Search plus filter sheet.** `ServiceSearchBar.tsx` and `CheckoutCatalogFilterSheet.tsx` filter by group and price range. `ProductScanSearchBar.tsx` adds barcode scanning.
4. **Grid** (`_components/ServiceGrid.tsx`): 2 columns on phone, 3 on iPad landscape, with group headings. Each tile has a 56px thumbnail beside the name, duration or stock bottom-left, and price on the right. A code comment explains that a hero image makes tiles about 200px tall. `CHECKOUT-TILE-IMAGE-PREVIEW-2026-10-06.html` compares the photo-heavy and minimal tile variants.
5. **Tapping a tile adds it to the bill immediately.** There is no detail step (`onClick={() => onAdd(svc)}`). A service always becomes its own one-unit row; only products merge into a quantity (`_lib/cart-lines.ts`).
6. **Right side panel, 360px:** `CartSidePanel` → `CartPanel.tsx`. The bill is always visible. Per-row edits happen there: provider/team, line discount, the price dialog, and the product seller.
7. **Bill cards, top to bottom:** people card (`CartActorCard.tsx`), line rows, entitlements (voucher code, punch card, loyalty), discount/coupon, pay-now-vs-book-later (`ScheduleLaterPanel`), deposits/credits, then totals.
8. **Locked footer:** the amount due is pinned, and the tender buttons sit right there. There is no separate "review" step. Cash swaps the panel to `CashPanel.tsx` (exact amount, ฿100/500/1000 quick amounts, change due). QR opens `qr-payment-dialog.tsx` or `store-qr-payment-dialog.tsx`.
9. **After payment,** `CheckoutReceiptRedirect.tsx` shows a toast and redirects to `src/app/(app)/receipt/bill/[billId]/page.tsx`. That page uses `ReceiptActions.tsx`: send via LINE, print, tax invoice, and void.

**Mobile:** the same catalog. A floating pill showing "N · ฿total" (`CartSheet.tsx` `CartFloatingTrigger`) opens a full-height bottom sheet containing the same `CartPanel`, with `CashPanel` swapping in. A "Manage" button for reordering and catalog links appears only when the cart is empty.

**Other entry points:** `src/lib/checkout-source.ts` parses `?booking_id=` (one booking) or `?bill_id=` (shared draft bill) strictly and refuses ambiguous URLs. `checkout/pending/[billId]` recovers a gateway QR sale after a reload.

## 2. Ease features missing from our plan

| Feature | Evidence | Why it matters |
|---|---|---|
| Customer selection, walk-in numbering, separate payer | `CustomerSearchDialog.tsx`, `CartActorCard.tsx`, `src/lib/draft-bill/payer.ts` | Courses, points and vouchers depend on knowing the customer. One guest may pay for several rooms. |
| Provider/team per service row, eligibility check, commission preview and per-person override | `ServiceTeamEditor.tsx`, `_lib/checkout-service-staff.ts`, `_lib/commission-preview.ts`, `CommissionAmountInput.tsx`, `CHECKOUT-TWO-STAFF-COMMISSION-PLAN-2026-09-06.md` | Therapist pay must be fixed at the time of sale. |
| Line price override with a required note, permission and audit entry | `CartLinePriceDialog.tsx`, `_lib/line-price-override.ts`, `CHECKOUT-LINE-PRICE-OVERRIDE-PLAN-2026-09-18.md` (`APPLY_DISCOUNT`, `bill.line_price_overridden`) | A one-off price change belongs at the till, not in a catalog edit. |
| Line and bill discounts (฿ or %), "deduct from commission" toggle, coupons | `CartLineDiscountEditor.tsx`, `DiscountCouponDialog.tsx`, `CHECKOUT-CART-UX-FUNCTIONAL-PLAN-2026-08-25.md` | Discounts change the commission basis. |
| Course/package sale and redemption | `CourseGrid.tsx`, `CheckoutCourseCredentials.tsx` | Spa packages. |
| Punch cards and loyalty points | `PunchCardRedeemPanel.tsx`, `LoyaltyRedeemPanel.tsx` | Retention. |
| Selling vouchers and paying with them | `VoucherGrid.tsx`, `VoucherRecipientDialog.tsx`, `VoucherPaymentDialog.tsx`, `_actions/voucher-pin-setup.ts` | Gift vouchers are common in spas. |
| Deposit deduction: booking deposit, partner deposit, manual off-system deposit | `ManualDepositRow.tsx`; `CartPanel` summary rows | Villa bookings usually have deposits. |
| VAT (inclusive, exclusive, exempt) and card surcharge | `taxSettings`, `cardSurchargeBps`; `summary.vat*` keys in `src/lib/i18n/checkout.ts` | Thai tax receipts. I found no service-charge code. |
| Held bills (`บิลค้าง`) and shared bills combining several bookings | `DraftBillManager.tsx`, `src/lib/draft-bill/*`, `BOOKING-SHARED-BILL-IMPLEMENTATION-PLAN.md` | Server-side bills you can come back to. |
| Pay now, book later | `ScheduleLaterPanel.tsx`, `PaidBillBookingSheet.tsx`, `BOOKING-PAID-BILL-ALLOCATION-BRIDGE-IMPLEMENTATION-PLAN.md` | Prepaid treatments. |
| Payment safety: idempotency key per tender attempt, mutation lock, QR status polling, pending recovery | `src/lib/checkout-idempotency.ts`, `src/lib/checkout-attempt-signature.ts`, `src/contexts/checkout-mutation-lock-context.tsx`, `_hooks/use-payment-status.ts` | Prevents double charges. |
| Tender set: cash, store QR (staff confirms), gateway QR, card, Alipay, WeChat; split capped at 3 methods | `src/lib/checkout-tender.ts`; `splitLimit` in the i18n file | |
| Per-tenant running receipt number, issued in the same transaction that marks the bill paid and never renumbered | `src/db/migrations/0137_bill_receipt_no.sql` | Retries and void don't create gaps or duplicates. |
| Void with reason; 58mm and 80mm thermal print; share as image; send via LINE; tax invoice; receipt branding | `_actions/voidBill.ts`, `src/components/receipt/ThermalPrintStyles.tsx`, `src/lib/printing/*`, `src/app/(app)/tax-invoice/*`, `settings/receipt` | |
| Clear-bill confirmation | `ClearCartDialog.tsx` | |

## 3. Where our plan differs from Ease

- **Detail panel plus "Add to bill"** versus Ease's one tap to add, with editing on the bill row. Ease's right panel is the bill, not the item.
- **Qty stepper on services:** Ease forbids `×2` on a service row. Each unit gets its own row, provider, discount and appointment (`cart-lines.ts`).
- **Long-press quick add:** Ease has no long-press because a normal tap already adds. Its press-and-drag exists only in reorder mode.
- **"Review & charge" step:** Ease puts the tenders in the bill footer and pays directly.
- **URL/localStorage bill state:** Ease keeps unfinished bills as server drafts. The URL carries only the mode. sessionStorage is used only for booking handoff (`useCheckout.ts:2414`).
- **Auto-pulling unpaid bookings:** Ease deliberately doesn't. Bookings are combined only from the calendar's "รวมบิล" (combine bills) action (comment at `CartPanel.tsx:1095`).
- **Category chips:** Ease uses tabs by kind, group headings in the grid, and filters in a sheet.
- **AI for price changes:** Ease handles one-off prices at the till (override plus note plus audit). Catalog edits are links to `/catalog`.

## 4. Top 10 recommendations, in priority order

1. **Make the right panel the bill and tapping a tile add the item.** Keep the item detail as an optional info button or sheet.
2. **Make every spa service its own unit row** with therapist, time and discount on that row. Allow quantity only for room nights and products.
3. **Persist bills as Convex draft documents (held bills) instead of localStorage.** Parse `?booking=`/`?bill=` strictly and refuse ambiguous URLs.
4. **Put a customer strip at the top, defaulting to "walk-in #N".** Offer the guest's unpaid bookings as an explicit "attach" list with a separate payer, not an automatic pull.
5. **Make settlement one Convex mutation with an idempotency key per tender attempt.** It should allocate the receipt number from a per-tenant counter in the same transaction and never renumber, including on void.
6. **Move one-off price override into Phase 1–2,** with a required note, a permission check and an audit row. Keep AI for catalog and scheduled prices only.
7. **Snapshot the therapist and their commission per row at settlement,** with an override for managers and a "discount reduces commission" toggle.
8. **Add VAT mode settings (inclusive/exclusive) and card surcharge in Phase 2,** plus a service charge if the villa needs one (Ease has no service-charge model to copy).
9. **Add deposit deduction and split tender (cap 3).** For cash, add quick amounts and change due. Make PromptPay staff-confirmed first, with gateway polling and pending-sale recovery later.
10. **Build the receipt page with print (58/80mm), share-as-image, LINE send and void-with-reason,** and redirect to it after payment. Defer packages, vouchers and loyalty to a later phase, but leave a slot for them in the bill.
