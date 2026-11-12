# POS partial refunds (package 2.1)

Backend only. Recording a refund sends no money: staff return it themselves. No deployment or migration is required by this implementation task; schema additions keep existing documents valid.

## API

All endpoints below use `api`. Actor identity comes from the session. IDs use their named Convex tables.

`pos.refundLine` mutation:

```ts
{
  orderId: Id<'bills'>,
  lineId: Id<'billLines'>,
  amount: number, // POS REFUNDS ONLY: positive integer SATANG (25000 = THB 250)
  currency: string, // must match the line and order (checkout currently uses THB)
  method: 'cash'|'promptpay'|'card'|'transfer'|'stripe'|'other'|'unrecorded',
  reason: string, // trimmed, 1–500 characters
  idempotencyKey: string // trimmed, 8–100 characters; generate once per intended return
}
// returns:
{ refund: RefundView, replayed: boolean }
```

```ts
type RefundView = {
  _id: Id<'billRefunds'>; _creationTime: number;
  orderId: Id<'bills'>; lineId: Id<'billLines'>;
  amount: number; currency: string; method: /* union above */ string;
  reason: string; idempotencyKey: string;
  createdAt: number; createdByEmail: string; businessDate: string;
};
```

`createdAt` is server time in milliseconds; `businessDate` is its Bangkok `YYYY-MM-DD` date. This API does not backdate returns. The stored `createdBy` is the canonical identity token; public views omit that token. Approval execution records the manager as the actor; the approval request keeps the requester and approver.

Retries with the same normalized args return the original refund, without any writes, even when the line is now exhausted or the cashier still requires approval. Reusing a key with different order, line, amount, currency, method or trimmed reason throws `IDEMPOTENCY_CONFLICT`. Keys are global across POS refunds. Keep the key when retrying after a lost response, including after approval. New intended returns need new keys.

