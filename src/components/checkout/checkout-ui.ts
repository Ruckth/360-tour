import { format, isSameDay } from "date-fns";
import { formatMoney } from "@/components/admin/labels";
import { MAX_BILL, changeDue, formatReceiptNumber, type TenderMethod } from "convex/lib/billMath";
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
 * Checkout's dark resort theme (`.checkout-theme` in app.css). Set on the checkout screen and on
 * each layer it portals (dialogs, sheets, menus), which don't inherit it. With TOUCH_TARGETS.
 */
export const CHECKOUT_THEME = "dark checkout-theme";
export const CHECKOUT_LAYER = `${TOUCH_TARGETS} ${CHECKOUT_THEME}`;

/** Money typed at the till (or set by a shortcut): digits, one decimal point, two decimals, and at most `max`. */
export function amountInput(value: string, max = MAX_BILL) {
  const [whole, ...rest] = value.replace(/[^\d.]/g, "").split(".");
  const digits = whole.slice(0, String(max).length);
  const text = rest.length ? `${digits}.${rest.join("").slice(0, 2)}` : digits;
  return Number(text) > max ? String(max) : text;
}

/** When an order was last changed: the time today, with the date on other days. */
export function orderTime(at: number, now = Date.now()) {
  return format(at, isSameDay(at, now) ? "HH:mm" : "d MMM, HH:mm");
}

/** Who a receipt is issued to: the name frozen at payment (or a legacy order's copied name). */
export function receiptName(view: Pick<OrderView, "receiptCustomer" | "legacyGuest">) {
  return view.receiptCustomer?.name ?? view.legacyGuest?.name;
}

type BookingRefs = Pick<OrderView, "source"> & Partial<Pick<OrderView, "sources">>;

/**
 * The receipt's booking line: every booking the order is for, its own first (see
 * orderSourceRefs in convex/pos.ts), e.g. "Booking: CONF-A" or "Bookings: CONF-A, SVC-7". Null for none.
 */
export function receiptBookings(view: BookingRefs) {
  const refs = view.sources?.length ? view.sources : view.source ? [view.source] : [];
  if (!refs.length) return null;
  return `${refs.length > 1 ? "Bookings" : "Booking"}: ${refs.map((ref) => ref.reference).join(", ")}`;
}

/** Plain-text receipt for share and copy. Tenders show what was handed over, plus change, like the printed receipt. */
export function receiptText(view: Pick<OrderView, "order" | "lines" | "payments" | "totals" | "receiptCustomer" | "legacyGuest"> & BookingRefs, business: string) {
  const { order, lines, payments, totals } = view;
  const row = (left: string, right: string) => `${left}  ${right}`;
  const change = changeDue(payments);
  const name = receiptName(view);
  const bookings = receiptBookings(view);
  return [
    business,
    `Receipt ${formatReceiptNumber(order.receiptNumber ?? 0)}${order.status === "void" ? " (VOID)" : ""}`,
    order.title,
    order.paidAt ? format(order.paidAt, "d MMM yyyy, HH:mm") : "",
    ...(name ? [`Customer: ${name}`] : []),
    ...(bookings ? [bookings] : []),
    "",
    ...lines.map((line) => row(`${line.name}${line.qty > 1 ? ` ×${line.qty}` : ""}`, formatMoney(line.net))),
    "",
    row("Total", formatMoney(totals.total)),
    row("VAT 7% included", formatMoney(totals.vat)),
    ...(totals.deposit ? [row("Paid before checkout", formatMoney(-totals.deposit))] : []),
    ...payments.map((p) => row(TENDER_LABELS[p.method].long, formatMoney(p.received ?? p.amount))),
    ...(change ? [row("Change", formatMoney(change))] : []),
  ].join("\n");
}
