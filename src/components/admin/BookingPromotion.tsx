"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { TicketPercent, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { BookingPromotion } from "@/lib/booking/coupon";
import { adminMarketingPath } from "./admin-routes";
import { formatMoney } from "./labels";
import { REDEMPTION_STATE } from "./marketing/marketing-format";
import { StatusBadge } from "./StatusBadge";

/**
 * The coupon a stay was priced with, in the booking sheet's price: "DCNT-F1-20 · v1 · −฿1,800",
 * linked to the coupon, with the use's ledger state when the coupon's ledger lists it.
 */
export function BookingPromotionLine({ promotion, currency }: { promotion: BookingPromotion; currency: string }) {
  // The ledger is on the coupon detail (marketing.getCoupon); it lists recent uses, so older ones show no state.
  const coupon = useQuery(api.marketing.getCoupon, promotion.couponId && promotion.redemptionId ? { couponId: promotion.couponId } : "skip");
  const redemption = coupon?.redemptions?.find((row) => row._id === promotion.redemptionId);
  const meta = redemption ? REDEMPTION_STATE[redemption.state] : null;
  const label = (
    <>
      <TicketPercent aria-hidden className="size-3.5 shrink-0" />
      <span className="font-mono text-xs font-semibold">{promotion.code}</span>
    </>
  );
  return (
    <span data-testid="booking-promotion" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
      {promotion.couponId ? (
        <Link
          href={`${adminMarketingPath("coupons")}/${encodeURIComponent(promotion.couponId)}`}
          className="inline-flex items-center gap-1 rounded text-gold-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Coupon ${promotion.code}, open the coupon`}
        >
          {label}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 text-gold-text">{label}</span>
      )}
      {promotion.couponVersion !== undefined ? <span>· v{promotion.couponVersion}</span> : null}
      <span>· −{formatMoney(promotion.discount, currency)}</span>
      {meta ? <StatusBadge tone={meta.tone} label={meta.label} title={meta.hint} /> : null}
      {redemption?.overLimit ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
          <TriangleAlert aria-hidden className="size-3.5" />
          Over the limit
        </span>
      ) : null}
    </span>
  );
}
