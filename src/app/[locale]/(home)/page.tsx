import { getLocale } from "next-intl/server";
import { HomeView } from "@/components/home/HomeView";
import { defaultLocale, isLocale } from "@/i18n/routing";
import { getPublicMessages } from "@/lib/i18n/server-content";
import { getFeaturedReviews, getVillaCatalog } from "@/lib/server/villas";

export default async function HomePage() {
  const activeLocale = await getLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const [catalog, reviews] = await Promise.all([getVillaCatalog(locale), getFeaturedReviews()]);
  return <HomeView locale={locale} messages={getPublicMessages(locale)} villas={catalog.villas} reviews={reviews} />;
}
