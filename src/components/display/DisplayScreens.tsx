"use client";

import { formatOrderNumber, formatReceiptNumber } from "convex/shared/orderMath";
import type { DisplayOrderState } from 'convex/shared/displayTypes';
import { TicketPercent } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { cn } from "@/lib/utils";

/** What the customer display shows: pairing code, welcome, the order, and "Thank you" once paid. Large type, landscape or portrait. */

type OrderState = Extract<DisplayOrderState, { state: "order" }>;
type PaidState = Extract<DisplayOrderState, { state: "paid" }>;

/** How long "Thank you" stays up after payment before the welcome screen returns. */
const PAID_SHOWN_MS = 3 * 60_000;
/** An unpaid order nobody has touched (changed or reopened at checkout) for this long gives way to the welcome screen. */
const IDLE_ORDER_MS = 30 * 60_000;

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={cn(
        "relative min-h-dvh overflow-hidden bg-background text-foreground antialiased",
        "bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,color-mix(in_oklch,var(--gold)_10%,transparent),transparent)]",
        className,
      )}
    >
      {children}
    </main>
  );
}

/** The glass card the checkout uses for its order panel, at display size. */
const GLASS_CARD = "rounded-3xl border border-border/80 bg-card/95 shadow-xl shadow-navy/10 backdrop-blur-xl supports-[backdrop-filter:blur(1px)]:bg-card/80 dark:shadow-black/30";

export function Message({ children }: { children: ReactNode }) {
  return (
    <Frame className="grid place-items-center px-[8vw] text-center">
      <p className="max-w-3xl text-2xl leading-relaxed text-muted-foreground">{children}</p>
    </Frame>
  );
}

export function PairingCode({ code, notice }: { code: string; notice: string | null }) {
  const t = useTranslations("Display");
  const groups = [code.slice(0, 3), code.slice(3)];
  return (
    <Frame className="flex flex-col items-center justify-center gap-[6vh] px-[6vw] py-[6vh] text-center">
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">{t("pairTitle")}</h1>
        <p className="mx-auto max-w-3xl text-xl leading-relaxed text-muted-foreground lg:text-2xl">{t("pairBody")}</p>
      </div>
      <p aria-label={t("pairCodeLabel", { code: code.split("").join(" ") })} className="flex items-center gap-[0.35em] text-[clamp(2rem,min(11vw,20vh),9rem)]">
        {groups.map((group, index) => (
          <span key={index} aria-hidden className="flex gap-[0.12em]">
            {group.split("").map((char, i) => (
              <span
                key={i}
                className="grid h-[1.35em] w-[1em] place-items-center rounded-[0.18em] border border-border bg-card font-mono font-semibold leading-none text-foreground shadow-sm"
              >
                {char}
              </span>
            ))}
          </span>
        ))}
      </p>
      <div className="space-y-3">
        {notice ? <p className="mx-auto max-w-2xl text-lg font-medium text-foreground">{notice}</p> : null}
        <p className="text-lg text-muted-foreground">{t("pairExpires")}</p>
      </div>
    </Frame>
  );
}

/** When the screen should give way to the welcome screen, timed from server timestamps. */
function shownUntil(state: DisplayOrderState) {
  if (state.state === "order") return state.activeAt + IDLE_ORDER_MS;
  if (state.state === "paid") return state.paidAt + PAID_SHOWN_MS;
  return null;
}

/** Whether `until` (ms since epoch, null: never) is still ahead, updating when it passes. */
function useBefore(until: number | null) {
  const [before, setBefore] = useState(() => until === null || Date.now() < until);
  useEffect(() => {
    if (until === null) return setBefore(true);
    setBefore(Date.now() < until);
    const id = window.setTimeout(() => setBefore(false), Math.max(0, until - Date.now()));
    return () => window.clearTimeout(id);
  }, [until]);
  return before;
}

export function Screen({ state }: { state: DisplayOrderState }) {
  const showing = useBefore(shownUntil(state));
  if (state.state === "idle" || !showing) return <Idle businessName={state.businessName} />;
  return state.state === "order" ? <Order order={state} /> : <Paid paid={state} />;
}

function Idle({ businessName }: { businessName: string }) {
  const t = useTranslations("Display");
  return (
    <Frame className="flex flex-col items-center justify-center gap-8 px-[8vw] text-center">
      <span aria-hidden className="h-px w-20 bg-gold" />
      {businessName ? (
        <h1 className="text-balance font-serif text-6xl font-semibold leading-[1.05] tracking-tight lg:text-8xl">{businessName}</h1>
      ) : null}
      <p className="text-2xl text-muted-foreground lg:text-3xl">{t("welcome")}</p>
    </Frame>
  );
}

