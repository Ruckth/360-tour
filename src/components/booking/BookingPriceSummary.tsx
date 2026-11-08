"use client";

import { Info, TicketPercent } from "lucide-react";
import { useTranslations } from "next-intl";
import { OtaRateComparison, useOtaComparison } from "@/components/pricing/OtaRateComparison";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Card } from "@/components/ui/card";
import type { BookingProperty } from "@/lib/booking/booking";
import type { PriceLine } from "@/lib/booking/coupon";
import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/villas";

/**
 * The discount lines and total, shared by the summary card, the review step on phones, and the
 * pay and success pages. A coupon line ("Coupon DCNT-F1-20 −฿1,800") replaces the direct-discount line.
 */
export function PriceLines({
  currency,
  priceLabel,
  subtotal,
  lines,
  total,
  totalLabel,
  note,
  className,
  totalClassName,
}: {
  currency: string;
  /** "฿4,500 per night x 2", or "Stay price" when the nightly rate isn't known. */
  priceLabel: string;
  subtotal: number;
  lines: PriceLine[];
  total: number;
  /** Replaces "Total", e.g. "Agreed price" for a custom price. */
  totalLabel?: string;
  /** One line about a code that isn't saving anything ("DCNT-F1-20 not used · …"). */
  note?: string | null;
  className?: string;
  totalClassName?: string;
}) {
  const t = useTranslations("Booking");
  const couponT = useTranslations("Coupon");
  const money = (amount: number) => `${currencyPrefix(currency)}${amount.toLocaleString()}`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex justify-between gap-3">
        <span className="min-w-0">{priceLabel}</span>
        <span className="shrink-0 tabular-nums">{money(subtotal)}</span>
      </div>
      {lines.map((line) =>
        line.kind === "coupon" ? (
          <div key="coupon" data-testid="price-coupon-line" className="flex justify-between gap-3 font-medium text-gold-text">
            <span className="flex min-w-0 items-center gap-1.5">
              <TicketPercent aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{couponT("summaryCoupon", { code: line.code })}</span>
            </span>
            <span className="shrink-0 tabular-nums">-{money(line.amount)}</span>
          </div>
        ) : (
          <div key="direct" data-testid="price-direct-line" className="flex justify-between gap-3 text-gold-text">
            <span className="min-w-0">{t("discount")}</span>
            <span className="shrink-0 tabular-nums">-{money(line.amount)}</span>
          </div>
        ),
      )}
      {note ? (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-words">{note}</span>
        </p>
      ) : null}
      <div
        className={cn(
          "flex justify-between gap-3 border-t border-border pt-2 text-sm font-semibold text-foreground",
          totalClassName,
        )}
      >
        <span>{totalLabel ?? t("total")}</span>
        <span data-testid="price-total" className="tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

export function BookingPriceSummary({
  property,
  nights,
  subtotal,
  lines,
  total,
  note,
}: {
  property: BookingProperty;
  nights: number;
  subtotal: number;
  lines: PriceLine[];
  total: number;
  note?: string | null;
}) {
  const villaT = useTranslations("Villa");
  const comparison = useOtaComparison(property.slug);
  const money = (amount: number) => `${currencyPrefix(property.currency)}${amount.toLocaleString()}`;
  return (
    <Card className="h-fit min-w-0 p-4 shadow-lg md:p-5">
      <div className="flex gap-3 lg:block">
        <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg lg:aspect-[4/3] lg:h-auto lg:w-full lg:rounded-xl">
          <PropertyImage
            images={property.images}
            alt={property.name}
            sizes="(min-width: 1024px) 360px, 96px"
          />
        </div>
        <div className="min-w-0 lg:contents">
          <h2 className="font-serif text-xl font-semibold leading-tight text-foreground lg:mt-4 lg:text-2xl">
            {property.name}
          </h2>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground lg:mt-1 lg:text-sm">
            {property.tagline}
          </p>
        </div>
      </div>
      <div aria-live="polite" className="mt-3 text-xs text-muted-foreground lg:mt-4 lg:text-sm">
        <PriceLines
          currency={property.currency}
          priceLabel={`${money(property.pricePerNight)} ${villaT("perNight")} x ${nights || 0}`}
          subtotal={subtotal}
          lines={lines}
          total={total}
          note={note}
          className="lg:space-y-2"
          totalClassName="lg:pt-3 lg:text-base"
        />
      </div>
      {comparison ? (
        <OtaRateComparison
          className="mt-4"
          rates={comparison.rates}
          currency={property.currency}
          pricePerNight={property.pricePerNight}
          discountPercent={property.directDiscountPercent}
          nights={nights}
        />
      ) : null}
    </Card>
  );
}
