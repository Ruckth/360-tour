// Mirrors src/i18n/routing.ts `locales` (that file imports next-intl, which must not enter the Convex bundle).
// tests/unit/marketing-slugs.test.ts asserts the two stay equal.
export const marketingLocales = ['en', 'th', 'zh-CN', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'it', 'hi'] as const;

// Top-level route directories in src/app and src/app/[locale]. Keep this list
// aligned with the filesystem; marketing-slugs.test.ts checks newly added routes.
export const reservedMarketingSlugs = new Set([
	'rooms', 'booking', 'chat', 'experiences', 'privacy', 'terms', 'services',
	'admin', 'api', 'dev', 'display', 'sign-in', 'sign-up', 'offers', 'r',
	'__clerk', 'trpc', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'icon.png',
	...marketingLocales.map((locale) => locale.toLowerCase())
]);

export function validateMarketingSlug(raw: string): {
	slug: string; reason?: 'empty' | 'invalid' | 'reserved';
} {
	const slug = raw.trim();
	if (!slug) return { slug, reason: 'empty' };
	if (reservedMarketingSlugs.has(slug.toLowerCase())) return { slug, reason: 'reserved' };
	if (slug.length > 32 || !/^(?:[a-z0-9-]+|r\/[a-z0-9-]+)$/.test(slug)) return { slug, reason: 'invalid' };
	return { slug };
}

export function isMarketingLocale(value: string): boolean {
	return (marketingLocales as readonly string[]).includes(value);
}

/** Same result as src/i18n/routing.ts `localizeHref` for internal paths: the default locale (en) has no prefix. */
export function localizeMarketingPath(path: string, locale: string | undefined): string {
	const safe = locale && isMarketingLocale(locale) ? locale : 'en';
	if (safe === 'en') return path;
	return path === '/' ? `/${safe}` : `/${safe}${path}`;
}
