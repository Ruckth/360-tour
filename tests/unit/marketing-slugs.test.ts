import { readdirSync } from 'node:fs';
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
  it('matches the app localizeHref for every locale', async () => {
    const { localizeHref } = await import('../../src/i18n/routing');
    const { localizeMarketingPath } = await import('../../convex/lib/marketingSlugs');
    for (const locale of locales) for (const path of ['/', '/booking', '/rooms/mossbell']) {
      expect(localizeMarketingPath(path, locale)).toBe(localizeHref(path, locale));
    }
  });
});
