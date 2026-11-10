"use client";

import { ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { receiptPath } from "@/components/checkout/checkout-source";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { useMarketingAccess } from "./MarketingAccess";
import { SideCard } from "./MarketingBits";
import { REDEMPTION_STATE, REDEMPTION_STATES, formatRange, formatStamp, nightsBetween, redemptionCounts, thb } from "./marketing-format";
import type { RedemptionRow, RedemptionState } from "./types";

const PAGE = 10;

/**
 * The coupon's usage ledger: one row per booking or checkout order that used the code, newest
 * first, with its state (held, consumed, released, reversed), guest and stay or order and receipt,
 * and discount. Late payments that went past the limit are flagged for review.
 */
export function CouponLedger({ code, redemptions }: { code: string; redemptions: RedemptionRow[] }) {
  const id = useId();
  const [filter, setFilter] = useState<RedemptionState | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const counts = redemptionCounts(redemptions);
  const rows = [...redemptions].sort((a, b) => b.createdAt - a.createdAt).filter((row) => filter === "all" || row.state === filter);
  const overLimit = redemptions.filter((row) => row.overLimit).length;

  return (
    <SideCard id={`${id}-ledger`} title="Usage ledger" description="Each booking or checkout sale that used the code, newest first.">
      {redemptions.length ? (
        <>
          <div className="flex flex-wrap gap-0.5 px-3 pt-3" role="group" aria-label="Show entries">
            {(["all", ...REDEMPTION_STATES] as const).map((state) => (
              <Button
                key={state}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={filter === state}
                onClick={() => {
                  setFilter(state);
                  setShown(PAGE);
                }}
                className={cn(
                  "h-9 gap-1 rounded-md px-2 text-xs",
                  filter === state ? "bg-muted text-foreground hover:bg-muted" : "text-muted-foreground",
                )}
              >
                {state === "all" ? "All" : REDEMPTION_STATE[state].label}
                {state !== "all" ? <span className="tabular-nums text-muted-foreground">{counts[state]}</span> : null}
              </Button>
            ))}
          </div>
          {overLimit ? (
            <p className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {overLimit === 1 ? "1 paid use" : `${overLimit} paid uses`} went past the limit or budget. The money was kept; review{" "}
                {overLimit === 1 ? "it" : "them"}.
              </span>
            </p>
          ) : null}
          <ul className="mt-3 divide-y divide-border border-t border-border" aria-label={`Uses of ${code}`}>
            {rows.slice(0, shown).map((row) => (
              <LedgerRow key={row._id} row={row} />
            ))}
            {rows.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">No {filter === "all" ? "" : `${REDEMPTION_STATE[filter].label.toLowerCase()} `}entries.</li> : null}
          </ul>
          {rows.length > shown ? (
            <div className="border-t border-border px-4 py-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShown((current) => current + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} more
              </Button>
            </div>
          ) : null}
          <dl className="grid gap-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {REDEMPTION_STATES.map((state) => (
              <div key={state} className="flex gap-1.5">
                <dt className="font-medium text-foreground">{REDEMPTION_STATE[state].label}</dt>
                <dd className="min-w-0">{REDEMPTION_STATE[state].hint}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No uses yet. Bookings made with {code} show here, held until they’re paid, and checkout sales once paid.</p>
      )}
    </SideCard>
  );
}

function LedgerRow({ row }: { row: RedemptionRow }) {
  const { role } = useMarketingAccess();
  const meta = REDEMPTION_STATE[row.state];
  const nights = row.booking ? nightsBetween(row.booking.checkIn, row.booking.checkOut) : 0;
  const gone = row.state === "released";
  return (
    <li className="grid gap-1 px-4 py-3" data-testid="ledger-row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone={meta.tone} label={meta.label} />
        <span className="text-xs tabular-nums text-muted-foreground">{formatStamp(row.updatedAt)}</span>
        <span className={cn("ms-auto font-semibold tabular-nums text-foreground", gone && "text-muted-foreground line-through")}>
          <span className="sr-only">Discount </span>
          {thb(row.discount)}
        </span>
      </div>
      {row.order ? (
        <>
          <p className="min-w-0 break-words text-sm text-foreground">
            {role === "admin" ? <Link
              href={receiptPath(row.order.orderId)}
              className="inline-flex items-center gap-1.5 rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ReceiptText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              {row.order.title}
            </Link> : <span>{row.order.title}</span>}
            {row.order.receiptNumber ? <span className="ms-2 font-mono text-xs font-semibold text-muted-foreground">{row.order.receiptNumber}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            Checkout{row.order.customerName ? ` · ${row.order.customerName}` : ""} · v{row.couponVersion}
          </p>
        </>
      ) : row.booking ? (
        <>
          <p className="min-w-0 break-words text-sm text-foreground">
            {row.booking.guestName}
            {row.booking.confirmationCode ? <span className="ms-2 font-mono text-xs font-semibold text-muted-foreground">{row.booking.confirmationCode}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatRange(row.booking.checkIn, row.booking.checkOut)}
            {nights ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""} · v{row.couponVersion}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Booking removed · v{row.couponVersion}</p>
      )}
      {row.overLimit ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Over the limit: paid after the last use or budget had gone. Review it.
        </p>
      ) : null}
    </li>
  );
}
