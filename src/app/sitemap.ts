import type { MetadataRoute } from 'next';
import { defaultLocale, locales, localizeHref } from '@/i18n/routing';
import { getVillaCatalog } from '@/lib/server/villas';
import { siteUrl } from '@/lib/site-url';

// Regenerate so newly activated or archived villas appear/disappear without a redeploy.
export const revalidate = 60;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const { villas } = await getVillaCatalog(defaultLocale);
  const paths = ['/', '/experiences', '/booking', ...villas.map(villa => `/rooms/${villa.id}`)];
  const localized = paths.flatMap(path => locales.map(locale => ({
    url: `${base}${localizeHref(path, locale)}`,
    changeFrequency: path === '/' ? 'weekly' as const : 'monthly' as const,
    priority: path === '/' ? 1 : 0.6,
  })));
  return [...localized, ...['/privacy', '/terms'].map(path => ({ url: `${base}${path}`, changeFrequency: 'yearly' as const, priority: 0.3 }))];
}
