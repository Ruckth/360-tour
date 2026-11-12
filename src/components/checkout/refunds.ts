import type { api } from "convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import { formatMoney } from "@/components/admin/labels";
import { errorText } from "@/lib/staff-bookings";
import type { OrderLine, OrderView } from "./backend";

/**
 * POS line refunds as checkout shows them (convex/lib/billRefunds.ts). Refund amounts are integer
 * satang on the wire; everything else on the receipt is in baht.
 */

export type RefundMethod = FunctionArgs<typeof api.pos.refundLine>["method"];

/** The methods staff pick from, in the till's order. */
export const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "promptpay", label: "PromptPay" },
  { value: "card", label: "Card" },
  { value: "transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];
const METHOD_NAMES: Record<RefundMethod, string> = { cash: "Cash", promptpay: "PromptPay", card: "Card", transfer: "Bank transfer", stripe: "Stripe", other: "Other", unrecorded: "Not recorded" };
export const refundMethodName = (method: string) => METHOD_NAMES[method as RefundMethod] ?? method;

/** "฿250", "฿99.50" from satang. */
export const satangMoney = (satang: number, currency = "THB") => formatMoney(satang / 100, currency);

/** The form's amount text for a satang value: "250", "99.50". */
export const satangInput = (satang: number) => (satang / 100).toFixed(satang % 100 ? 2 : 0);

/** Typed baht ("250", "99.5") to whole satang, or null when it isn't a positive amount with at most two decimals. */
export function refundAmountSatang(text: string) {
  const clean = text.trim();
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(clean)) return null;
  const satang = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(satang) && satang > 0 ? satang : null;
}

/** The method the money came in by: the largest tender as currently recorded, else cash. */
export function defaultRefundMethod(view: Pick<OrderView, "paymentRecord">): RefundMethod {
  const tenders = [...view.paymentRecord.tenders].sort((a, b) => b.amount - a.amount);
  return tenders[0]?.method ?? "cash";
}

/** Where an attached or linked row's money is refunded instead: its booking or appointment. */
export function refundElsewhere(view: Pick<OrderView, "links">, line: OrderLine): "booking" | "appointment" | null {
  if (line.bookingId || line.kind === "booking") return "booking";
  if (line.appointmentId || line.kind === "appointment") return "appointment";
  const link = view.links.find((row) => row.lineId === line._id && row.status === "active");
  return link ? link.kind : null;
}

/** POS refunds recorded on this receipt (0 for older adapters without the field). */
export const refundedSatang = (view: Pick<OrderView, "refundedAmountSatang" | "posRefunds">) => view.refundedAmountSatang ?? 0;
export const hasLineRefunds = (view: Pick<OrderView, "refundedAmountSatang" | "posRefunds">) => refundedSatang(view) > 0 || Boolean(view.posRefunds?.length);

const errorData = (err: unknown) => {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
};
const businessDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : iso;
};

/**
 * One short line for the refund-era typed errors, so staff never read a code; anything else falls
 * back to errorText. Shared by refunds, approvals, void and payment fixes.
 */
export function checkoutErrorText(err: unknown, fallback: string) {
  const data = errorData(err);
  switch (data?.code) {
    case "REFUND_EXCEEDS_REMAINING": {
      const remaining = typeof data.remaining === "number" ? data.remaining : null;
      if (remaining === null) return "That's more than is left to refund on this line.";
      return remaining > 0 ? `Only ${satangMoney(remaining)} left to refund on this line.` : "Nothing is left to refund on this line.";
    }
    case "ORDER_HAS_REFUNDS":
      return "This receipt has refunds, so it can't be voided.";
    case "PAYMENT_DATE_AFTER_REFUND":
      return typeof data.earliestRefundBusinessDate === "string"
        ? `The payment date can't be after the first refund (${businessDay(data.earliestRefundBusinessDate)}).`
        : "The payment date can't be after the first refund.";
    case "NEEDS_APPROVAL":
      return "This needs a manager. Send it as a request.";
    case "PENDING_APPROVAL":
      return "A request is already waiting on this order.";
    case "IDEMPOTENCY_CONFLICT":
      return "Already recorded with other details. Check the receipt.";
    case "INVALID_REFUND_REASON":
      return "Add a reason, up to 500 characters.";
    case "INVALID_REFUND_AMOUNT":
      return "Enter an amount above ฿0.";
    case "INVALID_IDEMPOTENCY_KEY":
      return "Close the form and try again.";
    case "LINE_NOT_REFUNDABLE":
      return "Refund this on its booking or appointment.";
    case "LINE_HAS_REFUNDS":
      return "This line has refunds, so it can't be linked.";
    case "ORDER_NOT_PAID":
      return "Only a paid receipt can be refunded.";
    case "ORDER_NOT_FOUND":
      return "Receipt not found.";
    case "REFUND_CURRENCY_MISMATCH":
      return "The currency doesn't match this receipt.";
    case "REFUND_HISTORY_LIMIT":
      return "This receipt has too many refunds to add another.";
  }
  return errorText(err, fallback);
}

/** A typed refusal's code: the server answered and wrote nothing. Absent for a lost or unknown answer. */
export function errorCode(err: unknown) {
  const code = errorData(err)?.code;
  return typeof code === "string" ? code : null;
}

/** The server answered with a refusal (typed, or a ConvexError with a plain message), so nothing was written. */
export const answeredRefusal = (err: unknown) =>
  errorCode(err) !== null || (Boolean(err) && typeof err === "object" && typeof (err as { data?: unknown }).data === "string");

/** The server's remaining satang from REFUND_EXCEEDS_REMAINING, or null. */
export function remainingFromError(err: unknown) {
  const data = errorData(err);
  return data?.code === "REFUND_EXCEEDS_REMAINING" && typeof data.remaining === "number" ? data.remaining : null;
}
