/** Upload rules shared by the admin UI (early feedback) and `adminProperties.saveUploadedImage` (enforcement). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const MB = 1024 * 1024;
export const MAX_UPLOAD_BYTES = { photo: 8 * MB, panorama: 12 * MB } as const;
export type UploadKind = keyof typeof MAX_UPLOAD_BYTES;

/** Returns why the file can't be used, or null when it's fine. */
export function uploadProblem(kind: UploadKind, contentType: string | undefined, size: number): string | null {
	if (!(IMAGE_TYPES as readonly string[]).includes(contentType ?? '')) return 'Images must be JPEG, PNG or WebP';
	const max = MAX_UPLOAD_BYTES[kind];
	if (size > max) return `${kind === 'panorama' ? 'Panoramas' : 'Photos'} must be ${max / MB} MB or smaller`;
	return null;
}

/** Staff and service photos are optimized in the browser (WebP, or JPEG where WebP encoding is missing), so only those are stored. */
export const AVATAR_UPLOAD_TYPES = ['image/webp', 'image/jpeg'] as const;
export const MAX_AVATAR_BYTES = 400 * 1024;

export function avatarUploadProblem(contentType: string | undefined, size: number): string | null {
	if (!(AVATAR_UPLOAD_TYPES as readonly string[]).includes(contentType ?? '')) return 'Photos must be optimized WebP or JPEG';
	if (size > MAX_AVATAR_BYTES) return `Photos must be ${MAX_AVATAR_BYTES / 1024} KB or smaller`;
	return null;
}
