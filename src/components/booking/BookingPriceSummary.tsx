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
      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground lg:mt-4 lg:space-y-2 lg:text-sm">
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
        <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold text-foreground lg:pt-3 lg:text-base">
          <span>{t("total")}</span>
          <span>{resort.currencySymbol}{total.toLocaleString()}</span>
        </div>
      </div>
    </Card>
  );
}
