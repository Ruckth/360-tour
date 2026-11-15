/** Auth-owned backend deployment configuration leaf. See docs/architecture/phase3b-auth-implementation.md.
 * Kept below the Auth/Marketing model cycle; this reads process.env and is not shared pure code. */

export function adminEmails() {
	return new Set(
		(process.env.ADMIN_EMAILS ?? '')
			.split(',')
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean)
	);
}
