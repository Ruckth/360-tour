import sharp from 'sharp';
import { authorizedMessagingImage } from '@/lib/server/messaging-images';

const MAX_BYTES = 8 * 1024 * 1024;

function imageError(message: string, status: 403 | 422): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function serveMessagingImage(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const source = params.get('src') ?? '';
  if (!authorizedMessagingImage(source, params.get('sig') ?? '', new URL(request.url).origin)) return imageError('Invalid image signature', 403);
  try {
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { accept: 'image/jpeg,image/png,image/webp,image/avif' } });
    if (!response.ok || !response.body || !/^image\/(jpeg|png|webp|avif)(?:;|$)/i.test(response.headers.get('content-type') ?? '') ||
        Number(response.headers.get('content-length')) > MAX_BYTES) return imageError('Image unavailable', 422);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_BYTES) return imageError('Image too large', 422);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    // Bound decoding and output size, strip metadata, and normalize WebP uploads for LINE.
    const jpeg = await sharp(Buffer.concat(chunks), { limitInputPixels: 20_000_000, animated: false })
      .rotate().resize(960, 640, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: {
      'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600, s-maxage=86400',
      'x-content-type-options': 'nosniff',
    } });
  } catch {
    return imageError('Image unavailable', 422);
  }
}
