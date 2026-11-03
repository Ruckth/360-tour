import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReplyCard } from 'convex/lib/replyCards';
import { allowedImageUrl } from 'convex/lib/imageUrls';

function allowedSource(source: string, siteUrl: string): boolean {
  if (allowedImageUrl(source) && source.startsWith('https://')) return true;
  try {
    const url = new URL(source);
    // Local public photo assets only; never sign arbitrary application endpoints.
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.origin === new URL(siteUrl).origin && /\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname) &&
      !url.pathname.startsWith('/api/') && !source.includes('\\');
  } catch { return false; }
}

function signature(source: string, secret: string): string {
  return createHmac('sha256', secret).update(`messaging-image:v1:${source}`).digest('hex');
}

/** Only the server can authorize image conversion; this is not an open image proxy. */
export function withMessagingImages(card: ReplyCard | undefined, siteUrl: string): ReplyCard | undefined {
  if (!card) return;
  const secret = process.env.CONVEX_SERVER_SECRET;
  return { ...card, items: card.items.map(item => {
    const { imageUrl: source, ...rest } = item;
    if (!source || !secret || !allowedSource(source, siteUrl)) return rest;
    const url = new URL('/api/messaging/image', siteUrl);
    url.searchParams.set('src', source);
    url.searchParams.set('sig', signature(source, secret));
    return url.protocol === 'https:' && url.href.length <= 2000 ? { ...rest, imageUrl: url.href } : rest;
  }) };
}

export function authorizedMessagingImage(source: string, supplied: string, siteUrl: string): boolean {
  const secret = process.env.CONVEX_SERVER_SECRET;
  if (!secret || !source || source.length > 2000 || !/^[a-f0-9]{64}$/.test(supplied) || !allowedSource(source, siteUrl)) return false;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(source, secret), 'hex'));
  } catch { return false; }
}
