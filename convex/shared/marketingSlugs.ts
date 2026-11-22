// Mirrors src/i18n/routing.ts `locales`; the Convex bundle must not import frontend modules.
// tests/unit/marketing-slugs.test.ts asserts the two stay equal.
export const marketingLocales = ['en', 'th', 'zh-CN', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'it', 'hi'] as const;

// Top-level path segments of the Start routes in src/start-app/routes (with and without the
// locale prefix), plus framework and system paths. marketing-slugs.test.ts checks newly added routes.
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

/** Explicit locales use a prefix so the locale middleware updates the guest preference, including for English. */
export function localizeMarketingPath(path: string, locale: string | undefined): string {
	if (locale === undefined) return path;
	const safe = isMarketingLocale(locale) ? locale : 'en';
	return path === '/' ? `/${safe}` : `/${safe}${path}`;
}
