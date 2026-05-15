import { Check } from "lucide-react";
import { getPricingByPropertyId } from "@/lib/data/pricing";

export function DirectBookingBenefits({ propertyId }: { propertyId: string }) {
  const pricing = getPricingByPropertyId(propertyId);
  if (!pricing) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold text-foreground">Direct booking benefits</h2>
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
