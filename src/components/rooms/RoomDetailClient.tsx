"use client";

import Link from "@/platform/link";
import { useHydrated } from "@/platform/hydration";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { ChevronLeft, ChevronRight, Globe2, Users } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { MobileStickyBar } from "@/components/booking/MobileStickyBar";
import { useChatPageContext } from "@/components/chat/ChatContext";
import { PropertyImage } from "@/components/property/PropertyImage";
import { RoomTourViewer } from "@/components/rooms/RoomTourViewer";
import { DirectBookingBenefits } from "@/components/pricing/DirectBookingBenefits";
import { PriceComparison } from "@/components/pricing/PriceComparison";
import { ReviewCarousel } from "@/components/social/ReviewCarousel";
import { StarRating } from "@/components/social/StarRating";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import type { Review } from "@/lib/data/reviews";
import { getLocalizedResort } from "@/lib/i18n/public-content";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import type { PublicVilla } from "@/lib/villas";
import { cn } from "@/lib/utils";
import { useTourOpener } from "@/lib/interaction/use-modal-focus";
import { markTourBench } from "@/lib/tour/bench";
import { preloadTourRenderer } from "@/lib/tour/preload";
import type { TourRenderer } from "@/lib/tour/renderer";
import { useTourOpenTiming } from "@/lib/tour/use-tour-open-timing";

