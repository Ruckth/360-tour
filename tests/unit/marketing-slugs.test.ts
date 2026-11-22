import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { locales } from '../../src/i18n/routing';
import { marketingLocales } from '../../convex/shared/marketingSlugs';
import { reservedMarketingSlugs, validateMarketingSlug } from '../../convex/shared/marketingSlugs';

const locale = vi.hoisted(() => ({ cookie: undefined as string | undefined, setCookie: vi.fn() }));
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => locale.cookie, setCookie: locale.setCookie, setResponseHeader: vi.fn() }));
import { siteRedirect } from '../../src/start-app/site-redirect.server';

describe('marketing slug rules', () => {
  it.each(['f', 'f1', 'a-2', 'r/anna', 'r/lamai-dive', 'x'.repeat(32)])('accepts %s', slug => {
    expect(validateMarketingSlug(slug)).toEqual({ slug });
  });
  it.each(['F1', '/f1', 'f_1', 'f.1', 'r/', 'r/a/b', 'x/anna', 'x'.repeat(33), 'a?b', 'a#b', 'a b', 'é', '../a'])('rejects %s', slug => {
    expect(validateMarketingSlug(slug).reason).toBe('invalid');
  });
  it('trims whitespace and distinguishes empty input', () => {
    expect(validateMarketingSlug(' f1 ')).toEqual({ slug: 'f1' });
    expect(validateMarketingSlug('  ').reason).toBe('empty');
  });
  it('mirrors the app locales', () => {
    expect([...marketingLocales]).toEqual([...locales]);
  });
  it('reserves all static top-level app routes, locales and system assets', () => {
    // Flat Start route files: `{-$locale}.booking.index.tsx` serves /booking, `robots[.]txt.ts` /robots.txt.
    for (const file of readdirSync(resolve('src/start-app/routes'))) {
      const segment = file.replace(/\.tsx?$/, '').replace(/^\{-\$locale\}\./, '').replaceAll('[.]', '\u0000').split('.')[0].replaceAll('\u0000', '.');
      if (/^(__root|index|\$)/.test(segment)) continue;
      expect(reservedMarketingSlugs.has(segment), `src/start-app/routes/${file} must be reserved`).toBe(true);
    }
    for (const slug of [...locales, 'r', 'offers', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'icon.png']) {
      expect(validateMarketingSlug(slug).reason).toBe('reserved');
    }
  });
});

describe('localizeMarketingPath', () => {
  it('prefixes every explicitly selected locale, including English', async () => {
    const { localizeMarketingPath } = await import('../../convex/shared/marketingSlugs');
    for (const locale of locales) for (const path of ['/', '/booking', '/rooms/mossbell']) {
      expect(localizeMarketingPath(path, locale)).toBe(`/${locale}${path === '/' ? '' : path}`);
    }
    expect(localizeMarketingPath('/booking', undefined)).toBe('/booking');
  });

  it('selects English through the Start locale middleware for a visitor with a Thai cookie', async () => {
    const { localizeMarketingPath } = await import('../../convex/shared/marketingSlugs');
    const headers = { 'accept-language': 'th' };
    locale.cookie = 'th';
    const path = localizeMarketingPath('/booking', 'en') + '?mk=english';
    const first = await siteRedirect(new Request('https://example.com' + path, { headers }));
    // as-needed removes /en but must first replace the visitor's Thai preference.
    expect(first?.headers.get('location')).toBe('https://example.com/booking?mk=english');
    expect(locale.setCookie).toHaveBeenCalledWith('NEXT_LOCALE', 'en', expect.objectContaining({ path: '/' }));
    locale.cookie = 'en';
    expect(await siteRedirect(new Request(first!.headers.get('location')!, { headers }))).toBeUndefined();
    locale.cookie = 'th';
    const guest = await siteRedirect(new Request('https://example.com' + localizeMarketingPath('/booking', undefined), { headers }));
    expect(guest?.headers.get('location')).toBe('https://example.com/th/booking');
  });
});
