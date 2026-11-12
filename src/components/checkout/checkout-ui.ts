import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { formatMoney } from "@/components/admin/labels";
import { RESORT_ZONE, formatResortDate, formatResortFullDate, resortIsoDate, resortMidnight } from "@/lib/staff-bookings";
import type { ServiceSchedule } from "convex/lib/serviceSchedule";
import { MAX_ORDER, changeDue, formatReceiptNumber, lineCouponDiscount, roundMoney, type TenderMethod } from "convex/lib/orderMath";
import { posCouponMessage, type PosCouponProblem } from "convex/lib/posCoupons";
import type { OrderView } from "./backend";

export const TENDER_LABELS: Record<TenderMethod, { short: string; long: string; hint: string }> = {
  cash: { short: "Cash", long: "Cash", hint: "" },
  promptpay: { short: "PromptPay", long: "PromptPay QR", hint: "Show the shop's PromptPay QR. Confirm only once the transfer shows in the bank app." },
  card: { short: "Card", long: "Card", hint: "Charge the amount on the card terminal, then confirm here." },
  transfer: { short: "Transfer", long: "Bank transfer", hint: "Confirm once the transfer has arrived in the account." },
};

/**
 * On touch screens (phones and iPads), every button, field and menu option inside a checkout area
 * is at least 44×44 CSS px. Mouse layouts keep the compact sizes. Put it on the root of each area,
 * including portaled dialogs, sheets and select menus, which don't inherit it.
 */
export const TOUCH_TARGETS =
  "pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_input]:min-h-11 pointer-coarse:[&_[role=option]]:min-h-11";

/**
 * A row of up to four equal buttons (tenders, cash shortcuts): four columns while each can be
 * 4rem wide, fewer and wider ones when enlarged text needs the room, so labels never overlap.
 */
export const UP_TO_FOUR_COLUMNS = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,max(4rem,calc((100%_-_1.5rem)/4_-_1px))),1fr))] gap-2";

/** Money typed at the till (or set by a shortcut): digits, one decimal point, two decimals, and at most `max`. */
export function amountInput(value: string, max = MAX_ORDER / 100) {
  const [whole, ...rest] = value.replace(/[^\d.]/g, "").split(".");
  const digits = whole.slice(0, String(max).length);
  const text = rest.length ? `${digits}.${rest.join("").slice(0, 2)}` : digits;
  return Number(text) > max ? String(max) : text;
}

const IN_RESORT = { in: tz(RESORT_ZONE) };

/**
 * A date-fns `format` in resort (Bangkok) time, whatever the device's zone, as the order history and
 * payment dates show it: receipts and the Orders list read the same on every till.
 */
export const formatResort = (at: number, pattern: string) => format(at, pattern, IN_RESORT);

/** When an order was last changed: the time today (the resort's day), with the date on other days. */
export function orderTime(at: number, now = Date.now()) {
  return formatResort(at, resortIsoDate(at) === resortIsoDate(now) ? "HH:mm" : "d MMM, HH:mm");
}

/** "Mon, Oct 26" for a resort date this year, with the year otherwise. */
function scheduleDay(date: string, now: number) {
  const at = resortMidnight(date);
  return date.slice(0, 4) === resortIsoDate(now).slice(0, 4) ? formatResortDate(at) : formatResortFullDate(at);
}

/**
 * A service row's planned date and time as staff read it (lib/serviceSchedule.ts): "Not scheduled",
 * "Thu, Nov 12 · time not set", "14:30 · date not set" or "Thu, Nov 12, 14:30". Null for a row
 * without a schedule (other kinds, and legacy rows, which keep their own start label).
 */
export function scheduleLabel(schedule: ServiceSchedule | undefined, now = Date.now()) {
  if (!schedule) return null;
  const { date, time } = schedule;
  if (date && time) return `${date === resortIsoDate(now) ? "Today" : scheduleDay(date, now)}, ${time}`;
  if (date) return `${date === resortIsoDate(now) ? "Today" : scheduleDay(date, now)} · time not set`;
  if (time) return `${time} · date not set`;
  return "Not scheduled";
}

/** The printed receipt's note under a service row; null for legacy rows, so their receipts read as issued. */
export function receiptSchedule(schedule: ServiceSchedule | undefined) {
  if (!schedule) return null;
  const { date, time } = schedule;
  const day = date ? formatResort(resortMidnight(date), "EEE d MMM yyyy") : null;
  if (day && time) return `${day}, ${time}`;
  if (day) return `${day} · time to be confirmed`;
  if (time) return `${time} · date to be confirmed`;
  return "To be scheduled";
}

/** How an order correction is titled in its history. */
export function correctionTitle(kind: "amended" | "void_unreceived" | "linked" | "unlinked") {
  return { amended: "Payment recording amended", void_unreceived: "Mistaken payment entry voided", linked: "Row linked after payment", unlinked: "Link undone" }[kind];
}

