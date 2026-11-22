import { locales, localizeHref } from "@/i18n/routing";
import { siteUrl } from "@/lib/site-url";

export function robotsDocument() {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/booking/pay", "/booking/success", "/chat", "/*/booking/pay", "/*/booking/success", "/*/chat", "/sign-in", "/sign-up", "/display"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

export function sitemapEntries(slugs: string[]) {
  const base = siteUrl();
  const paths = ["/", "/experiences", "/services", "/booking", ...slugs.map(slug => `/rooms/${slug}`)];
  const localized = paths.flatMap(path => locales.map(locale => ({
    url: `${base}${localizeHref(path, locale)}`,
    changeFrequency: path === "/" ? "weekly" as const : "monthly" as const,
    priority: path === "/" ? 1 : 0.6,
  })));
  return [...localized, ...["/privacy", "/terms"].map(path => ({
    url: `${base}${path}`, changeFrequency: "yearly" as const, priority: 0.3,
  }))];
}
