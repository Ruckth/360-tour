import type { MetadataRoute } from 'next';
import { locales, localizeHref } from '@/i18n/routing';
import { properties } from '@/lib/data/properties';
import { siteUrl } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const paths = ['/', '/experiences', '/booking', ...properties.map(property => `/rooms/${property.id}`)];
  const localized = paths.flatMap(path => locales.map(locale => ({
    url: `${base}${localizeHref(path, locale)}`,
    changeFrequency: path === '/' ? 'weekly' as const : 'monthly' as const,
    priority: path === '/' ? 1 : 0.6,
  })));
  return [...localized, ...['/privacy', '/terms'].map(path => ({ url: `${base}${path}`, changeFrequency: 'yearly' as const, priority: 0.3 }))];
}