function Paid({ paid }: { paid: PaidState }) {
  const t = useTranslations("Display");
  return (
    <Frame className="flex flex-col items-center justify-center gap-[5vh] px-[8vw] text-center">
      <p className="font-serif text-3xl font-semibold tracking-tight lg:text-4xl">{paid.businessName}</p>
      <span aria-hidden className="h-px w-20 bg-gold" />
      <h1 className="text-balance text-6xl font-semibold leading-[1.05] tracking-tight lg:text-8xl">
        {paid.customerFirstName ? t("thankYouName", { name: paid.customerFirstName }) : t("thankYou")}
      </h1>
      <div className="space-y-3">
        <p className="text-4xl font-semibold tabular-nums [overflow-wrap:anywhere] lg:text-5xl">
          {/* Deposits can cover the whole order; "฿0 paid" would read oddly. */}
          {paid.amountPaid > 0
            ? t("amountPaid", { amount: formatMoney(paid.amountPaid, paid.currency) })
            : t("paidInFull", { amount: formatMoney(paid.total, paid.currency) })}
        </p>
        <p className="text-xl text-muted-foreground tabular-nums lg:text-2xl">{t("vatIncludedIn", { vat: formatMoney(paid.vat, paid.currency), total: formatMoney(paid.total, paid.currency) })}</p>
        {paid.coupon && paid.coupon.saving > 0 ? (
          <p className="mx-auto inline-flex items-center gap-3 rounded-full border border-gold/50 bg-gold/10 px-6 py-2 text-xl font-medium text-gold-text tabular-nums [overflow-wrap:anywhere] lg:text-2xl" data-testid="display-coupon-saved">
            <TicketPercent aria-hidden className="size-[1.1em] shrink-0" />
            {t("savedWithCoupon", { amount: formatMoney(paid.coupon.saving, paid.currency), code: paid.coupon.code })}
          </p>
        ) : null}
        {paid.receiptNumber !== null ? (
          <p className="text-xl text-muted-foreground tabular-nums lg:text-2xl">{t("receiptNumber", { number: formatReceiptNumber(paid.receiptNumber) })}</p>
        ) : null}
      </div>
    </Frame>
  );
}

function Order({ order }: { order: OrderState }) {
  const t = useTranslations("Display");
  const money = (amount: number) => formatMoney(amount, order.currency);
  const newest = useRef<HTMLLIElement>(null);
  const count = order.lines.length;
  // The coupon has its own row; "Discounts" is what staff took off.
  const coupon = order.coupon && order.coupon.saving > 0 ? order.coupon : null;
  const staffDiscount = order.discount - (coupon?.saving ?? 0);

  // Also on switching orders: another order with the same line count can have taller rows.
  useEffect(() => {
    newest.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, order.orderNumber]);

  return (
    <Frame className="flex h-dvh flex-col">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-8 gap-y-2 px-[5vw] pb-[3vh] pt-[5vh]">
        <p className="font-serif text-3xl font-semibold tracking-tight lg:text-4xl">{order.businessName}</p>
        <p className="text-2xl text-muted-foreground lg:text-3xl">
          {order.customerFirstName ? t("welcomeName", { name: order.customerFirstName }) : t("yourOrder")}
          {order.orderNumber !== null ? <span className="ml-4 tabular-nums">· {t("orderNumber", { number: formatOrderNumber(order.orderNumber) })}</span> : null}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-[3vw] px-[5vw] pb-[5vh] portrait:grid-rows-[minmax(0,1fr)_auto] landscape:grid-cols-[minmax(0,1fr)_minmax(22rem,36%)] landscape:grid-rows-[minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none]">
          <ol className="flex flex-col gap-1.5">
            {order.lines.map((line, index) => {
              const isNewest = index === count - 1;
              const notes = [
                line.detail,
                line.qty > 1 ? t("qtyTimes", { qty: line.qty, price: money(line.price) }) : null,
                line.price !== line.unitPrice ? t("priceWas", { price: money(line.unitPrice) }) : null,
                line.discount - line.couponDiscount > 0 ? t("lineDiscount", { amount: money(line.discount - line.couponDiscount) }) : null,
                line.couponDiscount > 0 && order.coupon ? t("lineCoupon", { amount: money(line.couponDiscount), code: order.coupon.code }) : null,
                line.deposit > 0 ? t("lineDeposit", { amount: money(line.deposit) }) : null,
              ].filter(Boolean);
              return (
                <li
                  // Re-keyed when a line is added so the newest row fades in.
                  key={isNewest ? `newest-${count}` : index}
                  ref={isNewest ? newest : undefined}
                  className={cn(
                    "flex items-baseline gap-6 rounded-2xl border px-6 py-5 transition-colors duration-700",
                    isNewest ? "display-line-in border-gold/40 bg-gold/10" : "border-transparent",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-2xl font-medium leading-snug xl:text-3xl">{line.name}</p>
                    {notes.length ? (
                      <p className="mt-1.5 flex flex-wrap gap-x-5 text-lg tabular-nums text-muted-foreground xl:text-xl">
                        {notes.map((note, i) => <span key={i}>{note}</span>)}
                      </p>
                    ) : null}
                  </div>
                  <p className="max-w-[50%] shrink-0 text-right text-2xl font-semibold tabular-nums [overflow-wrap:anywhere] xl:text-3xl">{money(line.total)}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="flex flex-col justify-end landscape:self-end">
          <div className={cn(GLASS_CARD, "@container p-[clamp(1.5rem,3vw,2.75rem)]")}>
            <dl className="space-y-3 text-xl xl:text-2xl">
              <TotalRow label={t("subtotal")} value={money(order.subtotal)} />
              {staffDiscount > 0 ? <TotalRow label={t("discounts")} value={`−${money(staffDiscount)}`} /> : null}
              {coupon ? <TotalRow label={t("couponRow", { code: coupon.code })} value={`−${money(coupon.saving)}`} highlight /> : null}
              <TotalRow label={t("vatIncluded")} value={money(order.vat)} />
              {order.deposit > 0 ? <TotalRow label={t("paidInAdvance")} value={`−${money(order.deposit)}`} /> : null}
            </dl>
            <div className="my-6 h-px bg-border" />
            <div className="flex flex-col gap-2">
              <p className="text-lg font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("toPay")}</p>
              {/* As in the checkout's Due: never wider than the card, wrapping if it must (e.g. ฿1,000,000.50 on a 1024px iPad). */}
              <p className="min-w-0 text-right text-[min(6.5rem,13cqi)] font-semibold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere]" aria-live="polite">
                {money(order.due)}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

function TotalRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-6", highlight ? "font-medium text-gold-text" : "text-muted-foreground")}>
      <dt className="min-w-0 [overflow-wrap:anywhere]">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
