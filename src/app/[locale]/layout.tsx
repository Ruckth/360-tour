import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PublicSiteShell } from "@/components/global/SiteShell";
import { isLocale, locales } from "@/i18n/routing";
import { hasFeaturedReviews } from "@/lib/server/villas";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/** Every public page is served from here (src/proxy.ts rewrites to a locale), so only they read villa data. */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const hasReviews = await hasFeaturedReviews(locale);

  return <PublicSiteShell hasReviews={hasReviews}>{children}</PublicSiteShell>;
}
