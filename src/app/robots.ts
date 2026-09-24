import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/booking/pay', '/booking/success', '/chat', '/*/booking/pay', '/*/booking/success', '/*/chat', '/sign-in', '/sign-up'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
