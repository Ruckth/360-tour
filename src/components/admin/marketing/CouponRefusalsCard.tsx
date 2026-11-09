"use client";

import type { CouponRefusalProblem, CouponRefusalSummary, CouponRefusalSurface } from "convex/lib/marketingReport";
import { useId } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SideCard } from "./MarketingBits";

/** Plain words for every refusal code. `coupon_worse` isn't a refusal: the card shows it on its own line. */
export const REFUSAL_LABELS: Record<CouponRefusalProblem, string> = {
  not_found: "Code not found",
  not_active: "Paused or inactive",
  not_started: "Not started yet",
  expired: "Offer has ended",
  sold_out: "Sold out",
  budget_used: "Discount budget used up",
  wrong_property: "Not for this villa",
  villa_only: "Not for this villa",
  stay_outside_dates: "Stay outside the dates",
  min_nights: "Minimum nights not met",
  min_subtotal: "Below the minimum spend",
  nothing_eligible: "Nothing in scope",
  already_on_stay: "Already used on the stay",
  order_too_large: "Order too large",
  link_without_offer: "Link without an active offer",
  coupon_changed: "Savings changed at payment",
  coupon_worse: "Not used: the direct offer was better",
};

export const REFUSAL_SURFACES: Record<CouponRefusalSurface, string> = {
  booking: "Booking site",
  admin_booking: "Staff booking",
  pos: "Checkout",
};

/** Refusals grouped by label (two codes share "Not for this villa"), largest first, plus the not-used count. */
export function refusalRows(summary: CouponRefusalSummary) {
  const counts = new Map<string, number>();
  let notUsed = 0;
  for (const { problem, count } of summary.byProblem) {
    if (problem === "coupon_worse") notUsed += count;
    else if (count > 0) counts.set(REFUSAL_LABELS[problem], (counts.get(REFUSAL_LABELS[problem]) ?? 0) + count);
  }
  const rows = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { rows, refused: rows.reduce((sum, row) => sum + row.count, 0), notUsed };
}

const n = (count: number) => count.toLocaleString("en-US");

/** The coupon page's "Refused, last 30 days" card: why codes didn't apply, and where. */
export function CouponRefusalsCard({ summary, days = 30 }: { summary?: CouponRefusalSummary; days?: number }) {
  const id = useId();
  const title = `Refused, last ${days} days`;
  if (!summary) {
    return (
      <SideCard id={id} title={title}>
        <div role="status" className="grid gap-2 p-4">
          <span className="sr-only">Loading refusals</span>
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </SideCard>
    );
  }
  const { rows, refused, notUsed } = refusalRows(summary);
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <SideCard id={id} title={title} description="Codes typed that didn’t apply. Guests kept the direct offer when eligible.">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
        <span className="text-sm text-muted-foreground">Refused</span>
        <span className="text-xl font-semibold tabular-nums text-foreground">{n(refused)}</span>
      </div>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-border border-t border-border" aria-label="Refusals by reason">
          {rows.map((row) => (
            <li key={row.label} className="grid gap-1.5 px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 text-foreground">{row.label}</span>
                <span className="font-semibold tabular-nums text-foreground">{n(row.count)}</span>
              </div>
              <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground/60" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">No refusals in the last {days} days.</p>
      )}
      {notUsed ? (
        <div className="flex items-baseline justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{REFUSAL_LABELS.coupon_worse}</span>
            <span className="block text-xs text-muted-foreground">The code was valid. No use was counted.</span>
          </span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{n(notUsed)}</span>
        </div>
      ) : null}
      {refused ? (
        <div className="grid gap-1.5 px-4 py-3">
          <p id={`${id}-where`} className="admin-eyebrow">
            Where it happened
          </p>
          <dl aria-labelledby={`${id}-where`} className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            {(Object.keys(REFUSAL_SURFACES) as CouponRefusalSurface[]).map((surface) => (
              <div key={surface} className="min-w-0">
                <dt className="text-muted-foreground">{REFUSAL_SURFACES[surface]}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{n(summary.bySurface.find((row) => row.surface === surface)?.count ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Counted when a guest or staff member saw the refusal. Diagnostic only.</p>
    </SideCard>
  );
}
