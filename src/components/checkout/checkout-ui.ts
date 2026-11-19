import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { formatMoney } from "@/components/admin/labels";
import { RESORT_ZONE, resortIsoDate, resortMidnight } from "@/lib/staff-bookings";
import { staffDate, staffDateTime, staffTime } from "@/lib/staff-time";
import type { ServiceSchedule } from "convex/shared/serviceSchedule";
import { MAX_ORDER, changeDue, formatReceiptNumber, lineCouponDiscount, roundMoney, type TenderMethod } from "convex/shared/orderMath";
import { posCouponMessage, type PosCouponProblem } from "convex/shared/posCoupons";
import type { Id } from "convex/_generated/dataModel";
import { maskVoucherCodes } from "@/components/display/voucher-mask";
import type { AdjustTarget, CommerceCopy, OrderView } from "./backend";

/**
 * One name per method everywhere in checkout: PromptPay, Transfer, Cash, Card. `confirm` names the
 * method after the money on its button: "Confirm ฿1,200 card", "Confirm ฿500 cash + ฿700 card".
 */
export const TENDER_LABELS: Record<TenderMethod, { short: string; long: string; confirm: string; hint: string }> = {
  cash: { short: "Cash", long: "Cash", confirm: "cash", hint: "" },
  promptpay: { short: "PromptPay", long: "PromptPay", confirm: "PromptPay", hint: "Show the shop's QR and confirm once the transfer shows in the bank app." },
  card: { short: "Card", long: "Card", confirm: "card", hint: "Charge the amount on the card terminal, then confirm here." },
  transfer: { short: "Transfer", long: "Transfer", confirm: "transfer", hint: "Confirm once the transfer has arrived in the account." },
};

/** "฿500 cash + ฿700 card": tenders as the money buttons name them, money first. */
export const tendersText = (tenders: readonly { method: TenderMethod; amount: number }[]) =>
  tenders.map((tender) => `${formatMoney(tender.amount)} ${TENDER_LABELS[tender.method].confirm}`).join(" + ");

/** "Confirm ฿1,200 card": the money button for one non-cash tender. */
export const tenderConfirmLabel = (method: TenderMethod, amount: number) => `Confirm ${tendersText([{ method, amount }])}`;

/**
 * The cash money button: "Confirm ฿1,200 cash · no change", "Confirm ฿1,500 cash · change ฿300",
 * or "Short ฿200" while less than the amount due is entered (the button is off then).
 */
export function cashConfirmLabel(due: number, received: number) {
  if (received < due) return { ready: false, text: `Short ${formatMoney(roundMoney(due - received))}` };
  const change = roundMoney(received - due);
  return { ready: true, text: `Confirm cash · ${formatMoney(received)} received · ${change ? `change ${formatMoney(change)}` : "no change"}` };
}

/** The first round amount strictly above `due` in steps of `step`. */
const nextUp = (due: number, step: number) => (Math.floor(due / step) + 1) * step;

/**
 * Cash a guest is likely to hand over for `due`, in Thai notes: the next ฿500 and ฿1,000 up (฿1,200 →
 * ฿1,500 · ฿2,000), or the next ฿100 and ฿500 for under ฿500 (฿180 → ฿200 · ฿500). When both land on
 * the same amount the second is one larger note on (฿950 → ฿1,000 · ฿2,000). Never above `max`.
 */
export function cashNotes(due: number, max = MAX_ORDER): number[] {
  const [small, large] = due < 50_000 ? [10_000, 50_000] : [50_000, 100_000];
  const first = nextUp(due, small);
  const second = nextUp(due, large);
  return [first, second === first ? first + large : second].filter((note) => note <= max);
}

/**
 * On touch screens (phones and iPads), every button, field and menu option inside a checkout area
 * is at least 44×44 CSS px. Mouse layouts keep the compact sizes. Put it on the root of each area,
 * including portaled dialogs, sheets and select menus, which don't inherit it.
 */
export const TOUCH_TARGETS =
  "pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_input]:min-h-11 pointer-coarse:[&_textarea]:min-h-11 pointer-coarse:[&_select]:min-h-11 pointer-coarse:[&_a[href]]:min-h-11 pointer-coarse:[&_a[href]]:min-w-11 pointer-coarse:[&_[role=option]]:min-h-11";

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
  return resortIsoDate(at) === resortIsoDate(now) ? staffTime(at) : staffDateTime(at, { now });
}

/** "Mon 26 Oct" for a resort date this year, with the year otherwise. */
const scheduleDay = (date: string, now: number) => staffDate(resortMidnight(date), { weekday: true, now });

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
  return null;
}

