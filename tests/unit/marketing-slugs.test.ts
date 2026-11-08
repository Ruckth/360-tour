import { readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locales } from '../../src/i18n/routing';
import { marketingLocales } from '../../convex/lib/marketingSlugs';
import { reservedMarketingSlugs, validateMarketingSlug } from '../../convex/lib/marketingSlugs';

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
    for (const dir of ['src/app', 'src/app/[locale]']) {
      for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
        if (entry.isDirectory() && !/^[[(]/.test(entry.name)) {
          expect(reservedMarketingSlugs.has(entry.name), `${dir}/${entry.name} must be reserved`).toBe(true);
        }
      }
    }
    for (const slug of [...locales, 'r', 'offers', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'icon.png']) {
      expect(validateMarketingSlug(slug).reason).toBe('reserved');
    }
  });
});

describe('localizeMarketingPath', () => {
  it('prefixes every explicitly selected locale, including English', async () => {
    const { localizeMarketingPath } = await import('../../convex/lib/marketingSlugs');
    for (const locale of locales) for (const path of ['/', '/booking', '/rooms/mossbell']) {
      expect(localizeMarketingPath(path, locale)).toBe(`/${locale}${path === '/' ? '' : path}`);
    }
    expect(localizeMarketingPath('/booking', undefined)).toBe('/booking');
  });

  it('selects English through real next-intl middleware for a visitor with a Thai cookie', async () => {
    // next-intl expects Next's bundler to resolve this extensionless import.
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
    } });
    const { default: createMiddleware } = await import('next-intl/middleware').finally(() => hooks.deregister());
    const { NextRequest } = await import('next/server');
    const { routing } = await import('../../src/i18n/routing');
    const { localizeMarketingPath } = await import('../../convex/lib/marketingSlugs');
    const middleware = createMiddleware(routing);
    const headers = { cookie: 'NEXT_LOCALE=th', 'accept-language': 'th' };
    const path = localizeMarketingPath('/booking', 'en') + '?mk=english';
    const first = middleware(new NextRequest('https://example.com' + path, { headers }));
    // as-needed removes /en but must first replace the visitor's Thai preference.
    expect(first.headers.get('location')).toBe('https://example.com/booking?mk=english');
    expect(first.cookies.get('NEXT_LOCALE')?.value).toBe('en');
    const final = middleware(new NextRequest(first.headers.get('location')!, {
      headers: { ...headers, cookie: 'NEXT_LOCALE=en' },
    }));
    expect(final.headers.get('location')).toBeNull();
    expect(final.headers.get('x-middleware-rewrite')).toBe('https://example.com/en/booking?mk=english');
    const guest = middleware(new NextRequest('https://example.com' + localizeMarketingPath('/booking', undefined), { headers }));
    expect(guest.headers.get('location')).toBe('https://example.com/th/booking');
  });
});
