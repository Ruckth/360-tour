"use client";

import { useTranslations } from "next-intl";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Card } from "@/components/ui/card";
import type { BookingProperty } from "@/lib/booking/booking";
import { resort } from "@/lib/data/resort-config";

export function BookingPriceSummary({
  property,
  nights,
  subtotal,
  discount,
  total,
}: {
  property: BookingProperty;
  nights: number;
  subtotal: number;
  discount: number;
  total: number;
}) {
  const t = useTranslations("Booking");
  const villaT = useTranslations("Villa");
  return (
    <Card className="h-fit min-w-0 p-5 shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
        <PropertyImage
          images={property.images}
          alt={property.name}
          sizes="(min-width: 1024px) 360px, 100vw"
        />
      </div>
      <h2 className="mt-4 font-serif text-2xl font-semibold text-foreground">
        {property.name}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{property.tagline}</p>
      <div className="mt-4 space-y-2 text-sm text-muted-foreground">
        <div className="flex justify-between">
          <span>
            {resort.currencySymbol}
            {property.pricePerNight.toLocaleString()} {villaT("perNight")} x {nights || 0}
          </span>
          <span>{resort.currencySymbol}{subtotal.toLocaleString()}</span>
        </div>
        {discount > 0 ? (
          <div className="flex justify-between text-gold">
            <span>{t("discount")}</span>
            <span>-{resort.currencySymbol}{discount.toLocaleString()}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-border pt-3 text-base font-semibold text-foreground">
          <span>{t("total")}</span>
          <span>{resort.currencySymbol}{total.toLocaleString()}</span>
        </div>
      </div>
    </Card>
  );
}
