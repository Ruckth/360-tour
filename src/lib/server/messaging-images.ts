import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReplyCard } from 'convex/shared/replyCards';
import { allowedMessagingImageSource } from 'convex/shared/messagingImages';


function signature(source: string, secret: string): string {
  return createHmac('sha256', secret).update(`messaging-image:v1:${source}`).digest('hex');
}

/** Only the server can authorize image conversion; this is not an open image proxy. */
export function withMessagingImages(card: ReplyCard | undefined, siteUrl: string): ReplyCard | undefined {
  if (!card) return;
  const secret = process.env.MESSAGING_IMAGE_SECRET;
  return { ...card, items: card.items.map(item => {
    const { imageUrl: source, ...rest } = item;
    if (!source || !secret || !allowedMessagingImageSource(source, siteUrl)) return rest;
    const url = new URL('/api/messaging/image', siteUrl);
    url.searchParams.set('src', source);
    url.searchParams.set('sig', signature(source, secret));
    return url.protocol === 'https:' && url.href.length <= 2000 ? { ...rest, imageUrl: url.href } : rest;
  }) };
}

export function authorizedMessagingImage(source: string, supplied: string, siteUrl: string): boolean {
  const secret = process.env.MESSAGING_IMAGE_SECRET;
  if (!secret || !source || source.length > 2000 || !/^[a-f0-9]{64}$/.test(supplied) || !allowedMessagingImageSource(source, siteUrl)) return false;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(source, secret), 'hex'));
  } catch { return false; }
}
