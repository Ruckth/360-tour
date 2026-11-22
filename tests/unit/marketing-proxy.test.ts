import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketingSlugForPath, isInternalMarketingPath } from '../../src/lib/marketing/proxy';

// Short links resolve in the Start request middleware (src/start-app/site-redirect.server.ts),
// before locale routing. Ported from the retired Next proxy (src/proxy.ts at the dual-entry checkpoint).
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), waitUntil: vi.fn(), cookie: undefined as string | undefined, setCookie: vi.fn() }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => mocks.cookie, setCookie: mocks.setCookie, setResponseHeader: vi.fn() }));
import { siteRedirect } from '../../src/start-app/site-redirect.server';

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
    vi.stubEnv('VITE_CONVEX_URL', 'https://example.convex.cloud');
    vi.clearAllMocks();
    mocks.cookie = undefined;
    mocks.mutation.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  const call = (path: string, ua = 'Mozilla/5.0', headers: Record<string, string> = {}) =>
    siteRedirect(new Request('https://book.example' + path, { headers: { 'user-agent': ua, ...headers } }));
  /** A request that continued to ordinary routing (no short-link redirect). */
  const fellThrough = (response: Response | undefined) => expect(response?.status).not.toBe(302);

  it('returns 302 before localization and records bots without waiting', async () => {
    mocks.query.mockResolvedValue({ path: '/booking?mk=f1&coupon=DCNT-F1-20' });
    mocks.mutation.mockImplementation(() => new Promise(() => {}));
    mocks.cookie = 'th';
    const result = await call('/f1', 'Slackbot');
    expect(result?.status).toBe(302);
    expect(result?.headers.get('cache-control')).toBe('no-store');
    expect(result?.headers.get('location')).toBe('https://book.example/booking?mk=f1&coupon=DCNT-F1-20');
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), { slug: 'f1', bot: true });
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
  it.each<[string, string | undefined, Record<string, string>]>([
    ['cookie', 'th', {}], ['accept-language', undefined, { 'accept-language': 'th,en;q=0.8' }],
  ])('keeps capture parameters through as-needed locale routing (%s)', async (_label, cookie, headers) => {
    mocks.cookie = cookie;
    const response = await call('/booking?mk=f1&coupon=X', 'Mozilla/5.0', headers);
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe('https://book.example/th/booking?mk=f1&coupon=X');
  });
  it('falls through on unknown slugs and resolver failure', async () => {
    mocks.query.mockResolvedValue(null);
    fellThrough(await call('/unknown'));
    mocks.query.mockRejectedValue(new Error('offline'));
    fellThrough(await call('/f1'));
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it('never looks up reserved or localized routes', async () => {
    for (const path of ['/rooms', '/booking', '/en', '/th/chat', '/api/test']) await call(path);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('ignores unsafe resolver responses and catches event failures', async () => {
    mocks.query.mockResolvedValue({ path: '//evil.example' });
    fellThrough(await call('/f1'));
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ path: '/chat?mk=r%2Fanna' });
    mocks.mutation.mockRejectedValue(new Error('offline'));
    expect((await call('/r/anna'))?.status).toBe(302);
    await expect(mocks.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
  it('falls through when deployment configuration is absent', async () => {
    vi.stubEnv('VITE_CONVEX_URL', '');
    fellThrough(await call('/f1'));
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
