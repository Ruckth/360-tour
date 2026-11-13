import { basisPointsToPercent } from 'convex/shared/money';
import { formatMoney } from "@/components/admin/labels";
import type { ApprovalPayload } from "convex/shared/staffTypes";

/**
 * Cashier limits and manager approvals as checkout shows them. The server decides
 * (convex/auth/private/staffAccess.ts, convex/pos/staffApprovals.ts); these mirror its arithmetic so the hint a
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

export { discountOverLimit } from 'convex/shared/staffDiscount';

/** "10", "12.5": a percent with at most two decimals. */
export function formatPercent(value: number) {
  return String(basisPointsToPercent(value));
}

export type NeedsApproval = { code: "NEEDS_APPROVAL"; kind: ApprovalKind; message?: string; amount?: number; discountLimitPercent?: number };

/** The server's typed refusal for a cashier action that needs a manager, or null for any other error. */
export function needsApproval(err: unknown): NeedsApproval | null {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object" || (data as { code?: unknown }).code !== "NEEDS_APPROVAL") return null;
  return data as NeedsApproval;
}


/** "฿120 discount", "custom price", "void", "payment fix", "refund ฿300 · Foot spa": what a request asks for, as one phrase. */
export function approvalWhat(request: Pick<ApprovalView, "payload" | "amount">, lineName?: string) {
  const { payload } = request;
  switch (payload.kind) {
    case "refund":
      return [`refund ${formatMoney(payload.amountSatang, payload.currency)}`, lineName].filter(Boolean).join(" · ");
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

/** The manager's view: "asks for a ฿120 discount (10%)", "asks to void a paid sale", "asks to refund ฿300 · Foot spa". */
export function approvalAsk(request: Pick<ApprovalView, "payload" | "amount" | "percent">, lineName?: string) {
  const { payload } = request;
  switch (payload.kind) {
    case "refund":
      return [`asks to refund ${formatMoney(payload.amountSatang, payload.currency)}`, lineName].filter(Boolean).join(" · ");
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
