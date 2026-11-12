import { formatMoney } from "@/components/admin/labels";
import { lineCouponBase, round2, type LineDiscount, type PricedLine } from "convex/lib/billMath";
import type { ApprovalPayload, CashierRules } from "convex/lib/staffTypes";

/**
 * Cashier limits and manager approvals as checkout shows them. The server decides
 * (convex/lib/staffAccess.ts, convex/staffApprovals.ts); these mirror its arithmetic so the hint a
 * cashier sees while typing agrees with what the server will refuse.
 */

export type ApprovalKind = ApprovalPayload["kind"];
export type ApprovalStatus = "pending" | "applied" | "rejected" | "cancelled" | "expired" | "stale";
/** The parts of a request (staffApprovals.forOrder / pending) that checkout shows. */
export type ApprovalView = {
  _id: string;
  orderId: string;
  kind: ApprovalKind;
  payload: ApprovalPayload;
  reason: string;
  requesterEmail: string;
  approverEmail?: string;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  amount: number;
  percent?: number;
  totalBefore: number;
  totalAfter: number;
};

type BaselineLine = PricedLine & { catalogUnitPrice?: number };

/**
 * A line's manual reduction against its baseline, in whole satang, exactly as manualReduction in
 * convex/lib/staffAccess.ts: the baseline is max(catalog price, line price) × quantity, and the
 * coupon is left out.
 */
export function manualReductionSatang(line: BaselineLine) {
  const subtotalSatang = Math.round(round2(Math.max(line.catalogUnitPrice ?? line.unitPrice, line.unitPrice) * line.qty) * 100);
  const reductionSatang = Math.max(0, subtotalSatang - Math.round(lineCouponBase(line) * 100));
  return { subtotalSatang, reductionSatang };
}

/** The most a cashier may take off the baseline: the limit in hundredths of a percent, halves up, as assertCashierDiscount. */
export function discountLimitSatang(subtotalSatang: number, limitPercent: number) {
  return Math.floor((2 * subtotalSatang * Math.round(limitPercent * 100) + 10000) / 20000);
}

/**
 * What a cashier's typed discount would do to this line: null when it is within their limit (or not
 * a valid discount yet), else the reduction in baht and the limit, for "฿X is over your N% limit".
 * The new discount replaces the line's current one; a price change on the line still counts.
 */
export function discountOverLimit(line: BaselineLine, discount: LineDiscount, rules: Pick<CashierRules, "discountLimitPercent">) {
  if (!Number.isFinite(discount.value) || discount.value < 0) return null;
  const { subtotalSatang, reductionSatang } = manualReductionSatang({ ...line, discount });
  if (reductionSatang <= discountLimitSatang(subtotalSatang, rules.discountLimitPercent)) return null;
  return { amount: reductionSatang / 100, limitPercent: rules.discountLimitPercent };
}

/** "10", "12.5": a percent with at most two decimals. */
export function formatPercent(value: number) {
  return String(round2(value));
}

export type NeedsApproval = { code: "NEEDS_APPROVAL"; kind: ApprovalKind; message?: string; amount?: number; discountLimitPercent?: number };

/** The server's typed refusal for a cashier action that needs a manager, or null for any other error. */
export function needsApproval(err: unknown): NeedsApproval | null {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object" || (data as { code?: unknown }).code !== "NEEDS_APPROVAL") return null;
  return data as NeedsApproval;
}


/** "฿120 discount", "custom price", "void", "payment fix": what a request asks for, as one phrase. */
export function approvalWhat(request: Pick<ApprovalView, "payload" | "amount">) {
  const { payload } = request;
  switch (payload.kind) {
    case "discount":
      return `${formatMoney(request.amount)} discount`;
    case "customPrice":
      return payload.action === "addCustomItem" ? `custom item · ${formatMoney(request.amount)}` : "custom price";
    case "voidPaidSale":
      return "void";
    case "paymentFix":
      return payload.action === "voidUnreceivedOrder" ? "no-payment void" : payload.action === "linkPaidLine" ? "link" : payload.action === "unlinkPaidLine" ? "unlink" : "payment fix";
  }
}

/** The manager's view: "asks for a ฿120 discount (10%)", "asks to void a paid sale". */
export function approvalAsk(request: Pick<ApprovalView, "payload" | "amount" | "percent">) {
  const { payload } = request;
  switch (payload.kind) {
    case "discount":
      return `asks for a ${formatMoney(request.amount)} discount${request.percent !== undefined ? ` (${formatPercent(request.percent)}%)` : ""}`;
    case "customPrice":
      if (payload.action === "addCustomItem") return `asks to add “${payload.name}” at ${formatMoney(payload.price)}`;
      return `asks for a custom price${request.amount ? ` (${formatMoney(request.amount)} off)` : ""}`;
    case "voidPaidSale":
      return `asks to void a paid sale (${formatMoney(request.amount)})`;
    case "paymentFix":
      return payload.action === "voidUnreceivedOrder" ? "asks to void a payment that wasn’t received" : `asks to fix a payment (${formatMoney(request.amount)})`;
  }
}

/** One line for a request's outcome on the order. */
export function approvalOutcome(request: Pick<ApprovalView, "status" | "approverEmail">) {
  switch (request.status) {
    case "pending":
      return "Waiting for a manager";
    case "applied":
      return request.approverEmail ? `Approved by ${personName(request.approverEmail)}` : "Approved";
    case "rejected":
      return "Declined. Nothing changed.";
    case "expired":
      return "Expired. Send a new request if you still need it.";
    case "stale":
      return "Order changed. Send a new request if you still need it.";
    case "cancelled":
      return "Request cancelled.";
  }
}

/** "mint@resort.co" → "Mint": staff are named by their sign-in email. */
export function personName(email: string) {
  const local = email.split("@")[0] ?? email;
  return local ? local[0].toUpperCase() + local.slice(1) : email;
}

/** Whole minutes left, at least 1 while it is still open. */
export function minutesLeft(expiresAt: number, now: number) {
  return Math.max(1, Math.ceil((expiresAt - now) / 60_000));
}

/** Resolved requests stay on the order this long, then the line goes away. */
export const OUTCOME_SHOWN_MS = 15 * 60_000;

/** The request the order shows: the pending one, else the newest recent outcome. */
export function shownRequest<T extends Pick<ApprovalView, "status" | "createdAt" | "expiresAt" | "resolvedAt">>(requests: readonly T[] | undefined, now: number): T | null {
  if (!requests?.length) return null;
  const pending = requests.find((request) => request.status === "pending");
  if (pending) return pending;
  const latest = requests[0];
  const settledAt = latest.resolvedAt ?? (latest.status === "expired" ? latest.expiresAt : latest.createdAt);
  return now - settledAt < OUTCOME_SHOWN_MS ? latest : null;
}
