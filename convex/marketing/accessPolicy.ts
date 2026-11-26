import type { UserIdentity } from 'convex/server';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { MARKETING_INVITATION_TTL_MS } from '../shared/marketingPolicy';
import type { MarketingRole } from '../shared/marketingAccess';
import { marketingCapabilities } from '../shared/marketingAccess';

export function marketingInvitationExpiry(grant: Doc<"marketingGrants">) {
  return grant.tokenIdentifier ? null : grant.inviteExpiresAt ?? grant.createdAt + MARKETING_INVITATION_TTL_MS;
}

export function marketingInvitationExpired(grant: Doc<"marketingGrants">, now = Date.now()) {
  const expiresAt = marketingInvitationExpiry(grant);
  return expiresAt !== null && expiresAt <= now;
}

export async function marketingAccessForIdentity(ctx: QueryCtx | MutationCtx, identity: UserIdentity | null, isOwner: boolean) {
  const email = identity?.email?.trim().toLowerCase() ?? null;
  // Same policy as staff access: an email without explicit verification grants no marketing authority.
  if (identity?.emailVerified !== true)
    return { email, role: null, capabilities: marketingCapabilities(null), pendingInvitation: null };
  if (isOwner)
    return {
      email: identity.email!,
      role: "admin" as const,
      capabilities: marketingCapabilities("admin"),
      pendingInvitation: null,
    };
  const grant = identity
    ? await ctx.db
        .query("marketingGrants")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", identity.tokenIdentifier),
        )
        .unique()
    : null;
  const invite =
    email && !grant
      ? await ctx.db
          .query("marketingGrants")
          .withIndex("by_email", (q) => q.eq("email", email))
          .unique()
      : null;
  const expiresAt = invite && marketingInvitationExpiry(invite);
  const role = grant?.role ?? null;
  return {
    email,
    role,
    capabilities: marketingCapabilities(role),
    pendingInvitation:
      invite && expiresAt !== null && expiresAt > Date.now()
        ? { role: invite.role, expiresAt } : null,
  };
}

export function requireEditableDraft(
  access: { role: MarketingRole | "admin" | null },
  existing: { status: string } | null,
) {
  if (access.role === "marketer" && existing && existing.status !== "draft")
    throw new Error("Marketers may edit drafts only");
}
