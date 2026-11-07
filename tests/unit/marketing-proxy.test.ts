import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
import { marketingSlugForPath, isInternalMarketingPath } from '../../src/lib/marketing/proxy';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), i18n: vi.fn() }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock('../../src/lib/clerk-config', () => ({ isClerkConfigured: () => false }));
vi.mock('next-intl/middleware', () => ({ default: () => mocks.i18n }));
import proxy from '../../src/proxy';

describe('pure proxy decision', () => {
  it.each([['/f1', 'f1'], ['/f1/', 'f1'], ['/r/anna', 'r/anna'], ['/r/anna/', 'r/anna']])('resolves %s', (path, slug) => {
    expect(marketingSlugForPath(path)).toBe(slug);
  });
  it.each(['/', '/rooms', '/rooms/mossbell', '/booking', '/admin', '/api', '/en', '/th', '/zh-CN', '/offers', '/r', '/r/a/b', '/foo/bar', '/F1', '/f%31', '//f1', '/_next', '/icon.png'])('preserves %s', path => {
    expect(marketingSlugForPath(path)).toBeNull();
  });
  it.each(['/booking?mk=f1', '/th/rooms/mossbell?mk=r%2Fanna', '/?mk=f1'])('accepts internal %s', path => expect(isInternalMarketingPath(path)).toBe(true));
  it.each(['https://evil.com', '//evil.com', '/\\evil.com', '/\nevil', 'javascript:alert(1)', ''])('rejects unsafe %s', path => expect(isInternalMarketingPath(path)).toBe(false));
});

describe('proxy short link integration', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example.convex.cloud');
    vi.clearAllMocks();
    mocks.i18n.mockImplementation(() => NextResponse.next());
    mocks.mutation.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  const call = (path: string, ua = 'Mozilla/5.0') => {
    const waitUntil = vi.fn();
    // Only waitUntil is consumed by the proxy in this test.
    const event = { waitUntil } as unknown as NextFetchEvent;
    return { response: proxy(new NextRequest('https://book.example' + path, { headers: { 'user-agent': ua } }), event), waitUntil };
  };
  it('returns 302 before localization and records bots without waiting', async () => {
    mocks.query.mockResolvedValue({ path: '/booking?mk=f1&coupon=DCNT-F1-20' });
    mocks.mutation.mockImplementation(() => new Promise(() => {}));
    const { response, waitUntil } = call('/f1', 'Slackbot');
    const result = await response;
    expect(result?.status).toBe(302);
    expect(result?.headers.get('location')).toBe('https://book.example/booking?mk=f1&coupon=DCNT-F1-20');
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), { slug: 'f1', bot: true });
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(mocks.i18n).not.toHaveBeenCalled();
  });
  it('falls through on unknown slugs and resolver failure', async () => {
    mocks.query.mockResolvedValue(null);
    await call('/unknown').response;
    mocks.query.mockRejectedValue(new Error('offline'));
    await call('/f1').response;
    expect(mocks.i18n).toHaveBeenCalledTimes(2);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it('never looks up reserved or localized routes', async () => {
    for (const path of ['/rooms', '/booking', '/en', '/th/chat', '/api/test']) await call(path).response;
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('ignores unsafe resolver responses and catches event failures', async () => {
    mocks.query.mockResolvedValue({ path: '//evil.example' });
    await call('/f1').response;
    expect(mocks.i18n).toHaveBeenCalledOnce();
    mocks.query.mockResolvedValue({ path: '/chat?mk=r%2Fanna' });
    mocks.mutation.mockRejectedValue(new Error('offline'));
    const { response, waitUntil } = call('/r/anna');
    expect((await response)?.status).toBe(302);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
  it('falls through when deployment configuration is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', '');
    await call('/f1').response;
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.i18n).toHaveBeenCalledOnce();
  });
});
