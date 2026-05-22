"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getLocalizedPricingByPropertyId } from "@/lib/i18n/public-content";

export function DirectBookingBenefits({ propertyId }: { propertyId: string }) {
  const t = useTranslations("Villa");
  const locale = useLocale();
  const pricing = getLocalizedPricingByPropertyId(propertyId, locale);
  if (!pricing) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold text-foreground">{t("directBenefits")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {pricing.directBenefits.map((item) => (
          <div key={item.benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-gold" />
            {item.benefit}
          </div>
        ))}
      </div>
    </section>
  );
}
