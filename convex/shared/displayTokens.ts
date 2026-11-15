/** No 0/O, 1/I/L: codes are read off a screen and typed by staff. */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_LENGTH = 6;

function base64url(bytes: Uint8Array) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url. Used for device tokens and pairing-link secrets. */
export function randomSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64url(bytes);
}

/** Uniform over the alphabet (rejection sampling, so no letter is favoured). */
export function randomPairCode(): string {
	const limit = 256 - (256 % PAIR_CODE_ALPHABET.length);
	let code = '';
	while (code.length < PAIR_CODE_LENGTH) {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte < limit && code.length < PAIR_CODE_LENGTH) code += PAIR_CODE_ALPHABET[byte % PAIR_CODE_ALPHABET.length];
		}
	}
	return code;
}

export function normalizePairCode(value: string): string {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Hex SHA-256; only hashes of tokens and secrets are stored. */
export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
