import { ConvexError } from 'convex/values';
import { isIsoDate } from './dates';

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
