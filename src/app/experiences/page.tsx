import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRight, Car, Check, Heart, Utensils, Waves } from "lucide-react";
import { getLocale } from "next-intl/server";
import { ButtonLink } from "@/components/ui/button";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import {
  experienceHeroImage,
  experienceItems,
  experienceSteps,
} from "@/lib/data/experiences";
import {
  getLocalizedResort,
  getPublicMessages,
} from "@/lib/i18n/public-content";

const experienceIcons = {
  car: Car,
  heart: Heart,
  utensils: Utensils,
  waves: Waves,
};

function getPageLocale(locale: string) {
  return isLocale(locale) ? locale : defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const activeLocale = await getLocale();
  const locale = getPageLocale(activeLocale);
  const resort = getLocalizedResort(locale);
  const seo = getPublicMessages(locale).SEO;

  return {
    title: seo.experiencesTitle,
    description: seo.experiencesDescription,
    openGraph: {
      type: "website",
      siteName: resort.name,
      title: seo.experiencesOgTitle,
      description: seo.experiencesDescription,
      images: [experienceHeroImage],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.experiencesOgTitle,
      description: seo.experiencesDescription,
      images: [experienceHeroImage],
    },
  };
}

export default async function ExperiencesPage() {
  const activeLocale = await getLocale();
  const locale = getPageLocale(activeLocale);
  const resort = getLocalizedResort(locale);
  const messages = getPublicMessages(locale).Experiences;

  return (
    <>
      <section className="relative overflow-hidden bg-navy pt-24 text-white md:pt-28">
        <Image
          src={experienceHeroImage}
          alt={messages.heroAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy/90 via-navy/60 to-navy/10" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="relative mx-auto flex min-h-[620px] max-w-7xl items-end px-5 pb-14 md:min-h-[690px] md:px-8 md:pb-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-light md:text-sm">
              {messages.eyebrow}
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight text-white md:text-6xl lg:text-7xl">
              {messages.title}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">
              {messages.intro}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink
                href={localizeHref("/booking", locale)}
                variant="gold"
                size="lg"
                className="w-full sm:w-auto"
              >
                {messages.primaryCta}
                <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink
                href={localizeHref("/#contact", locale)}
                variant="glass"
                size="lg"
                className="w-full sm:w-auto"
              >
                {messages.secondaryCta}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
              {messages.collectionEyebrow}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
              {messages.collectionTitle}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {messages.collectionIntro}
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:mt-16 lg:grid-cols-2 lg:gap-8">
            {experienceItems.map((item) => {
              const Icon = experienceIcons[item.icon];
              const content = messages.items[item.id];

              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition hover:shadow-md"
                >
                  <div className="relative aspect-[16/10] bg-muted">
                    <Image
                      src={item.image}
                      alt={content.alt}
                      fill
                      sizes="(min-width: 1024px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="p-5 md:p-7">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-gold/10 text-gold">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-serif text-2xl font-semibold text-foreground md:text-3xl">
                      {content.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                      {content.description}
                    </p>
                    <ul className="mt-5 space-y-3">
                      {content.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex gap-3 text-sm text-foreground"
                        >
                          <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-muted/40 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
                {messages.conciergeEyebrow}
              </p>
              <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl">
                {messages.conciergeTitle}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
                {messages.conciergeIntro}
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {experienceSteps.map((step, index) => {
                const content = messages.steps[step.id];

                return (
                  <div key={step.id} className="border-l border-border pl-5">
                    <p className="font-serif text-4xl font-semibold text-gold">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-4 text-base font-semibold text-foreground">
                      {content.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {content.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-5 text-center md:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">
            {messages.ctaEyebrow}
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
            {messages.ctaTitle.replace("{resortName}", resort.name)}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            {messages.ctaCopy}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <ButtonLink
              href={localizeHref("/booking", locale)}
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
            >
              {messages.primaryCta}
            </ButtonLink>
            <ButtonLink
              href={localizeHref("/#contact", locale)}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
            >
              {messages.secondaryCta}
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
