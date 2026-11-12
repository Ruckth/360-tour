import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/messaging/image/route';
import { withMessagingImages } from '@/lib/server/messaging-images';

const source = 'https://test.convex.cloud/api/storage/photo-id';
function imageUrl() {
  return withMessagingImages({ kind: 'service', items: [{ title: 'Massage', lines: [], actions: [], imageUrl: source }] }, 'https://tour.example')!.items[0].imageUrl!;
}
beforeEach(() => vi.stubEnv('MESSAGING_IMAGE_SECRET', 'image-signing-test-secret'));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('messaging image conversion', () => {
  it('converts an existing WebP upload to a bounded JPEG', async () => {
    const webp = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#16756c' } }).webp().toBuffer();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(webp), { headers: { 'content-type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request(imageUrl()));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400');
    const result = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(960);
    expect(metadata.height).toBeLessThanOrEqual(640);
    expect(result.length).toBeLessThan(1024 * 1024);
    expect(fetchMock).toHaveBeenCalledWith(source, expect.objectContaining({ redirect: 'error' }));
  });

  it('rejects unsigned and tampered URLs before fetching anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const url = new URL(imageUrl());
    url.searchParams.set('src', 'https://private.example/data');
    expect((await GET(new Request(url))).status).toBe(403);
    url.searchParams.delete('sig');
    expect((await GET(new Request(url))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits image headers if signing is not configured', () => {
    vi.stubEnv('MESSAGING_IMAGE_SECRET', '');
    expect(imageUrl()).toBeUndefined();
  });

  it.each(['https://127.0.0.1/photo', 'https://private.internal/photo', 'https://tour.example/api/private.png'])('never signs a disallowed resolved source: %s', imageUrl => {
    const card = withMessagingImages({ kind: 'property', items: [{ title: 'Villa', lines: [], actions: [], imageUrl }] }, 'https://tour.example');
    expect(card?.items[0].imageUrl).toBeUndefined();
  });

  it.each(['text/html', 'image/svg+xml'])('rejects unsupported content types (%s)', async contentType => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private</html>', { headers: { 'content-type': contentType } })));
    expect((await GET(new Request(imageUrl()))).status).toBe(422);
  });

  it('rejects oversized streams even without a Content-Length header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })));
    expect((await GET(new Request(imageUrl()))).status).toBe(422);
  });

  it('does not expose upstream errors or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Private upstream detail'); }));
    const response = await GET(new Request(imageUrl()));
    expect(response.status).toBe(422);
    expect(await response.text()).toBe('Image unavailable');
  });
});
