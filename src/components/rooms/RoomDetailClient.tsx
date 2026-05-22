"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Globe2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MobileStickyBar } from "@/components/booking/MobileStickyBar";
import { useChatPageContext } from "@/components/chat/ChatContext";
import { PropertyImage } from "@/components/property/PropertyImage";
import { DirectBookingBenefits } from "@/components/pricing/DirectBookingBenefits";
import { PriceComparison } from "@/components/pricing/PriceComparison";
import { ReviewCarousel } from "@/components/social/ReviewCarousel";
import { StarRating } from "@/components/social/StarRating";
import { TrustBadges } from "@/components/trust/TrustBadges";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import type { Property } from "@/lib/data/properties";
import {
  getLocalizedResort,
  getLocalizedSocialProofByPropertyId,
} from "@/lib/i18n/public-content";

const TourViewer = dynamic(
  () => import("@/components/tour/TourViewer").then((mod) => mod.TourViewer),
  { ssr: false },
);

export function RoomDetailClient({ property }: { property: Property }) {
  const router = useRouter();
  const locale = useLocale();
  const navT = useTranslations("Nav");
  const t = useTranslations("Villa");
  const searchParams = useSearchParams();
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const chatContext = useChatPageContext();
  const setChatContext = chatContext?.setContext;
  const clearChatContext = chatContext?.clearContext;
  const resort = getLocalizedResort(locale);
  const socialProof = getLocalizedSocialProofByPropertyId(property.id, locale);
  const images = property.images.length ? property.images : [resort.heroImage];

  useEffect(() => {
    setShowTour(searchParams.get("tour") === "1");
  }, [searchParams]);

  useEffect(() => {
    setChatContext?.({
      propertySlug: property.id,
      propertyName: property.name,
    });
    return () => clearChatContext?.();
  }, [clearChatContext, property.id, property.name, setChatContext]);

  function openTour() {
    setShowTour(true);
    router.replace(localizeHref(`/rooms/${property.id}?tour=1`, locale), { scroll: false });
  }

  function closeTour() {
    setShowTour(false);
    router.replace(localizeHref(`/rooms/${property.id}`, locale), { scroll: false });
  }

  function goTo(next: number) {
    setGalleryIndex(Math.max(0, Math.min(images.length - 1, next)));
  }

  return (
    <div className="pb-32 md:pb-0">
      <div className="mx-auto max-w-6xl px-4 pt-20 md:px-6 md:pt-24">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground md:text-sm">
          <Link href={localizeHref("/", locale)} className="transition hover:text-foreground">
            {resort.name}
          </Link>
          <span className="text-border">/</span>
          <Link href={localizeHref("/#villas", locale)} className="transition hover:text-foreground">
            {t("ourVillas")}
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">{property.name}</span>
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
        <div className="grid gap-6 md:gap-10 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
              <PropertyImage
                src={images[galleryIndex]}
                fallbackImages={images}
                alt={`${property.name} photo ${galleryIndex + 1}`}
                priority
                sizes="(min-width: 1024px) 760px, 100vw"
              />
              <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/65 to-transparent" />
              <button
                type="button"
                onClick={openTour}
                className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-navy shadow-lg backdrop-blur-sm"
              >
                <Globe2 className="h-4 w-4" />
                {t("explore360")}
              </button>
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => goTo(galleryIndex - 1)}
                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg"
                    aria-label={t("previousPhoto")}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(galleryIndex + 1)}
                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg"
                    aria-label={t("nextPhoto")}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>

            <Button variant="outline" className="mt-3 w-full bg-card py-3 md:mt-4" onClick={openTour}>
              <Globe2 className="h-4 w-4" />
              {t("exploreIn360")}
            </Button>

            <div className="mt-5 md:mt-8">
              <h1 className="font-serif text-3xl font-semibold text-foreground md:text-4xl">
                {property.name}
              </h1>
              {socialProof ? (
                <div className="mt-2">
                  <StarRating
                    rating={socialProof.overallRating}
                    size="md"
                    showValue
                    reviewCount={socialProof.totalReviews}
                  />
                </div>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground md:text-lg">
                {property.tagline}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 md:mt-6 md:gap-3">
                <span className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:px-3 md:py-1.5 md:text-sm">
                  <Users className="h-4 w-4" />
                  {t("guests", { count: property.maxGuests })}
                </span>
                <span className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:px-3 md:py-1.5 md:text-sm">
                  {t("bedrooms", { count: property.bedrooms })}
                </span>
                <span className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:px-3 md:py-1.5 md:text-sm">
                  {t("bathrooms", { count: property.bathrooms })}
                </span>
                <span className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:px-3 md:py-1.5 md:text-sm">
                  {property.area} m²
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:mt-6 md:text-base">
                {property.description}
              </p>
            </div>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-foreground">{navT("amenities")}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {property.amenities.map((amenity) => (
                  <div key={amenity} className="text-sm text-muted-foreground">
                    {amenity}
                  </div>
                ))}
              </div>
            </section>

            <DirectBookingBenefits propertyId={property.id} />

            <div className="mt-8">
              <TrustBadges />
            </div>

            {socialProof && socialProof.reviews.length > 0 ? (
              <section className="mt-10">
                <h2 className="text-lg font-semibold text-foreground">{t("whatGuestsSay")}</h2>
                <div className="mt-4">
                  <ReviewCarousel reviews={socialProof.reviews} />
                </div>
              </section>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-24 lg:self-start">
            <PriceComparison propertyId={property.id} onOpen360={openTour} />
          </div>
        </div>
      </div>

      <MobileStickyBar propertyId={property.id} />
      {showTour ? <TourViewer property={property} onClose={closeTour} /> : null}
    </div>
  );
}