/** Who a receipt is issued to: the name frozen at payment (or a legacy order's copied name). */
export function receiptName(view: Pick<OrderView, "receiptCustomer">) {
  return view.receiptCustomer?.name;
}

type BookingRefs = Pick<OrderView, "source"> & Partial<Pick<OrderView, "sources">>;

/**
 * The receipt's booking line: every booking the order is for, its own first (see
 * orderSourceRefs in convex/pos/private/orderModel.ts), e.g. "Booking: CONF-A" or "Bookings: CONF-A, SVC-7". Null for none.
 */
export function receiptBookings(view: BookingRefs) {
  const refs = view.sources?.length ? view.sources : view.source ? [view.source] : [];
  if (!refs.length) return null;
  return `${refs.length > 1 ? "Bookings" : "Booking"}: ${refs.map((ref) => ref.reference).join(", ")}`;
}

/** "Coupon DCNT-SPA-500", or just "Coupon" if the order no longer names it. */
export function couponLabel(view: Partial<Pick<OrderView, "promotion">>) {
  return view.promotion?.code ? `Coupon ${view.promotion.code}` : "Coupon";
}

/** Why checkout refused a coupon (apply, or settle at payment), worded for staff. Null for any other error. */
export type CouponRefusal = { code: "coupon_unavailable" | "coupon_changed"; message: string };

export function couponRefusal(err: unknown): CouponRefusal | null {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") return null;
  const { code, message, problem } = data as { code?: unknown; message?: unknown; problem?: unknown };
  if (code !== "coupon_unavailable" && code !== "coupon_changed") return null;
  const worded = problem && typeof problem === "object" && typeof (problem as { code?: unknown }).code === "string" ? posCouponMessage(problem as PosCouponProblem) : undefined;
  const fallback = code === "coupon_changed" ? "The coupon's saving changed. Check it again." : "This coupon can't be used on this order.";
  return { code, message: worded || (typeof message === "string" && message ? message : fallback) };
}

/** Plain-text receipt for share and copy. Tenders show what was handed over, plus change, like the printed receipt. */
export function receiptText(view: Pick<OrderView, "order" | "lines" | "payments" | "totals" | "receiptCustomer"> & Partial<Pick<OrderView, "promotion" | "refundedAmountSatang" | "refundHistoryTruncated">> & BookingRefs, business: string) {
  const { order, lines, payments, totals } = view;
  // POS line refunds (satang), as on the printed receipt; none past the history limit.
  const refunds = !view.refundHistoryTruncated;
  const refunded = refunds ? view.refundedAmountSatang ?? 0 : 0;
  const coupon = couponLabel(view);
  const row = (left: string, right: string) => `${left}  ${right}`;
  const change = changeDue(payments);
  const name = receiptName(view);
  const bookings = receiptBookings(view);
  return [
    business,
    `Receipt ${formatReceiptNumber(order.receiptNumber ?? 0)}${order.status === "void" ? " (VOID)" : ""}`,
    order.title,
    order.paidAt ? formatResort(order.paidAt, "d MMM yyyy, HH:mm") : "",
    ...(name ? [`Customer: ${name}`] : []),
    ...(bookings ? [bookings] : []),
    "",
    // With a coupon, each row shows its price before the coupon and its share under it; the
    // subtotal less the coupon is the total, as on the printed receipt.
    ...lines.flatMap((line) => {
      const share = line.couponDiscount ? lineCouponDiscount(line) : 0;
      const when = line.kind === "service" ? receiptSchedule(line.schedule) : null;
      return [row(`${line.name}${line.qty > 1 ? ` ×${line.qty}` : ""}`, formatMoney(roundMoney(line.net + share))), ...(share ? [row(`  ${coupon}`, formatMoney(-share))] : []), ...(when ? [`  ${when}`] : []), ...(refunds && line.refundedAmountSatang ? [row("  Refunded", formatMoney(-line.refundedAmountSatang))] : [])];
    }),
    "",
    ...(totals.coupon ? [row("Subtotal", formatMoney(roundMoney(totals.total + totals.coupon))), row(coupon, formatMoney(-totals.coupon))] : []),
    row("Total", formatMoney(totals.total)),
    row("VAT 7% included", formatMoney(totals.vat)),
    ...(totals.deposit ? [row("Paid before checkout", formatMoney(-totals.deposit))] : []),
    ...payments.map((p) => row(TENDER_LABELS[p.method].long, formatMoney(p.received ?? p.amount))),
    ...(change ? [row("Change", formatMoney(change))] : []),
    ...(refunded ? [row("Refunded", formatMoney(-refunded)), row("Net", formatMoney(totals.total - refunded))] : []),
    ...(totals.coupon ? ["", `You saved ${formatMoney(totals.coupon)} with ${view.promotion?.code ?? "a coupon"}`] : []),
  ].join("\n");
}
