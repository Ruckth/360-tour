import { BadgeCheck, CreditCard, ShieldCheck } from "lucide-react";

export function TrustBadges() {
  const badges = [
    { label: "Verified villas", icon: BadgeCheck },
    { label: "Secure demo checkout", icon: CreditCard },
    { label: "Host direct support", icon: ShieldCheck },
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
