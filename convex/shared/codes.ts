export function demoCode(prefix: string, bookingId: string): string {
	return `${prefix}-${new Date().getUTCFullYear()}-${bookingId.slice(-6).toUpperCase()}`;
}

/** Proposal-specific HMAC key: no new deployment secret or predictable link capability. */
export async function signProposal(payload: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))), (n) =>
		n.toString(16).padStart(2, '0')
	).join('');
}
export async function verifyProposal(payload: string, signature: string, secret: string): Promise<boolean> {
	if (!/^[a-f0-9]{64}$/.test(signature)) return false;
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'verify'
	]);
	const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
	return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(payload));
}
