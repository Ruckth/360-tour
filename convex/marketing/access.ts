import { accessCurrentResult } from './validators';
import { ConvexError, v } from 'convex/values';
import { authenticatedMutation, findStaffGrantByEmail, marketingAccess, marketingMutation, OWNER_MANAGEMENT_MESSAGE, publicQuery } from '../auth/model';
import { marketingRole } from '../shared/affiliateTypes';
import { MARKETING_INVITATION_TTL_MS } from '../shared/marketingPolicy';
import { appendRecordHistory } from '../settings/model';
import { marketingInvitationExpired } from './accessPolicy';

export const current = publicQuery({
  returns: accessCurrentResult,
  reason: "Sign-in bootstrap returns caller access or anonymous capabilities.",
  args: {},
  handler: (ctx) => marketingAccess(ctx),
});

export const claimInvite = authenticatedMutation({
  args: {},
  handler: async (ctx) => {
    const identity = ctx.identity;
    const email = identity?.email?.trim().toLowerCase();
    if (!identity || !email) throw new Error("Not authenticated");
    if (identity.emailVerified !== true) throw new ConvexError("Verify your email before claiming a marketing invitation");
    const existing = await ctx.db
      .query("marketingGrants")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing) return null;
    const invite = await ctx.db
      .query("marketingGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!invite || invite.tokenIdentifier)
      throw new ConvexError("No unclaimed invitation");
    if (marketingInvitationExpired(invite)) throw new ConvexError("Invitation expired. Ask an administrator to renew the invitation.");
    await ctx.db.patch(invite._id, {
      tokenIdentifier: identity.tokenIdentifier,
      revision: (invite.revision ?? 0) + 1,
      updatedAt: Date.now(),
    });
    await appendRecordHistory(ctx, {
      entityType: "marketingGrant",
      entityId: invite._id,
      actor: email,
      kind: "claimed",
      after: { role: invite.role },
    });
    return null;
  },
});

const MARKETING_ACCESS_CHANGED = "Marketing access changed. Review the current role before trying again.";

export const setGrant = marketingMutation({
  permission: "manageAccess",
  args: {
    email: v.string(), role: v.union(marketingRole, v.null()),
    expectedGrant: v.union(v.null(), v.object({ id: v.id("marketingGrants"), revision: v.number() })),
  },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new Error("Enter a valid email");
    if ((await findStaffGrantByEmail(ctx, email))?.role === "owner") throw new ConvexError(OWNER_MANAGEMENT_MESSAGE);
    const old = await ctx.db
      .query("marketingGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const expected = args.expectedGrant;
    if (expected === null && old) throw new ConvexError("This person already has Marketing access or an invitation. Review their Team entry.");
    if (expected && (old?._id !== expected.id || (old.revision ?? 0) !== expected.revision)) throw new ConvexError(MARKETING_ACCESS_CHANGED);
    if (!args.role) {
      if (old) {
        await appendRecordHistory(ctx, {
          entityType: "marketingGrant",
          entityId: old._id,
          actor: actor.email,
          kind: "revoked",
          before: { email, role: old.role },
          after: { role: null },
        });
        await ctx.db.delete(old._id);
      }
      return null;
    }
    const now = Date.now();
    const fields = {
      email,
      role: args.role,
      revision: (old?.revision ?? 0) + 1,
      updatedAt: now,
      updatedByEmail: actor.email,
    };
    const id = old
      ? old._id
      : await ctx.db.insert("marketingGrants", {
          ...fields,
          createdAt: now,
          inviteExpiresAt: now + MARKETING_INVITATION_TTL_MS,
        });
    if (old) await ctx.db.patch(old._id, fields);
    await appendRecordHistory(ctx, {
      entityType: "marketingGrant",
      entityId: id,
      actor: actor.email,
      kind: old ? "updated" : "invited",
      ...(old ? { before: { role: old.role } } : {}),
      after: { email, role: args.role },
    });
    return null;
  },
});

export const renewInvitation = marketingMutation({
  permission: "manageAccess",
  args: { grantId: v.id("marketingGrants"), expectedRevision: v.number() },
  returns: v.null(),
  handler: async (ctx, { grantId, expectedRevision }) => {
    const grant = await ctx.db.get(grantId);
    if (!grant || grant.tokenIdentifier) throw new ConvexError("No unclaimed Marketing invitation");
    if ((grant.revision ?? 0) !== expectedRevision) throw new ConvexError(MARKETING_ACCESS_CHANGED);
    if ((await findStaffGrantByEmail(ctx, grant.email))?.role === "owner") throw new ConvexError(OWNER_MANAGEMENT_MESSAGE);
    const now = Date.now();
    const expiresAt = now + MARKETING_INVITATION_TTL_MS;
    await ctx.db.patch(grantId, { inviteExpiresAt: expiresAt, revision: expectedRevision + 1, updatedAt: now, updatedByEmail: ctx.marketing.email });
    await appendRecordHistory(ctx, { entityType: "marketingGrant", entityId: grantId, actor: ctx.marketing.email, kind: "resend", after: { expiresAt } });
    return null;
  },
});
