import { ConvexError } from 'convex/values';
import { isIsoDate } from '../shared/dates';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function assertValidEmail(email: string): void {
	if (!EMAIL_RE.test(email.trim())) {
		throw new ConvexError('Please enter a valid email address');
	}
}

export function assertValidIsoDate(s: string, label: string): void {
	if (!isIsoDate(s)) {
		throw new Error(`${label} must be in YYYY-MM-DD format`);
	}
}

export function assertPositiveInt(n: number, label: string): void {
	if (!Number.isInteger(n) || n < 1) {
		throw new Error(`${label} must be at least 1`);
	}
}

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

