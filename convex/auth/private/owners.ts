import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { appendRecordHistory } from '../../settings/model';
import { findStaffGrantByEmail, validStaffEmail } from './staffAccess';

export const OWNER_MANAGEMENT_MESSAGE = 'Owners are managed by the deployment admin';
const deploymentActor = 'system:deployment-admin';

export function ownerGrants(ctx: QueryCtx) {
  return ctx.db.query('staffGrants').withIndex('by_role', q => q.eq('role', 'owner'));
}

export async function grantCompanyOwner(ctx: MutationCtx, rawEmail: string, options?: { rebind?: boolean }) {
  const email = validStaffEmail(rawEmail);
  const old = await findStaffGrantByEmail(ctx, email);
  if (old?.role === 'owner') {
    if (!options?.rebind || (!old.tokenIdentifier && old.branchIds.length === 0 && old.inviteExpiresAt === undefined)) {
      return old._id;
    }
  }
  const now = Date.now();
  const fields = {
    email, role: 'owner' as const, branchIds: [], revision: (old?.revision ?? 0) + 1, updatedAt: now, updatedByEmail: deploymentActor,
  };
  const id = old ? old._id : await ctx.db.insert('staffGrants', { ...fields, createdAt: now });
  if (old) await ctx.db.patch(id, { ...fields, tokenIdentifier: undefined, inviteExpiresAt: undefined });
  await appendRecordHistory(ctx, {
    entityType: 'staffGrant', entityId: id, actor: deploymentActor,
    kind: old?.role === 'owner' ? 'rebound' : old ? 'updated' : 'invited',
    before: old ? { email, role: old.role, branchIds: old.branchIds, claimed: Boolean(old.tokenIdentifier) } : null,
    after: { email, role: fields.role, branchIds: fields.branchIds, claimed: false },
  });
  return id;
}
