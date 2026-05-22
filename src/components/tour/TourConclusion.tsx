"use client";

import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/data/properties";
import { localizeHref } from "@/i18n/routing";
import { getLocalizedTourConclusion } from "@/lib/i18n/public-content";

export function TourConclusion({
  property,
  onClose,
  onLead,
}: {
  property: Property;
  onClose: () => void;
  onLead: () => void;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const conclusion = getLocalizedTourConclusion(property.id, locale);
  if (!conclusion) return null;

  function book() {
    const params = new URLSearchParams({ unit: property.id });
    router.push(localizeHref(`/booking?${params.toString()}`, locale));
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 px-5 py-10 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="fixed right-4 top-4 z-40 h-11 w-11 rounded-full bg-white/15 text-white shadow-lg shadow-black/30 backdrop-blur-md hover:bg-white/25 hover:text-white md:right-6 md:top-6"
        aria-label={t("backToTour")}
      >
        <X className="h-5 w-5" />
      </Button>
      <div className="mx-auto w-full max-w-lg">
        <div className="relative overflow-hidden rounded-2xl">
          <PropertyImage
            images={property.images}
            alt={property.name}
            className="aspect-[16/10]"
            sizes="(min-width: 768px) 560px, 100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
            <p className="text-xs font-medium uppercase tracking-widest text-white/60">
              {property.name}
            </p>
            <h2 className="mt-1 font-serif text-3xl font-semibold text-white md:text-4xl">
              {conclusion.headline}
            </h2>
          </div>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-white/80 md:text-base">
          {conclusion.summary}
        </p>
        <ul className="mt-5 space-y-2.5">
          {conclusion.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-3 text-sm text-white/90 md:text-base">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
              {highlight}
            </li>
          ))}
        </ul>
        <Button
          variant="gold"
          className="mt-6 w-full rounded-2xl py-3.5"
          onClick={book}
        >
          {navT("book")}
        </Button>
        <div className="mt-3 text-center">
          <button
            type="button"
            className="text-sm text-white/50 transition hover:text-white/80"
            onClick={onLead}
          >
            {t("saveThisDream")}
          </button>
        </div>
        <p className="mt-6 text-center font-serif text-sm italic text-white/40">
          {conclusion.closingLine}
        </p>
      </div>
    </div>
  );
}
