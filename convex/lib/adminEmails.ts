
export function adminEmails() {
	return new Set(
		(process.env.ADMIN_EMAILS ?? '')
			.split(',')
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean)
	);
}
