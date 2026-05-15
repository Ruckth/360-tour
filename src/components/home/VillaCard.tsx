"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Globe2, Users } from "lucide-react";
import { useState } from "react";
import { StarRating } from "@/components/social/StarRating";
import { ButtonLink } from "@/components/ui/Button";
import { resort } from "@/lib/data/resort-config";
import type { Property } from "@/lib/data/properties";
import type { PropertySocialProof } from "@/lib/data/reviews";
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
  const [index, setIndex] = useState(0);
  const images = property.images.length ? property.images : [resort.heroImage];
  const hasMultiple = images.length > 1;

  function goTo(next: number) {
    setIndex(Math.max(0, Math.min(images.length - 1, next)));
  }

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <div
          className="flex h-full transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {images.map((src, imageIndex) => (
            <div key={src} className="relative h-full w-full flex-shrink-0">
              <Image
                src={src}
                alt={`${property.name} photo ${imageIndex + 1}`}
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
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
            /night
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
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white">
            <Users className="h-4 w-4" />
            {property.maxGuests} guests
          </span>
          <span className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white">
            {property.bedrooms} bed{property.bedrooms > 1 ? "s" : ""}
          </span>
          <span className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white">
            {property.bathrooms} bath{property.bathrooms > 1 ? "s" : ""}
          </span>
          <span className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white">
            {property.area} m²
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={`/rooms/${property.id}?tour=1`} className="w-full sm:flex-1">
            <Globe2 className="h-4 w-4" />
            Explore 360
          </ButtonLink>
          <Link
            href={`/rooms/${property.id}`}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted sm:flex-1"
          >
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}
