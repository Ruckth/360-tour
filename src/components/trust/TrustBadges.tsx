"use client";

import { BadgeCheck, CreditCard, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

export function TrustBadges() {
  const t = useTranslations("Villa");
  const badges = [
    { label: t("verifiedVillas"), icon: BadgeCheck },
    { label: t("secureCheckout"), icon: CreditCard },
    { label: t("hostSupport"), icon: ShieldCheck },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <div
            key={badge.label}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground"
          >
            <Icon className="h-4 w-4 text-gold" />
            {badge.label}
          </div>
        );
      })}
    </div>
  );
}