Owner/Manager can refund directly. Cashier requires `cashierRules.refund='cashier'`; otherwise the mutation throws `NEEDS_APPROVAL` with `kind:'refund'`. Cashier order visibility always uses existing `canReadCheckoutOrder` (settled receipts on today's payment business date). A manager handles older receipts.

`staffApprovals.create` uses the existing `{orderId,reason,payload}` envelope with:

```ts
payload: { kind: 'refund', lineId, amount, currency, method, idempotencyKey }
```

It returns `{requestId,status:'pending',expiresAt,totalBefore,totalAfter,amount}`. Payload `amount` is integer **satang**; approval preview `amount`, `totalBefore` and `totalAfter` use existing **major currency units**. Before/after totals are receipt charge minus POS refunds, before/after this proposal; attached-source refunds have their separate ledgers. Request creation records no refund. `staffApprovals.approve({requestId})` returns `{status,replayed}` and executes the exact shared refund helper atomically with marking the request applied. Find the resulting refund via `getOrder`, paginated history, or retry the original `refundLine` args/key.

Existing approval behavior remains: one effective pending request per order (`PENDING_APPROVAL`), five-minute inclusive expiry, no self approval by identity or email, current approver authorization, single use, and stale on order/line/links/source/customer/coupon changes, earlier POS refunds, requester changes or any cashier rule change. Refunds bump order revision. Fingerprints now include all rule values and the complete POS refund ledger. Pre-upgrade requests without the new optional rules fingerprint resolve stale and must be recreated. Another direct manager refund may proceed while a request is pending; it stales that request.

`staffAccess.myAccess` and `getCashierRules` always return `refund:'manager'|'cashier'`, default `manager`. `updateCashierRules` accepts optional `refund` beside existing fields; omitting it preserves the current value for older UI callers. Missing stored fields read as `manager`. Updates increment the existing revision and retain `STALE_RULES` conflict handling.

## Reads and UI integration

`pos.getOrder({orderId:string})` adds these live fields:

- Each line: `refundedAmountSatang`, `remainingRefundableSatang` (zero when not eligible).
- Top level: `refundedAmountSatang`, `fullyRefunded`, `posRefunds:RefundView[]` (newest 50).

These fields are optional in TypeScript for compatibility with existing offline adapters; the live backend always supplies them. Existing `lines[].net`, totals, payment records, receipt number and linked stay/appointment `refunds` remain as issued. Show POS returns separately and divide satang by 100 for display; existing stay/appointment refund amounts use major units.

`orderHistoryPages.billRefunds({orderId,paginationOpts:{cursor,numItems}})` returns the standard `{page:RefundView[],isDone,continueCursor,...}` Convex pagination result, newest first; page size 1–50. It has the same checkout visibility restriction. Use its independent cursor for all POS returns. Aggregate balances read the complete ledger, bounded at 1,000 rows per order; they never sum just the newest 50. Further returns fail visibly at the limit.

Every refund adds a `billAudit` row with `kind:'refund'`, amount/method/reason in the note and before/after line refundable values in major units. Thus the current FinancialHistory receipt-activity stream already exposes it. A `recordChanges` order history entry contains `{refundId,lineId,amount,currency,method,businessDate}`; its amount is satang. The UI can add the dedicated POS refund stream without changing existing source ledgers.

Cash reports emit a refund event on `businessDate`, even if the sale was paid outside the selected range. Cohort reports include all returns on the original sale. Report amounts and `creditMoney` remain major units, converting POS satang once. Report reads batch POS refunds by `businessDate` from the range start onward, including later returns for cohort totals; only orders outside that window or with a legacy forward date correction need a per-order refund read. Affiliate credits sync in the refund transaction. Attached stay collections remain on the stay; their money is never deducted twice.

## Cap and lifecycle decisions

```
remainingSatang = round(lineNet(issuedLine) * 100) - sum(earlier billRefunds.amount for line)
0 < amount <= remainingSatang
```

`billMath.lineNet` is the existing receipt math: gross after price override/quantity, less manual discount, then the stored coupon allocation (`couponDiscount`) frozen at settlement. No new coupon allocation is calculated. Each mutation re-reads the paid order, line, active source allocation and prior refund rows inside its transaction; Convex serialization prevents concurrent returns exceeding the cap.

Only paid orders with a settlement timestamp qualify. Attached booking/appointment rows and active paid-line links are refused with `LINE_NOT_REFUNDABLE`; use source finance controls for attached money. A refunded walk-in line cannot later be allocated via `linkPaidLine` (`LINE_HAS_REFUNDS`). This avoids allocating its original price after returning part of it. Standalone appointment fee extras own POS money and may be refunded here; the appointment status/payment and fee history remain unchanged.

A fully refunded order stays **paid**. `fullyRefunded` means positive POS returns equal the entire issued receipt's net charge (zero-charge receipts are false; mixed receipts with source money are not fully refunded by the POS ledger). Refunds do not modify source statuses or coupon redemption. The consumed coupon remains consumed, including its original discount and usage counters: a real completed sale followed by a return differs from an invalidated receipt. Existing ordinary void reverses redemption but keeps money; that behavior remains for orders without POS refunds.

Both ordinary void and “void unreceived” are refused after any POS refund (`ORDER_HAS_REFUNDS`); refund after either void is refused (`ORDER_NOT_PAID`). Continue returning remaining walk-in lines instead. This prevents conflicting reversal paths, preserves proof that money was received and avoids double-counting returns.

## Typed errors

New refund errors are `ConvexError({code,message,...})`:

| Code | Meaning |
| --- | --- |
| `NEEDS_APPROVAL` | Cashier needs a manager; includes `kind:'refund'` |
| `ORDER_NOT_FOUND` | Missing/hidden order on direct refund |
| `ORDER_NOT_PAID` | Order is unpaid, void or lacks settlement evidence |
| `LINE_NOT_REFUNDABLE` | Wrong order, attached source or active allocation |
| `REFUND_EXCEEDS_REMAINING` | Cap exceeded; includes integer satang `remaining` |
| `INVALID_REFUND_AMOUNT` | Not a safe positive integer in satang |
| `REFUND_CURRENCY_MISMATCH` | Currency differs from receipt/line |
| `INVALID_REFUND_REASON` | Empty or over 500 characters after trimming |
| `INVALID_IDEMPOTENCY_KEY` | Trimmed key outside 8–100 characters |
| `IDEMPOTENCY_CONFLICT` | Key reused for different details |
| `REFUND_HISTORY_LIMIT` | Complete ledger cannot be safely extended/read |
| `ORDER_HAS_REFUNDS` | A refunded order cannot be voided |
| `LINE_HAS_REFUNDS` | A refunded line cannot be allocated to a source |

Existing approval/rule endpoints retain `PENDING_APPROVAL`, `STALE_RULES`, terminal `stale`/`expired` return statuses, and their existing authentication/authorization/self-approval errors. A stale or expired request needs a new request; never retry it as a new refund key without checking the original result.
