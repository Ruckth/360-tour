"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { buildEmailHref } from "@/lib/contact-links";
import { getLocalizedResort } from "@/lib/i18n/public-content";

export function SiteFooter() {
  const nav = useTranslations("Nav");
  const footer = useTranslations("Footer");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const resort = getLocalizedResort(locale);

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[1fr_auto] md:px-8">
        <div>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {resort.name}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {resort.tagline}. {resort.location}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            {resort.address}
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground md:text-right">
          <Link className="transition hover:text-foreground" href={localizeHref("/#villas", locale)}>
            {nav("villas")}
          </Link>
          <Link className="transition hover:text-foreground" href={localizeHref("/booking", locale)}>
            {footer("bookDirect")}
          </Link>
          <a className="transition hover:text-foreground" href={buildEmailHref(resort.contactEmail)}>
            {resort.contactEmail}
          </a>
        </div>
      </div>
    </footer>
  );
}
