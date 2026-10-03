"use client";

import Link from "next/link";
import { Check, Globe2, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { OtaRateComparison, useOtaComparison } from "@/components/pricing/OtaRateComparison";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { calculateBookingQuote } from "@/lib/booking/quote";
import { getLocalizedDirectBenefits } from "@/lib/i18n/public-content";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { currencyPrefix, type PublicVilla } from "@/lib/villas";

export function PriceComparison({
  property,
  onOpen360,
  onPreload360,
}: {
  property: Pick<PublicVilla, "id" | "pricePerNight" | "directDiscountPercent" | "currency">;
  onOpen360?: () => void;
  onPreload360?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("Villa");
  const pricingT = useTranslations("Pricing");
  const propertyId = property.id;
  const comparison = useOtaComparison(propertyId);
  const benefits = getLocalizedDirectBenefits(usePublicMessages());
  // Server-rendered villa pricing, refreshed by the live Convex query (what checkout charges).
  const pricePerNight = comparison?.pricePerNight ?? property.pricePerNight;
  const discountPercent = comparison?.directDiscountPercent ?? property.directDiscountPercent;
  const currency = comparison?.currency ?? property.currency;
  const directRate = calculateBookingQuote({ pricePerNight, nights: 1, discountPercent, currency }).directTotal;

  return (
    <aside className="rounded-2xl border border-border bg-card p-5 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            {t("directRate")}
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">
              {currencyPrefix(currency)}
              {directRate.toLocaleString()}
            </span>
            {discountPercent > 0 ? (
              <s className="text-sm text-muted-foreground">
                <span className="sr-only">{pricingT("standardRate")} </span>
                {currencyPrefix(currency)}
                {pricePerNight.toLocaleString()}
              </s>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">{t("perNightWords")}</p>
        </div>
        {discountPercent > 0 ? (
          <div className="shrink-0 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
            {pricingT("directDiscount", { percent: discountPercent })}
          </div>
        ) : null}
      </div>
      {comparison ? (
        <OtaRateComparison
          className="mt-5"
          rates={comparison.rates}
          pricePerNight={comparison.pricePerNight}
          discountPercent={discountPercent}
          showLinks
        />
      ) : null}
      <div className="mt-5 space-y-2">
        {benefits.slice(0, 5).map((benefit) => (
          <div key={benefit.benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
            {benefit.directOnly ? (
              <ShieldCheck className="h-4 w-4 text-gold" />
            ) : (
              <Check className="h-4 w-4 text-gold" />
            )}
            {benefit.benefit}
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-2">
        <Link
          href={localizeHref(`/booking?unit=${propertyId}`, locale)}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {t("bookDirect")}
        </Link>
        {onOpen360 ? (
          <Button
            variant="outline"
            size="lg"
            onClick={onOpen360}
            onFocus={onPreload360}
            onPointerEnter={onPreload360}
            onTouchStart={onPreload360}
            className="w-full bg-card"
          >
            <Globe2 className="h-4 w-4" />
            {t("explore360First")}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
