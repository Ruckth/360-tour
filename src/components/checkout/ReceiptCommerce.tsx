"use client";

import { History } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type RefObject } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lastUsableAt } from "convex/shared/commerce/validity";
import { lineCouponDiscount, lineGross, lineStaffDiscount, roundMoney } from "convex/shared/orderMath";
import { refusalText, useCommerce, type AdjustTarget, type CommerceCopy, type ExternalMethod, type LegState, type OrderId, type OrderLine } from "./backend";
import { contentLabel, formatResort, voucherTenderLabel, type ReceiptCommerce, type ReceiptRowExtras, type VoucherTender } from "./checkout-ui";
import { useCommerceCopy } from "./commerce-copy";

/**
 * The commerce parts of a receipt (plan v27). ReceiptView renders these only for a receipt that has
 * products, packages, vouchers, session cover, goodwill or voucher spend, so a receipt from before
 * commerce keeps today's markup exactly. Everything here reads; returns, edits and gift slips write
 * in later waves.
 */

const EditHistory = lazy(() => import("./EditHistory"));

const METHOD = { cash: "pay.cash", promptpay: "pay.promptPay", card: "pay.card", transfer: "pay.transfer" } as const satisfies Record<ExternalMethod, string>;
const LEG_STATE = { planned: "pay.legPlanned", instructed: "pay.legInstructed", taken: "pay.legTaken", declined: "pay.legDeclined", unknown: "pay.legUnknown" } as const satisfies Record<LegState, string>;

const row = "flex justify-between gap-2";
const small = "flex justify-between gap-2 text-xs opacity-70";

