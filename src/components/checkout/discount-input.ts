import { formatMoney } from "@/components/admin/labels";
import { lineGross, lineStaffDiscount, round2, type LineDiscount, type PricedLine } from "convex/lib/billMath";
import { formatPercent } from "./staff-approvals";

/**
 * The line editor's one discount field. A trailing "%" means percent ("15%", "15 %", "12.5%");
 * anything else is baht ("150", "150.50", "฿150", "1,200"). At most two decimals; thousands commas
 * only in groups of three, so "1,5" is refused rather than guessed.
 */
export type ParsedDiscount =
  | { ok: true; discount: LineDiscount; amount: number; percent: number; echo: string; what: string }
  | { ok: false; error: string };

const NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

/** Null for an empty field; otherwise the discount it means on `line`, or why it can't be one. */
export function parseDiscount(text: string, line: PricedLine): ParsedDiscount | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const percentMatch = /^(.*?)\s*%$/.exec(trimmed);
  const raw = (percentMatch ? percentMatch[1] : trimmed.replace(/^฿\s*/, "")).trim();
  if (!NUMBER.test(raw)) return { ok: false, error: "Type 15% or 150" };
  const value = Number(raw.replace(/,/g, ""));
  if (!(value > 0)) return { ok: false, error: "Type more than 0" };
  const gross = lineGross(line);
  if (percentMatch) {
    if (value > 100) return { ok: false, error: "At most 100%" };
  } else if (value > gross) {
    return { ok: false, error: `At most ${formatMoney(gross)}` };
  }
  const discount: LineDiscount = { type: percentMatch ? "percent" : "amount", value };
  // Worked out as the bill will: whole satang, at most the line's price.
  const amount = lineStaffDiscount({ ...line, discount });
  const percent = discount.type === "percent" ? value : gross > 0 ? round2((amount / gross) * 100) : 0;
  const pct = `${formatPercent(percent)}%`;
  const baht = formatMoney(amount);
  return discount.type === "percent"
    ? { ok: true, discount, amount, percent, echo: `${pct} = ${baht}`, what: `${pct} (${baht})` }
    : { ok: true, discount, amount, percent, echo: `${baht} = ${pct}`, what: `${baht} (${pct})` };
}

/** What the field shows for a discount already on the line: "15%" or "150". */
export function discountText(discount: LineDiscount | undefined) {
  if (!discount) return "";
  return discount.type === "percent" ? `${discount.value}%` : String(discount.value);
}
