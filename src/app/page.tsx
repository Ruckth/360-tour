import Image from "next/image";
import { Anchor, Bell, Car, Check, Heart, Sparkles, Sun, Utensils, Waves } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeQuickBooking } from "@/components/home/HomeQuickBooking";
import { VillaCard } from "@/components/home/VillaCard";
import { ReviewCarousel } from "@/components/social/ReviewCarousel";
import { ButtonLink } from "@/components/ui/button";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { buildEmailHref } from "@/lib/contact-links";
import {
  getLocalizedProperties,
  getLocalizedPropertyTagline,
  getLocalizedResort,
  getLocalizedSocialProofByPropertyId,
  getLocationBullets,
  getLocationImageAlt,
} from "@/lib/i18n/public-content";

const amenityIcons = {
  waves: Waves,
  sparkles: Sparkles,
  utensils: Utensils,
  car: Car,
  bell: Bell,
  sun: Sun,
  heart: Heart,
  anchor: Anchor,
};

export default async function HomePage() {
  const t = await getTranslations("Home");
  const nav = await getTranslations("Nav");
  const activeLocale = await getLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const resort = getLocalizedResort(locale);
  const properties = getLocalizedProperties(locale);
  const reviews = properties
    .flatMap((property) => getLocalizedSocialProofByPropertyId(property.id, locale)?.reviews ?? [])
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);
  const villaItems = properties.map((property) => ({
    property,
    socialProof: getLocalizedSocialProofByPropertyId(property.id, locale),
    storyTagline: getLocalizedPropertyTagline(property.id, locale),
  }));
  const locationBullets = getLocationBullets(locale);

  return (
    <>
      <HomeHero />
      <HomeQuickBooking />

      <section id="about" className="pb-20 pt-8 md:pb-28 md:pt-12">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              {t("welcome")}
            </p>
            <h1 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              {t("sanctuaryTitle")}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:mt-6 md:text-base">
              {resort.description}
            </p>
          </div>
          <div className="mt-14 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
            {resort.highlights.map((highlight) => (
              <div key={highlight.label} className="text-center">
                <p className="font-serif text-3xl font-semibold text-foreground md:text-4xl">
                  {highlight.stat}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground md:text-sm">
                  {highlight.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="villas" className="bg-muted/40 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mb-12 text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              {t("accommodations")}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              {t("ourVillas")}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              {t("villasIntro")}
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 md:gap-8 lg:gap-10 2xl:grid-cols-3">
            {villaItems.map(({ property, socialProof, storyTagline }) => (
              <VillaCard
                key={property.id}
                property={property}
                socialProof={socialProof}
                storyTagline={storyTagline}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="amenities" className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              {t("experience")}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              {t("amenitiesTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              {t("amenitiesIntro")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {resort.amenities.map((amenity) => {
              const Icon = amenityIcons[amenity.icon as keyof typeof amenityIcons] ?? Sparkles;
              return (
                <div
                  key={amenity.name}
                  className="rounded-xl border border-border bg-card p-5 text-center transition hover:shadow-md md:p-6"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
                    <Icon className="h-5 w-5 text-gold" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {amenity.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="reviews" className="bg-muted/40 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              {t("testimonials")}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              {t("reviewsTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
              {t("reviewsIntro", { resortName: resort.name })}
            </p>
          </div>
          <ReviewCarousel reviews={reviews} />
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
                {t("location")}
              </p>
              <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl">
                {resort.location}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
                {t("locationCopy", { resortName: resort.name })}
              </p>
              <ul className="mt-6 space-y-3">
                {locationBullets.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-foreground">
                    <Check className="h-4 w-4 flex-shrink-0 text-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-muted shadow-sm md:hidden">
              <iframe
                title={`${resort.name} Google Map, Lipa Noi, Ko Samui District, Surat Thani`}
                src="https://www.google.com/maps?q=9.499354,99.997034&z=15&output=embed"
                className="h-[320px] w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
            <div className="relative hidden min-h-[320px] overflow-hidden rounded-2xl md:block">
              <Image
                src="https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=600&fit=crop"
                alt={getLocationImageAlt(locale)}
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="bg-navy py-20 text-white dark:bg-card md:py-28">
        <div className="mx-auto max-w-3xl px-5 text-center md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">
            {t("beginStay")}
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold text-white md:text-4xl lg:text-5xl">
            {t("readyTitle", { resortName: resort.name })}
          </h2>
          <p className="mt-4 text-sm text-white/70 md:text-lg">
            {t("readyCopy")}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center md:mt-10 md:gap-4">
            <ButtonLink href={localizeHref("/booking", locale)} variant="gold" className="w-full sm:w-auto">
              {nav("book")}
            </ButtonLink>
            <a
              href={buildEmailHref(resort.contactEmail)}
              className="inline-flex w-full items-center justify-center rounded-lg border border-white/25 px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
            >
              {t("contactUs")}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
