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

/** Explicit locales use a prefix so next-intl updates the guest preference, including for English. */
export function localizeMarketingPath(path: string, locale: string | undefined): string {
	if (locale === undefined) return path;
	const safe = isMarketingLocale(locale) ? locale : 'en';
	return path === '/' ? `/${safe}` : `/${safe}${path}`;
}
