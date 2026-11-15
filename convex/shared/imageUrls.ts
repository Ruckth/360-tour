// Keep these hosts in sync with images.remotePatterns in next.config.ts.
export const IMAGE_HOSTS = ['images.unsplash.com', 'qr-official.line.me'] as const;
export const IMAGE_HOST_SUFFIX = '.convex.cloud';

export function allowedImageUrl(value: string): boolean {
  // WHATWG URL parsing treats backslashes as slashes; /\host can become a new origin.
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) return false;
	if (/^\/(?!\/)\S+$/.test(value)) return true;
	if (!value.startsWith('https://') || /\s/.test(value)) return false;
	try {
		const url = new URL(value);
		const convexSubdomain = url.hostname.endsWith(IMAGE_HOST_SUFFIX)
			? url.hostname.slice(0, -IMAGE_HOST_SUFFIX.length)
			: '';
		return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
			(IMAGE_HOSTS.some((host) => url.hostname === host) ||
				(convexSubdomain.length > 0 && !convexSubdomain.includes('.')));
	} catch {
		return false;
	}
}
