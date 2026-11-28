import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { requireStaff } from './staffAccess';

/** Desk/operations access; marketing keeps its own permission checks. */
export async function requireOperationsContext(ctx: QueryCtx | MutationCtx | ActionCtx) {
 const access = await requireStaff(ctx, 'operations');
 // Preserve the original actor spelling for existing owner audit trails.
 const identity = await ctx.auth.getUserIdentity();
 return { admin: { email: identity?.email ?? access.email }, operationsAccess: access };
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<{ email: string }> {
 return (await requireOperationsContext(ctx)).admin;
}

export async function requireOwner(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<{ email: string }> {
 return await requireStaff(ctx, 'manageTeam');
}
