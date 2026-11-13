import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { affiliateState } from '../../lib/affiliateTypes';
import { appendRecordHistory } from '../../settings/model';

export const setAffiliateStatus = marketingMutation({
  permission: "partners",
  args: { affiliateId: v.id("marketingAffiliates"), status: affiliateState },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const row = await ctx.db.get(args.affiliateId);
    if (!row) throw new ConvexError("Partner not found");
    if (row.status === "archived" && args.status !== "archived")
      throw new ConvexError("Archived partners cannot reopen");
    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: Date.now(),
      updatedByEmail: actor.email,
    });
    // Keep every existing alias safe when the partner is disabled. Activation is deliberate per additional alias.
    const links = await ctx.db
      .query("marketingLinks")
      .withIndex("by_affiliateId", (q) => q.eq("affiliateId", row._id))
      .take(501);
    if (links.length > 500)
      throw new ConvexError("Too many partner aliases to change safely");
    for (const link of links)
      if (args.status !== "active" || link._id === row.canonicalLinkId)
        await ctx.db.patch(link._id, {
          status: args.status,
          updatedAt: Date.now(),
          updatedByEmail: actor.email,
        });
    await appendRecordHistory(ctx, {
      entityType: "marketingAffiliate",
      entityId: row._id,
      actor: actor.email,
      kind: "status_changed",
      before: { status: row.status },
      after: { status: args.status },
    });
    return null;
  },
});
