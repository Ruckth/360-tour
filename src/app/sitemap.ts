import { sitemapEntries } from "@/lib/server/search-index";
import { getVillaSlugs } from "@/lib/server/villas";

export const revalidate = 60;

export default async function sitemap() {
  return sitemapEntries(await getVillaSlugs());
}
