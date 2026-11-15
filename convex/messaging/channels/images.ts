import type { ReplyCard } from '../../shared/replyCards';
import { allowedMessagingImageSource } from '../../shared/messagingImages';
/** The dedicated media capability authorizes JPEG conversion; it never authenticates a webhook API. */
export async function withMessagingImages(card: ReplyCard | undefined, siteUrl: string): Promise<ReplyCard | undefined> {
  if (!card) return;
  const secret = process.env.MESSAGING_IMAGE_SECRET;
  const key = secret ? await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : null;
  return { ...card, items: await Promise.all(card.items.map(async item => {
    const { imageUrl: source, ...rest } = item;
    if (!source || !key || !allowedMessagingImageSource(source, siteUrl)) return rest;
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`messaging-image:v1:${source}`));
    const url = new URL('/api/messaging/image', siteUrl);
    url.searchParams.set('src', source); url.searchParams.set('sig', Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''));
    return url.protocol === 'https:' && url.href.length <= 2000 ? { ...rest, imageUrl: url.href } : rest;
  })) };
}
