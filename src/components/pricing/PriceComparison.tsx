"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { getMaxSavingsForProperty } from "@/lib/data/pricing";
import { resort } from "@/lib/data/resort-config";
import { getLocalizedPricingByPropertyId } from "@/lib/i18n/public-content";

export function PriceComparison({
  propertyId,
  onOpen360,
}: {
  propertyId: string;
  onOpen360?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("Villa");
  const pricing = getLocalizedPricingByPropertyId(propertyId, locale);
  if (!pricing) return null;
  const savings = getMaxSavingsForProperty(propertyId, 3);

  return (
    <aside className="rounded-2xl border border-border bg-card p-5 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            {t("directRate")}
          </p>
          <p className="mt-1 text-3xl font-bold text-foreground">
            {resort.currencySymbol}
            {pricing.directRate.toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground">{t("perNightWords")}</p>
        </div>
        <div className="rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
          {t("saveAmount", { amount: savings.toLocaleString() })}
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {pricing.directBenefits.slice(0, 5).map((benefit) => (
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
        <a
          href={localizeHref(`/booking?unit=${propertyId}`, locale)}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {t("bookDirect")}
        </a>
        {onOpen360 ? (
          <Button variant="outline" onClick={onOpen360} className="w-full">
            {t("explore360First")}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