/** How an order correction is titled in its history. */
export function correctionTitle(kind: "amended" | "void_unreceived" | "linked" | "unlinked") {
  return { amended: "Payment recording corrected", void_unreceived: "Mistaken payment entry voided", linked: "Row linked after payment", unlinked: "Link undone" }[kind];
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
export function receiptText(view: Pick<OrderView, "order" | "lines" | "payments" | "totals" | "receiptCustomer"> & Partial<Pick<OrderView, "promotion" | "refundedAmountSatang" | "refundHistoryTruncated">> & BookingRefs & ReceiptCommerceFields, business: string, copy?: CommerceCopy) {
  const { order, lines, payments, totals } = view;
  // Commerce rows need the Commerce copy; a receipt from before commerce never reads it.
  const commerce = copy ? receiptCommerce(view) : null;
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
      const extras = commerce?.rows.get(line._id);
      if (extras && copy) return commerceTextRows(line, extras, share, coupon, copy, row);
      return [row(`${line.name}${line.qty > 1 ? ` ×${line.qty}` : ""}`, formatMoney(roundMoney(line.net + share))), ...(share ? [row(`  ${coupon}`, formatMoney(-share))] : []), ...(when ? [`  ${when}`] : []), ...(refunds && line.refundedAmountSatang ? [row("  Refunded", formatMoney(-line.refundedAmountSatang))] : [])];
    }),
    "",
    ...(totals.coupon && !commerce?.goodwill ? [row("Subtotal", formatMoney(roundMoney(totals.total + totals.coupon))), row(coupon, formatMoney(-totals.coupon))] : []),
    ...(commerce?.goodwill && copy ? [
      row("Subtotal", formatMoney(roundMoney(totals.total + totals.coupon + commerce.goodwill))),
      ...(totals.coupon ? [row(coupon, formatMoney(-totals.coupon))] : []),
      row(copy.t("receipt.goodwill"), formatMoney(-commerce.goodwill)),
    ] : []),
    row("Total", formatMoney(totals.total)),
    commerce?.voucherSaleOnly && copy ? copy.t("receipt.notTaxInvoice") : row("VAT 7% included", formatMoney(totals.vat)),
    ...(totals.deposit ? [row("Paid in advance", formatMoney(-totals.deposit))] : []),
    ...payments.map((p) => row(TENDER_LABELS[p.method].long, formatMoney(p.received ?? p.amount))),
    ...(commerce && copy ? commerce.voucherTenders.map((tender) => row(voucherTenderLabel(tender, copy), formatMoney(tender.amount))) : []),
    ...(change ? [row("Change", formatMoney(change))] : []),
    ...(refunded ? [row("Refunded", formatMoney(-refunded)), row("Net", formatMoney(totals.total - refunded))] : []),
    ...(totals.coupon ? ["", `You saved ${formatMoney(totals.coupon)} with ${view.promotion?.code ?? "a coupon"}`] : []),
  ].join("\n");
}

// ─── Commerce receipts (plan v27) ─────────────────────────────────────────────────────────────
// What getOrder adds for a receipt with products, packages, vouchers, session cover or goodwill
// (convex/pos/orders.ts, W1·L1). Every field is optional, so a pre-commerce receipt reads exactly
// as before and nothing below runs for it. Codes are masked; the full code is only on a gift slip.

type Satang = number;
type CommerceLine = OrderView["lines"][number] & { goodwillDiscount?: Satang };
/** A voucher spend on the receipt. It's never cash, and never counted as money received. */
export type VoucherTender = { _id: string; amount: Satang; voucherId: Id<"vouchers">; codeMask?: string };
/** A session grant or voucher issued by a row, with its own Edit · History target. */
export type IssuedBenefit = { lineId: Id<"orderLines">; contentKey: string; issuedExpiresAt: number; codeMask?: string; editHistory: AdjustTarget };
export type ReceiptCommerceFields = {
  voucherPayments?: VoucherTender[];
  commerce?: {
    returnedAmountSatang: Satang;
    issuedBenefits: IssuedBenefit[];
    handovers?: { _id: Id<"handovers">; lineId: Id<"orderLines">; editHistory: AdjustTarget }[];
    editHistory: AdjustTarget;
  };
};
export type ReceiptView = Pick<OrderView, "order" | "lines" | "payments" | "totals"> & ReceiptCommerceFields;

/** One part of a package as sold, with its frozen share of the price (D1). */
export type ReceiptContent = {
  contentKey: string;
  kind: "sessions" | "product" | "voucher";
  label: string;
  units: number;
  amount: Satang;
  returned: Satang;
  codeMask: string | null;
  expiresAt: number | null;
};
/** A commerce row's extras: what it holds, its goodwill, its session cover and what was returned. */
export type ReceiptRowExtras = {
  kind: "product" | "package" | "voucher" | "covered" | "other";
  contents: ReceiptContent[];
  goodwill: Satang;
  /** A visit paid with a package session: what it would have cost. */
  coveredPrice: Satang | null;
  returned: Satang;
  benefits: IssuedBenefit[];
  history: AdjustTarget | null;
};
export type ReceiptCommerce = {
  rows: Map<string, ReceiptRowExtras>;
  voucherTenders: VoucherTender[];
  goodwill: Satang;
  returned: Satang;
  /** Only voucher value sold: the receipt isn't a tax invoice (D9). */
  voucherSaleOnly: boolean;
  history: AdjustTarget | null;
};

const COMMERCE_KINDS = new Set(["product", "package", "voucher"]);
const isCommerceLine = (line: CommerceLine) =>
  COMMERCE_KINDS.has(line.kind) || line.coverage !== undefined || line.saleSnapshot !== undefined || (line.goodwillDiscount ?? 0) > 0;


