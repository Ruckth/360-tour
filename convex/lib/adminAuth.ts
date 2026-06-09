import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

function adminEmails() {
	return new Set(
		(process.env.ADMIN_EMAILS ?? '')
			.split(',')
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean)
	);
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<{ email: string }> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity?.email) {
		throw new Error('Not authenticated');
	}

	const allowed = adminEmails();
	if (!allowed.has(identity.email.toLowerCase())) {
		throw new Error('Not authorized');
	}

	return { email: identity.email };
}
