import Image from "@/platform/image";
import { ArrowRight, Car, Check, ChevronRight, Heart, Mail, Utensils, Waves, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { localizeHref, type Locale } from "@/i18n/routing";
import { experienceHeroImage, experienceItems, experienceSteps } from "@/lib/data/experiences";
import { getLocalizedResort, type PublicMessages } from "@/lib/i18n/public-content";

const experienceIcons = {
  car: Car,
  heart: Heart,
  utensils: Utensils,
  waves: Waves,
};

/** Localized experience listings and concierge entry points. */
export function ExperiencesView({
  locale,
  publicMessages,
}: {
  locale: Locale;
  publicMessages: PublicMessages;
}) {
  const messages = publicMessages.Experiences;
  const resort = getLocalizedResort(publicMessages);

  return (
    <>
      <section className="relative overflow-hidden bg-navy pt-16 text-white md:pt-28">
        <Image
          src={experienceHeroImage}
          alt={messages.heroAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy/90 via-navy/60 to-navy/10" />
        <div className="absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-background to-transparent md:h-40" />

        <div className="relative mx-auto flex min-h-[248px] max-w-7xl items-end px-5 pb-6 md:min-h-[690px] md:px-8 md:pb-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-light md:text-sm">
              {messages.eyebrow}
            </p>
            <h1 className="mt-2 font-serif text-[2rem] font-semibold leading-tight text-white md:mt-4 md:text-6xl lg:text-7xl">
              {messages.title}
            </h1>
            <p className="mt-6 hidden max-w-2xl text-lg leading-relaxed text-white/90 md:block">
              {messages.intro}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 md:mt-8 md:flex md:gap-3">
              <ButtonLink
                href={localizeHref("/booking", locale)}
                variant="gold"
                size="lg"
                className="h-auto min-h-11 w-full whitespace-normal px-3 py-1.5 text-center leading-tight md:h-12 md:w-auto md:whitespace-nowrap md:px-6"
              >
                {messages.primaryCta}
                <ArrowRight className="hidden h-4 w-4 md:block" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink
                href={localizeHref("/chat", locale)}
                variant="glass"
                size="lg"
                className="h-auto min-h-11 w-full whitespace-normal px-3 py-1.5 text-center leading-tight md:h-12 md:w-auto md:whitespace-nowrap md:px-6"
              >
                {messages.secondaryCta}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="experience-collection" className="py-6 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="hidden font-semibold uppercase tracking-[0.25em] text-gold md:block md:text-sm">
              {messages.collectionEyebrow}
            </p>
            <h2 id="experience-collection" className="text-left font-serif text-2xl font-semibold text-foreground md:mt-3 md:text-center md:text-4xl lg:text-5xl">
              <span className="md:hidden">{messages.collectionEyebrow}</span>
              <span className="hidden md:inline">{messages.collectionTitle}</span>
            </h2>
            <p className="mx-auto mt-4 hidden max-w-2xl leading-relaxed text-muted-foreground md:block">
              {messages.collectionIntro}
            </p>
          </div>

          <ul className="mt-2 divide-y divide-border md:hidden">
            {experienceItems.map((item) => {
              const content = messages.items[item.id];
              const inquiryHint = `experience-${item.id}-inquiry`;
              return (
                <li key={item.id}>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        aria-label={content.title}
                        aria-describedby={inquiryHint}
                        className="flex min-h-16 w-full items-center gap-3 rounded-md py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                          <Image src={item.image} alt="" fill sizes="48px" className="object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-tight text-foreground">{content.title}</span>
                          <span id={inquiryHint} className="mt-1 block text-xs text-muted-foreground">{messages.secondaryCta}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </DialogTrigger>
                    <DialogContent showCloseButton={false}>
                      <DialogHeader>
                        <DialogTitle className="font-serif text-2xl">{content.title}</DialogTitle>
                        <DialogDescription>{content.description}</DialogDescription>
                      </DialogHeader>
                      <DialogClose
                        type="button"
                        aria-label={publicMessages.A11y.close}
                        className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </DialogClose>
                      <div className="relative aspect-[16/8] overflow-hidden rounded-md bg-muted">
                        <Image
                          src={item.image}
                          alt={content.alt}
                          fill
                          sizes="(max-width: 767px) 100vw, 460px"
                          className="object-cover"
                        />
                      </div>
                      <ul className="space-y-2">
                        {content.features.map((feature) => (
                          <li key={feature} className="flex gap-2 text-sm text-foreground">
                            <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <ButtonLink
                        href={`mailto:${resort.contactEmail}?subject=${encodeURIComponent(content.title)}`}
                        className="min-h-11 whitespace-normal"
                      >
                        <Mail className="size-4" aria-hidden="true" />
                        {messages.secondaryCta}
                      </ButtonLink>
                    </DialogContent>
                  </Dialog>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 text-left md:mt-8 md:text-center">
            <ButtonLink href={localizeHref("/services", locale)} variant="outline" className="min-h-11 md:min-h-10">
              <span className="md:hidden">{publicMessages.Nav.services}</span>
              <span className="hidden md:inline">{publicMessages.ServiceCatalog.all}</span>
            </ButtonLink>
          </div>
          <div className="mt-16 hidden gap-6 md:grid lg:grid-cols-2 lg:gap-8">
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
              href={localizeHref("/chat", locale)}
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
