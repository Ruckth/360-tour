import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';

export function createGuestToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashGuestToken(token: string) {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function requireGuestToken(session: Doc<'conversations'> | null, token?: string) {
	if (!session || session.channel !== 'web' || !token || !session.guestTokenHash ||
		await hashGuestToken(token) !== session.guestTokenHash) {
		throw new ConvexError({ code: 'INVALID_GUEST_TOKEN', message: 'A valid guest session token is required' });
	}
	return session;
}
