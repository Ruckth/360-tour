"use client";

import { ChevronLeft, ChevronRight, Globe2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { PropertyImage } from "@/components/property/PropertyImage";
import { StarRating } from "@/components/social/StarRating";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { resort } from "@/lib/data/resort-config";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import type { Property } from "@/lib/data/properties";
import type { PropertySocialProof } from "@/lib/data/reviews";
import { clampIndex, isHorizontalSwipe, swipeDirection, type SwipePoint } from "@/lib/interaction/swipe";
import { cn } from "@/lib/utils";

export function VillaCard({
  property,
  socialProof,
  storyTagline,
}: {
  property: Property;
  socialProof?: PropertySocialProof;
  storyTagline?: string;
}) {
  const t = useTranslations("Villa");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const [index, setIndex] = useState(0);
  const [dragStart, setDragStart] = useState<SwipePoint | null>(null);
  const images = property.images.length ? property.images : [resort.heroImage];
  const hasMultiple = images.length > 1;

  function goTo(next: number) {
    setIndex(clampIndex(next, images.length));
  }

  function completeSwipe(clientX: number, clientY: number) {
    if (!dragStart || !hasMultiple) return;
    const end = { x: clientX, y: clientY };
    if (isHorizontalSwipe(dragStart, end, 36)) {
      goTo(index + swipeDirection(dragStart, end));
    }
    setDragStart(null);
  }

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <div
          className="flex h-full select-none transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)`, touchAction: "pan-y" }}
          onPointerDown={(event) => setDragStart({ x: event.clientX, y: event.clientY })}
          onPointerUp={(event) => completeSwipe(event.clientX, event.clientY)}
          onPointerCancel={() => setDragStart(null)}
        >
          {images.map((src, imageIndex) => (
            <div key={src} className="relative h-full w-full flex-shrink-0">
              <PropertyImage
                src={src}
                fallbackImages={images}
                alt={`${property.name} photo ${imageIndex + 1}`}
                imgClassName="transition-transform duration-700 group-hover:scale-105"
                sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
        <div className="absolute bottom-3 right-3 rounded-full bg-navy/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm md:text-sm">
          {resort.currencySymbol}
          {property.pricePerNight.toLocaleString()}
          <span className="text-[10px] font-normal text-white/60 md:text-xs">
            {t("perNight")}
          </span>
        </div>

        {hasMultiple ? (
          <>
            <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
              {images.map((src, dotIndex) => (
                <button
                  key={`${src}-${dotIndex}`}
                  type="button"
                  onClick={() => goTo(dotIndex)}
                  aria-current={index === dotIndex ? "true" : undefined}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    index === dotIndex ? "w-6 bg-white" : "w-2 bg-white/45 hover:bg-white/70",
                  )}
                  aria-label={`Show photo ${dotIndex + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-lg transition hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 md:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-lg transition hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 md:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      <div className="p-5 md:p-7">
        <h3 className="font-serif text-xl font-semibold text-card-foreground md:text-2xl">
          {property.name}
        </h3>
        {socialProof ? (
          <div className="mt-1.5">
            <StarRating
              rating={socialProof.overallRating}
              size="sm"
              showValue
              reviewCount={socialProof.totalReviews}
            />
          </div>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">{property.tagline}</p>
        {storyTagline ? (
          <p className="mt-2 font-serif text-sm italic text-muted-foreground/70">
            {storyTagline}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="gold">
            <Users className="h-4 w-4" />
            {t("guests", { count: property.maxGuests })}
          </Badge>
          <Badge variant="gold">
            {t("bedroomsShort", { count: property.bedrooms })}
          </Badge>
          <Badge variant="gold">
            {t("bathroomsShort", { count: property.bathrooms })}
          </Badge>
          <Badge variant="gold">
            {property.area} m²
          </Badge>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={localizeHref(`/rooms/${property.id}?tour=1`, locale)} className="w-full sm:flex-1">
            <Globe2 className="h-4 w-4" />
            {t("explore360")}
          </ButtonLink>
          <ButtonLink
            href={localizeHref(`/rooms/${property.id}`, locale)}
            variant="outline"
            className="w-full sm:flex-1"
          >
            {t("viewDetails")}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
