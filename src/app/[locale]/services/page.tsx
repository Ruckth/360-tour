import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { ServicesView } from "@/components/services/ServicesView";
import { defaultLocale, isLocale } from "@/i18n/routing";
import { getPublicMessages } from "@/lib/i18n/server-content";
import type { PageSearch } from "@/lib/page-search";
import { servicesQuery } from "@/lib/services-query";
import { getServiceCatalog } from "@/lib/server/services";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getPublicMessages(locale).ServiceCatalog;
  return { title: t.title, description: t.intro };
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  const activeLocale = await getLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const query = servicesQuery(await searchParams);
  const [directory, result] = await getServiceCatalog(query);
  return (
    <ServicesView
      locale={locale}
      t={getPublicMessages(locale).ServiceCatalog}
      query={query}
      directory={directory}
      result={result}
    />
  );
}