/** The commerce parts of a receipt, or null for a receipt from before commerce (shown exactly as today). */
export function receiptCommerce(view: ReceiptView): ReceiptCommerce | null {
  const lines = view.lines as CommerceLine[];
  const voucherTenders = view.voucherPayments ?? [];
  if (!view.commerce && !voucherTenders.length && !lines.some(isCommerceLine)) return null;
  const benefits = view.commerce?.issuedBenefits ?? [];
  const handovers = view.commerce?.handovers ?? [];
  const rows = new Map<string, ReceiptRowExtras>();
  for (const line of lines) {
    if (!isCommerceLine(line)) continue;
    const mine = benefits.filter((benefit) => benefit.lineId === line._id);
    const contents = (line.saleSnapshot?.contents ?? []).map((content): ReceiptContent => {
      const benefit = mine.find((item) => item.contentKey === content.contentKey);
      return {
        contentKey: content.contentKey,
        kind: content.voucherId ? "voucher" : content.grantId ? "sessions" : "product",
        label: content.label,
        units: content.units,
        amount: content.paidShare,
        returned: content.returnedAmount,
        codeMask: benefit?.codeMask ? maskVoucherCodes(benefit.codeMask) : null,
        expiresAt: benefit?.issuedExpiresAt ?? null,
      };
    });
    const handover = handovers.find((item) => item.lineId === line._id);
    rows.set(line._id, {
      kind: line.kind === "product" || line.kind === "package" || line.kind === "voucher" ? line.kind : line.coverage ? "covered" : "other",
      contents: line.kind === "package" ? contents : [],
      goodwill: line.goodwillDiscount ?? line.saleSnapshot?.goodwillDiscounts.reduce((sum, item) => sum + item.amount, 0) ?? 0,
      coveredPrice: line.coverage ? line.coverage.priceBefore : null,
      returned: line.saleSnapshot?.returnedAmount ?? 0,
      benefits: mine,
      history: mine.length === 1 ? mine[0].editHistory : handover?.editHistory ?? view.commerce?.editHistory ?? null,
    });
  }
  const goodwill = (view.totals as { goodwillDiscount?: Satang }).goodwillDiscount
    ?? [...rows.values()].reduce((sum, row) => sum + row.goodwill, 0);
  return {
    rows,
    voucherTenders: voucherTenders.map((tender) => ({ ...tender, codeMask: tender.codeMask ? maskVoucherCodes(tender.codeMask) : undefined })),
    goodwill,
    returned: view.commerce?.returnedAmountSatang ?? [...rows.values()].reduce((sum, row) => sum + row.returned, 0),
    voucherSaleOnly: lines.length > 0 && lines.every((line) => line.kind === "voucher"),
    history: view.commerce?.editHistory ?? null,
  };
}

/** "Gift voucher GV-••••-Q9XD": a voucher spend, named apart from cash and cards. */
export const voucherTenderLabel = (tender: Pick<VoucherTender, "codeMask">, copy: CommerceCopy) =>
  tender.codeMask ? copy.t("receipt.voucherTender", { code: tender.codeMask }) : copy.t("buttons.giftVoucher");

/** A package's part as one phrase: "5 × Thai or Hot stone 60", "Spa robe · Sand / M", "฿500 voucher value". */
export function contentLabel(content: Pick<ReceiptContent, "kind" | "label" | "units" | "amount">, copy: CommerceCopy) {
  if (content.kind === "voucher") return copy.t("packages.contentsVoucher", { amount: copy.money(content.amount) });
  if (content.kind === "sessions") return copy.t("packages.contentsSessions", { count: content.units, service: content.label });
  return content.units > 1 ? `${content.label} ×${content.units}` : content.label;
}

/** The shared text of one commerce row, in the printed receipt's order. */
function commerceTextRows(line: OrderView["lines"][number], extras: ReceiptRowExtras, share: number, coupon: string, copy: CommerceCopy, row: (left: string, right: string) => string) {
  const gross = roundMoney(line.net + share + extras.goodwill);
  return [
    row(`${line.name}${line.qty > 1 ? ` ×${line.qty}` : ""}`, formatMoney(gross)),
    ...extras.contents.flatMap((content) => [
      row(`  ${contentLabel(content, copy)}`, formatMoney(content.amount)),
      ...(content.codeMask ? [`    ${content.codeMask}`] : []),
    ]),
    ...(extras.coveredPrice !== null ? [`  ${copy.t("receipt.sessionUsed", { price: formatMoney(extras.coveredPrice) })}`] : []),
    ...(share ? [row(`  ${coupon}`, formatMoney(-share))] : []),
    ...(extras.goodwill ? [row(`  ${copy.t("receipt.goodwill")}`, formatMoney(-extras.goodwill))] : []),
    ...(line.kind === "voucher" ? extras.benefits.flatMap((benefit) => benefit.codeMask ? [`  ${maskVoucherCodes(benefit.codeMask)}`] : []) : []),
    ...(extras.returned ? [row(`  ${copy.t("receipt.returned")}`, formatMoney(-extras.returned))] : []),
  ];
}