export function RoomDetailClient({ property, reviews, renderer = "three" }: {
  property: PublicVilla;
  reviews: Review[];
  renderer?: TourRenderer;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const locale = useLocale();
  const navT = useTranslations("Nav");
  const t = useTranslations("Villa");
  const a11y = useTranslations("A11y");
  const searchParams = useSearchParams();
  const [galleryIndex, setGalleryIndex] = useState(0);
  // The tour follows ?tour=1 whenever the URL changes; openTour/closeTour also set it right away.
  const [directOnMount] = useState(() => searchParams.get("tour") === "1");
  const [showTour, setShowTour] = useState(directOnMount);
  const rememberTourOpener = useTourOpener(showTour);
  const { begin, cancel, finish } = useTourOpenTiming(directOnMount);
  // Behind a direct tour, start the gallery photo after the current panorama draws or the guest closes.
  // The ordinary room page still advertises the photo immediately.
  const [galleryStart, setGalleryStart] = useState<"waiting" | "covered" | "visible">(showTour ? "waiting" : "visible");
  const requestCoveredGallery = useCallback(() => {
    setGalleryStart((current) => current === "waiting" ? "covered" : current);
  }, []);
  const [tourParams, setTourParams] = useState(searchParams);
  if (tourParams !== searchParams) {
    setTourParams(searchParams);
    if (galleryStart === "waiting" && searchParams.get("tour") !== "1") setGalleryStart("visible");
    setShowTour(searchParams.get("tour") === "1");
  }
  const chatContext = useChatPageContext();
  const setChatContext = chatContext?.setContext;
  const clearChatContext = chatContext?.clearContext;
  const resort = getLocalizedResort(usePublicMessages());
  const images = property.images.length ? property.images : [resort.heroImage];

  useEffect(() => { if (!showTour) cancel(); }, [cancel, showTour]);

  useEffect(() => {
    markTourBench("room_hydrated");
  }, []);

  useEffect(() => {
    setChatContext?.({
      propertySlug: property.id,
      propertyName: property.name,
    });
    return () => clearChatContext?.();
  }, [clearChatContext, property.id, property.name, setChatContext]);

  const roomPath = `/rooms/${property.id}`;
  const isTrial = renderer === "pannellum";
  const standardTourHref = localizeHref(`${roomPath}?tour=1`, locale);
  const tourHref = isTrial ? `${standardTourHref}&tourRenderer=pannellum` : standardTourHref;
  const closeHref = localizeHref(isTrial ? `${roomPath}?tourRenderer=pannellum` : roomPath, locale);
  const preloadViewer = () => preloadTourRenderer(renderer);

  function openTour(event: MouseEvent<HTMLButtonElement>) {
    rememberTourOpener(event.currentTarget);
    begin();
    markTourBench("tour_open_requested");
    setShowTour(true);
    router.replace(tourHref, { scroll: false });
  }

  function closeTour() {
    cancel();
    if (galleryStart === "waiting") setGalleryStart("visible");
    setShowTour(false);
    router.replace(closeHref, { scroll: false });
  }

  function goTo(next: number) {
    setGalleryIndex(Math.max(0, Math.min(images.length - 1, next)));
  }

  const isFirstPhoto = galleryIndex === 0;
  const isLastPhoto = galleryIndex >= images.length - 1;

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
              {galleryStart !== "waiting" ? (
                <PropertyImage
                  src={images[galleryIndex]}
                  fallbackImages={images}
                  alt={`${property.name} photo ${galleryIndex + 1}`}
                  priority
                  occluded={galleryStart === "covered" && galleryIndex === 0}
                  sizes="(min-width: 1024px) 760px, 100vw"
                />
              ) : null}
              <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/65 to-transparent" />
              {images.length > 1 ? (
                <div
                  data-testid="room-gallery-counter"
                  aria-live="polite"
                  className="absolute bottom-4 left-4 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-sm"
                >
                  {galleryIndex + 1} / {images.length}
                </div>
              ) : null}
              <button
                type="button"
                disabled={!hydrated}
                aria-haspopup="dialog"
                onClick={openTour}
                onFocus={preloadViewer}
                onPointerEnter={preloadViewer}
                onTouchStart={preloadViewer}
                className="absolute bottom-4 right-4 hidden items-center gap-2 rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-navy shadow-lg backdrop-blur-sm md:inline-flex"
              >
                <Globe2 className="h-4 w-4" />
                {t("explore360")}
              </button>
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-disabled={isFirstPhoto}
                    onClick={() => {
                      if (!isFirstPhoto) goTo(galleryIndex - 1);
                    }}
                    className={cn(
                      "absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isFirstPhoto && "cursor-not-allowed opacity-40",
                    )}
                    aria-label={t("previousPhoto")}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-disabled={isLastPhoto}
                    onClick={() => {
                      if (!isLastPhoto) goTo(galleryIndex + 1);
                    }}
                    className={cn(
                      "absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isLastPhoto && "cursor-not-allowed opacity-40",
                    )}
                    aria-label={t("nextPhoto")}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>

            {images.length > 1 ? (
              <div
                data-testid="room-gallery-thumbnails"
                role="group"
                aria-label={a11y("galleryThumbnails")}
                className="mt-3 flex gap-2 overflow-x-auto pb-1"
              >
                {images.map((src, idx) => {
                  const selected = idx === galleryIndex;
                  return (
                    <button
                      key={`${src}-${idx}`}
                      type="button"
                      onClick={() => goTo(idx)}
                      aria-label={a11y("showPhoto", { index: idx + 1 })}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-muted transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        selected ? "border-gold ring-2 ring-gold/40" : "border-transparent opacity-75 hover:opacity-100",
                      )}
                    >
                      <PropertyImage
                        src={src}
                        fallbackImages={images}
                        alt=""
                        sizes="80px"
                      />
                    </button>
                  );
                })}
              </div>
            ) : null}

            <Button
              variant="outline"
              className="mt-3 w-full bg-card py-3 md:hidden"
              disabled={!hydrated}
              aria-haspopup="dialog"
              onClick={openTour}
              onFocus={preloadViewer}
              onPointerEnter={preloadViewer}
              onTouchStart={preloadViewer}
            >
              <Globe2 className="h-4 w-4" />
              {t("exploreIn360")}
            </Button>

            <div className="mt-5 md:mt-8">
              <h1 className="font-serif text-3xl font-semibold text-foreground md:text-4xl">
                {property.name}
              </h1>
              {property.rating ? (
                <div className="mt-2">
                  <StarRating
                    rating={property.rating.average}
                    size="md"
                    showValue
                    reviewCount={property.rating.count}
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

            <DirectBookingBenefits />

            {reviews.length > 0 ? (
              <section className="mt-10">
                <h2 className="text-lg font-semibold text-foreground">{t("whatGuestsSay")}</h2>
                <div className="mt-4">
                  <ReviewCarousel reviews={reviews} />
                </div>
              </section>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-24 lg:self-start">
            <PriceComparison
              property={property}
              onOpen360={openTour}
              onPreload360={preloadViewer}
            />
          </div>
        </div>
      </div>

      <MobileStickyBar
        propertyId={property.id}
        pricePerNight={property.pricePerNight}
        directDiscountPercent={property.directDiscountPercent}
        currency={property.currency}
      />
      {showTour ? (
        <RoomTourViewer
          key={renderer}
          renderer={renderer}
          property={property}
          onClose={closeTour}
          onReady={finish}
          onFirstSceneDrawn={galleryStart === "waiting" ? requestCoveredGallery : undefined}
          closeHref={closeHref}
          standardTourHref={standardTourHref}
        />
      ) : null}
    </div>
  );
}
