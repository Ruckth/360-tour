import { format, isSameDay } from "date-fns";

/**
 * On touch screens (phones and iPads), every button and field inside a checkout area is at least
 * 44×44 CSS px. Mouse layouts keep the compact sizes. Put it on the root of each area, including
 * portaled dialogs and sheets, which don't inherit it.
 */
export const TOUCH_TARGETS = "pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_input]:min-h-11";

/** Money typed at the till: digits and one decimal point, at most two decimals. */
export function amountInput(value: string) {
  const [whole, ...rest] = value.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

/** When a held bill was last touched: the time today, with the date on other days (walk-in numbers restart daily). */
export function heldAt(at: number, now = Date.now()) {
  return format(at, isSameDay(at, now) ? "HH:mm" : "d MMM, HH:mm");
}
