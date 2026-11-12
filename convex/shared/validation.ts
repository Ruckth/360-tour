import { allowedImageUrl, IMAGE_HOSTS } from './imageUrls';

export function required(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

export function amount(value: number, label: string, { integer = false, min = 0, max = Infinity } = {}): number {
	if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
		const range = max === Infinity ? `at least ${min}` : `between ${min} and ${max}`;
		throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}${range}`);
	}
	return value;
}

export function imageUrl(value: string): string {
	if (!allowedImageUrl(value)) throw new Error(`Images must be /public paths or https URLs. Use an uploaded photo or an image from ${IMAGE_HOSTS.join(' or ')}.`);
	return value;
}

