import { format, isSameDay } from "date-fns";
import { formatMoney } from "@/components/admin/labels";
import { MAX_BILL, changeDue, formatReceiptNumber, type TenderMethod } from "convex/lib/billMath";
import type { BillView } from "./backend";

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

/** Money typed at the till (or set by a shortcut): digits, one decimal point, two decimals, and at most `max`. */
export function amountInput(value: string, max = MAX_BILL) {
  const [whole, ...rest] = value.replace(/[^\d.]/g, "").split(".");
  const digits = whole.slice(0, String(max).length);
  const text = rest.length ? `${digits}.${rest.join("").slice(0, 2)}` : digits;
  return Number(text) > max ? String(max) : text;
}

/** When a held bill was last touched: the time today, with the date on other days (walk-in numbers restart daily). */
export function heldAt(at: number, now = Date.now()) {
  return format(at, isSameDay(at, now) ? "HH:mm" : "d MMM, HH:mm");
}

/** Plain-text receipt for share and copy. Tenders show what was handed over, plus change, like the printed receipt. */
export function receiptText(view: Pick<BillView, "bill" | "lines" | "payments" | "totals">, business: string) {
  const { bill, lines, payments, totals } = view;
  const row = (left: string, right: string) => `${left}  ${right}`;
  const change = changeDue(payments);
  return [
    business,
    `Receipt ${formatReceiptNumber(bill.receiptNumber ?? 0)}${bill.status === "void" ? " (VOID)" : ""}`,
    bill.paidAt ? format(bill.paidAt, "d MMM yyyy, HH:mm") : "",
    bill.label,
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
