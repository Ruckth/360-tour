import { allowedImageUrl } from './imageUrls';
export function allowedMessagingImageSource(source: string, siteUrl: string): boolean {
  if (allowedImageUrl(source) && source.startsWith('https://')) return true;
  try {
    const url = new URL(source);
    // Local public photo assets only; never sign arbitrary application endpoints.
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.origin === new URL(siteUrl).origin && /\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname) &&
      !url.pathname.startsWith('/api/') && !source.includes('\\');
  } catch { return false; }
}

