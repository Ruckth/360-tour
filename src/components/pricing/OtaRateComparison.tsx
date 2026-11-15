"use client";

import { satangToBaht } from 'convex/shared/money';

import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { calculateDirectQuote } from "convex/shared/pricing";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/villas";

export type OtaComparison = FunctionReturnType<typeof api.catalog.properties.getOtaComparison>;
type OtaRate = NonNullable<OtaComparison>["rates"][number];

const otaComparisonQuery = api.catalog.properties.getOtaComparison;

const PLATFORM_NAMES: Record<OtaRate["platform"], string> = {
  booking_com: "Booking.com",
  agoda: "Agoda",
  airbnb: "Airbnb",
  expedia: "Expedia",
};

export function useOtaComparison(slug: string) {
  return useQuery(otaComparisonQuery, { slug });
}

/**
 * Direct price vs the OTA rates the owner has entered, all in the villa's `currency`. Shows stay
 * totals when `nights` is known, otherwise one night. Renders nothing without real rates — we
 * never invent OTA prices.
 */
export function OtaRateComparison({
  rates,
  currency,
  pricePerNight,
  discountPercent,
  nights,
  showLinks = false,
  className,
}: {
  rates: OtaRate[];
  currency: string;
  pricePerNight: number;
  discountPercent: number;
  nights?: number;
  showLinks?: boolean;
  className?: string;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  if (rates.length === 0) return null;

  const money = (amount: number) => `${currencyPrefix(currency)}${satangToBaht(amount).toLocaleString()}`;
  const stayNights = nights && nights > 0 ? nights : 1;
  const directTotal = calculateDirectQuote({ pricePerNight: pricePerNight, directDiscountPercent: discountPercent, currency: currency }, stayNights).directTotal;
  const rows = rates
    .map((rate) => {
      const total = rate.nightlyRate * stayNights;
      return { ...rate, total, savings: total - directTotal };
    })
    .sort((a, b) => b.total - a.total);
  const bestSavings = Math.max(0, ...rows.map((row) => row.savings));
  const checkedAt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    Math.min(...rates.map((rate) => rate.updatedAt)),
  );

  return (
    <section
      aria-label={t("compareTitle")}
      className={cn("rounded-xl border border-gold/25 bg-gold/5 p-4", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          {t("compareTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {nights && nights > 0 ? t("forNights", { count: nights }) : t("perNight")}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-border/70 text-sm">
        <li className="flex items-center justify-between gap-3 pb-2 font-semibold text-foreground">
          <span>{t("directLabel")}</span>
          <span>{money(directTotal)}</span>
        </li>
        {rows.map((row) => (
          <li key={row.platform} className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              {showLinks && row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                  className="inline-flex items-center gap-1 transition hover:text-foreground"
                  aria-label={t("viewListing", { platform: PLATFORM_NAMES[row.platform] })}
                >
                  {PLATFORM_NAMES[row.platform]}
                  <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              ) : (
                PLATFORM_NAMES[row.platform]
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {row.savings > 0 ? (
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
                  {t("save", { amount: money(row.savings) })}
                </span>
              ) : null}
              <span className="tabular-nums text-muted-foreground">{money(row.total)}</span>
            </span>
          </li>
        ))}
      </ul>
      {bestSavings > 0 ? (
        <p className="mt-2 rounded-lg bg-gold/10 px-3 py-2 text-sm font-semibold text-foreground">
          {t("youSave", { amount: money(bestSavings) })}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {t("ratesChecked", { date: checkedAt })}
      </p>
    </section>
  );
}
