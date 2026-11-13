import { ConvexError, v } from 'convex/values';
import { authenticatedMutation, marketingMutation, marketingQuery, publicQuery } from '../auth/model';
import { adminEmails } from '../lib/adminEmails';
import { marketingRole } from '../shared/affiliateTypes';
import { MARKETING_INVITATION_TTL_MS } from '../shared/marketingPolicy';
import { appendRecordHistory } from '../settings/model';
import { marketingAccess, marketingInvitationExpired, marketingInvitationExpiry } from './accessPolicy';

export const current = publicQuery({
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
      throw new Error("No unclaimed invitation");
    if (marketingInvitationExpired(invite)) throw new ConvexError("Invitation expired. Ask an administrator to renew the invitation.");
    await ctx.db.patch(invite._id, {
      tokenIdentifier: identity.tokenIdentifier,
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

export const listGrants = marketingQuery({
  permission: "manageAccess",
  args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("marketingGrants").take(500);
    const now = Date.now();
    return grants.map(grant => ({
      ...grant,
      expiresAt: marketingInvitationExpiry(grant),
      expired: marketingInvitationExpired(grant, now),
    }));
  },
});

export const setGrant = marketingMutation({
  permission: "manageAccess",
  args: { email: v.string(), role: v.union(marketingRole, v.null()) },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new Error("Enter a valid email");
    if (adminEmails().has(email)) throw new ConvexError("System administrator access is managed through ADMIN_EMAILS, not Marketing invitations.");
    const old = await ctx.db
      .query("marketingGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
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
    const fields = {
      email,
      role: args.role,
      ...(!old?.tokenIdentifier ? { inviteExpiresAt: Date.now() + MARKETING_INVITATION_TTL_MS } : {}),
      updatedAt: Date.now(),
      updatedByEmail: actor.email,
    };
    const id = old
      ? old._id
      : await ctx.db.insert("marketingGrants", {
          ...fields,
          createdAt: Date.now(),
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
