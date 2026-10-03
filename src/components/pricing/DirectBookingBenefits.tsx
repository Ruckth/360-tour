"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { getLocalizedDirectBenefits } from "@/lib/i18n/public-content";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";

export function DirectBookingBenefits() {
  const t = useTranslations("Villa");
  const benefits = getLocalizedDirectBenefits(usePublicMessages());

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold text-foreground">{t("directBenefits")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {benefits.map((item) => (
          <div key={item.benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-gold" />
            {item.benefit}
          </div>
        ))}
      </div>
    </section>
  );
}
