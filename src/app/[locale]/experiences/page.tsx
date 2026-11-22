import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { ExperiencesView } from "@/components/experiences/ExperiencesView";
import { experiencesSeo } from "@/lib/data/experiences";
import { defaultLocale, isLocale } from "@/i18n/routing";
import { getLocalizedResort, getPublicMessages } from "@/lib/i18n/server-content";

async function pageLocale() {
  const locale = await getLocale();
  return isLocale(locale) ? locale : defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  const seo = experiencesSeo(getPublicMessages(locale));
  return {
    title: seo.title,
    description: seo.description,
    openGraph: {
      type: "website",
      siteName: getLocalizedResort(locale).name,
      title: seo.ogTitle,
      description: seo.description,
      images: [seo.image],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle,
      description: seo.description,
      images: [seo.image],
    },
  };
}

export default async function ExperiencesPage() {
  const locale = await pageLocale();
  return <ExperiencesView locale={locale} publicMessages={getPublicMessages(locale)} />;
}
