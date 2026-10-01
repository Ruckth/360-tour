let warnedMissingSecret = false;

/** Authenticate calls made by the Next.js webhook servers. */
export async function requireServerSecret(provided: string): Promise<void> {
	const expected = process.env.CONVEX_SERVER_SECRET;
	if (expected === undefined) {
		if (!warnedMissingSecret) {
			console.warn('CONVEX_SERVER_SECRET is not configured in Convex; webhook mutations are temporarily unauthenticated');
			warnedMissingSecret = true;
		}
		return;
	}
	if (expected.length === 0) throw new Error('CONVEX_SERVER_SECRET is empty in Convex');

	// Hash both inputs so comparison always processes the same number of bytes.
	const encoder = new TextEncoder();
	const [expectedHash, providedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(expected)),
		crypto.subtle.digest('SHA-256', encoder.encode(provided))
	]);
	const left = new Uint8Array(expectedHash);
	const right = new Uint8Array(providedHash);
	let difference = 0;
	for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
	if (difference !== 0) throw new Error('Invalid server secret');
}