/** One commerce row on the printed receipt: the row, then its parts, cover, discounts and refunds. */
export function CommerceReceiptRow({ line, extras, coupon, truncated }: { line: OrderLine; extras: ReceiptRowExtras; coupon: string; truncated: boolean }) {
  const copy = useCommerceCopy();
  const share = line.couponDiscount ? lineCouponDiscount(line) : 0;
  const refunded = truncated ? 0 : line.refundedAmountSatang || extras.returned;
  // The latest end date of what the row issued; a benefit that never expires outlasts any date (D20).
  const ends = extras.benefits.map((benefit) => benefit.issuedExpiresAt);
  const validity = !ends.length ? null : ends.includes(null) ? copy.t("vouchers.noExpiry") : copy.t("vouchers.validUntil", { date: copy.date(lastUsableAt(Math.max(...ends as number[]))) });
  return (
    <li data-receipt-kind={extras.kind}>
      <div className={row}>
        <span className="min-w-0">{line.name}{line.qty > 1 ? ` ×${line.qty}` : ""}</span>
        <span className="shrink-0 font-sans tabular-nums">{formatMoney(lineGross(line))}</span>
      </div>
      {line.staffName ? <p className="text-xs opacity-70">{line.staffName}</p> : null}
      {extras.contents.length ? (
        <ul className="mt-0.5 space-y-0.5 pl-3" aria-label={`${line.name} contents`}>
          {extras.contents.map((content) => (
            <li key={content.contentKey} className="text-xs opacity-70">
              <div className={row}>
                <span className="min-w-0">{contentLabel(content, copy)}</span>
                <span className="shrink-0 font-sans tabular-nums">{formatMoney(content.amount)}</span>
              </div>
              {content.codeMask ? <p data-voucher-mask="">{content.codeMask}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {line.kind === "voucher" ? extras.benefits.map((benefit) => benefit.codeMask ? <p key={benefit.contentKey} data-voucher-mask="" className="text-xs opacity-70">{benefit.codeMask}</p> : null) : null}
      {extras.coveredPrice !== null ? <p className="text-xs opacity-70">{copy.t("receipt.sessionUsed", { price: formatMoney(extras.coveredPrice) })}</p> : null}
      {validity ? <p className="text-xs opacity-70">{validity}</p> : null}
      {lineStaffDiscount(line) ? <div className={small}><span>Discount</span><span className="font-sans tabular-nums">{formatMoney(-lineStaffDiscount(line))}</span></div> : null}
      {share ? <div className={small}><span className="min-w-0">{coupon}</span><span className="shrink-0 font-sans tabular-nums">{formatMoney(-share)}</span></div> : null}
      {extras.goodwill ? (
        <div className={small} data-testid="receipt-line-goodwill"><span>{copy.t("receipt.goodwill")}</span><span className="font-sans tabular-nums">{formatMoney(-extras.goodwill)}</span></div>
      ) : null}
      {refunded ? (
        <div className="flex justify-between gap-2 text-xs" data-testid="receipt-line-refunded"><span>Refunded</span><span className="font-sans tabular-nums">{formatMoney(-refunded, line.currency)}</span></div>
      ) : null}
    </li>
  );
}

/** Subtotal and goodwill credit above the total. Goodwill is a discount, never a way of paying. */
export function GoodwillTotals({ subtotal, discount, coupon, couponLabel, goodwill }: { subtotal: number; discount: number; coupon: number; couponLabel: string; goodwill: number }) {
  const copy = useCommerceCopy();
  // Staff discounts are what's left of the order's discounts after the coupon and goodwill.
  const staffDiscount = roundMoney(discount - coupon - goodwill);
  return (
    <>
      <div className={row}><dt>Subtotal</dt><dd className="font-sans tabular-nums">{formatMoney(subtotal)}</dd></div>
      {staffDiscount > 0 ? <div className={row}><dt>Discounts</dt><dd className="font-sans tabular-nums">{formatMoney(-staffDiscount)}</dd></div> : null}
      {coupon ? <div className={row}><dt className="min-w-0">{couponLabel}</dt><dd className="shrink-0 font-sans tabular-nums">{formatMoney(-coupon)}</dd></div> : null}
      <div className={row} data-testid="receipt-goodwill-total"><dt>{copy.t("receipt.goodwill")}</dt><dd className="font-sans tabular-nums">{formatMoney(-goodwill)}</dd></div>
    </>
  );
}

/** A voucher-only sale isn't a tax invoice (D9): that line takes the VAT row's place. */
export function NotTaxInvoice() {
  return <p className="text-xs" data-testid="receipt-not-tax-invoice">{useCommerceCopy().t("receipt.notTaxInvoice")}</p>;
}

/** Voucher spend under the cash and card rows, named as a voucher with its masked code. */
export function VoucherTenderRows({ tenders }: { tenders: VoucherTender[] }) {
  const copy = useCommerceCopy();
  return tenders.map((tender) => (
    <div key={tender._id} className={row} data-testid="receipt-voucher-tender">
      <dt className="min-w-0">{voucherTenderLabel(tender, copy)}</dt>
      <dd className="shrink-0 font-sans tabular-nums">{formatMoney(tender.amount)}</dd>
    </div>
  ));
}

/** Hands Share the Commerce copy, which ReceiptView itself can't read on a receipt from before commerce. */
export function ShareCopyBridge({ copyRef }: { copyRef: RefObject<CommerceCopy | null> }) {
  const copy = useCommerceCopy();
  useEffect(() => {
    copyRef.current = copy;
    return () => { copyRef.current = null; };
  }, [copy, copyRef]);
  return null;
}

type HistoryTarget = { target: AdjustTarget; title: string };

/** Edit · History on a commerce row: one per issued package part or voucher, else one for the row. */
export function RowHistory({ line, extras, receipt }: { line: OrderLine; extras: ReceiptRowExtras; receipt: ReceiptCommerce }) {
  const copy = useCommerceCopy();
  const [open, setOpen] = useState<HistoryTarget | null>(null);
  const label = copy.t("buttons.editHistory");
  const targets: HistoryTarget[] = extras.benefits.length > 1
    ? extras.benefits.map((benefit) => {
      const content = extras.contents.find((item) => item.contentKey === benefit.contentKey);
      return { target: benefit.editHistory, title: content ? `${line.name} · ${contentLabel(content, copy)}` : line.name };
    })
    : (extras.history ?? receipt.history) ? [{ target: (extras.history ?? receipt.history)!, title: line.name }] : [];
  if (!targets.length) return null;
  return (
    <>
      <ul className="mt-1 grid gap-1 font-sans">
        {targets.map((item) => (
          <li key={`${item.target.targetType}:${item.target.targetId}`} className="flex items-center gap-3">
            {targets.length > 1 ? <span className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.title.slice(line.name.length + 3)}</span> : null}
            <Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 px-3 text-sm" aria-label={`${label}: ${item.title}`} onClick={() => setOpen(item)}>
              <History aria-hidden className="size-4" />{label}
            </Button>
          </li>
        ))}
      </ul>
      {open ? (
        <Suspense fallback={null}>
          <EditHistory target={open.target} title={open.title} onClose={() => setOpen(null)} />
        </Suspense>
      ) : null}
    </>
  );
}

/** The payment attempt behind this receipt and any open return, read-only, beside the receipt. */
export function CommerceReceiptStatus({ orderId }: { orderId: OrderId }) {
  const commerce = useCommerce();
  const attempt = commerce.usePaymentAttempt(orderId);
  const returnable = commerce.useReturnable(orderId);
  const copy = useCommerceCopy();
  // A plain settled payment already reads on the receipt; the card shows when there is more to it.
  const explain = attempt && (attempt.status !== "settled" || attempt.legs.length > 1 || attempt.legs.some((leg) => leg.state !== "taken"));
  const open = returnable?.open ?? null;
  if (!explain && !open) return null;
  return (
    <>
      {explain ? (
        <Card role="region" aria-label={copy.t("receipt.payment")} data-testid="receipt-attempt" className="grid gap-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold">{copy.t("receipt.payment")}</h3>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", attempt.status === "settled" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300")}>
              {copy.t(`receipt.attempt.${attempt.status}`)}
            </span>
          </div>
          {attempt.tillLabel || attempt.staffName ? <p className="text-xs text-muted-foreground">{copy.t("receipt.attemptBy", { till: attempt.tillLabel, staff: attempt.staffName })}</p> : null}
          <ul className="grid gap-1 text-sm">
            {attempt.legs.map((leg) => (
              <li key={leg.key} className={row}>
                <span className="min-w-0">{copy.t(METHOD[leg.method])} {copy.money(leg.amount)}{leg.instructedAt ? ` · ${formatResort(leg.instructedAt, "HH:mm")}` : ""}</span>
                <span className="shrink-0 text-muted-foreground">{copy.t(LEG_STATE[leg.state])}</span>
              </li>
            ))}
            {attempt.vouchers.map((voucher) => (
              <li key={voucher.voucherId} className={row}>
                <span className="min-w-0">{voucherTenderLabel({ codeMask: voucher.maskedCode }, copy)}</span>
                <span className="shrink-0 font-sans tabular-nums">{copy.money(voucher.paid + voucher.goodwill)}</span>
              </li>
            ))}
          </ul>
          {attempt.refusal ? <p className="text-sm">{copy.t("pay.whatChanged", { reason: attempt.refusal.code === "SERVER" ? attempt.refusal.message : refusalText(attempt.refusal, copy) })}</p> : null}
          {attempt.recovery ? (
            <p className="text-sm font-medium">{copy.t("pay.kept", { amount: copy.money(attempt.recovery.kept) })} · {copy.t("vouchers.stillDue", { amount: copy.money(attempt.recovery.stillDue) })}</p>
          ) : null}
        </Card>
      ) : null}
      {open ? (
        <Card role="region" aria-label={copy.t("returns.inProgress")} data-testid="receipt-open-return" className="grid gap-2 p-4 sm:p-5">
          <h3 className="text-base font-semibold">{copy.t("returns.inProgress")}</h3>
          <p className="text-xs text-muted-foreground">{[open.operatorName, formatResort(open.createdAt, "d MMM yyyy, HH:mm")].filter(Boolean).join(" · ")}</p>
          <ul className="grid gap-1 text-sm">
            {open.parts.map((part) => (
              <li key={part.partKey} className={row}><span className="min-w-0">{part.label}</span>{part.amount === null ? null : <span className="shrink-0 font-sans tabular-nums">{copy.money(part.amount)}</span>}</li>
            ))}
          </ul>
          <ul className="grid gap-1.5 border-t border-border pt-2 text-sm">
            {open.claims.map((claim) => (
              <li key={claim.key} className="grid gap-0.5">
                <div className={row}>
                  <span className="min-w-0 font-medium">{copy.t("returns.toMethod", { amount: copy.money(claim.amount), method: copy.t(METHOD[claim.method]) })}</span>
                  <span className="shrink-0 text-muted-foreground">{copy.t(`returns.state${claim.state[0].toUpperCase()}${claim.state.slice(1)}`)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{copy.t("returns.refundDueBy", { date: copy.date(claim.dueAt) })}</span>
              </li>
            ))}
            {open.voucherCredits.map((credit) => (
              <li key={credit.voucherId}>
                {/* Back onto a voucher the guest holds when the return says so, or when the receipt names it; else a new one. */}
                {!credit.existingVoucher && (credit.newVoucher || !credit.maskedCode)
                  ? copy.t("returns.toNewVoucher", { amount: copy.money(credit.paid + credit.goodwill) })
                  : copy.t("returns.toVoucher", { amount: copy.money(credit.paid + credit.goodwill), code: credit.maskedCode || "GV-••••" })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
