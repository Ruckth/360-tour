import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { appendCreditChange, creditMoney } from '../affiliateCredits';

export const reviewCredit = marketingMutation({
  permission: "reviewCredits",
  args: {
    creditId: v.id("affiliateCredits"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string(),
    expectedRevision: v.number(),
    affiliateId: v.optional(v.id("marketingAffiliates")),
  },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const row = await ctx.db.get(args.creditId);
    if (!row) throw new ConvexError("Credit not found");
    if (row.revision !== args.expectedRevision)
      throw new ConvexError("Credit changed; refresh before reviewing");
    if (row.state !== "pending")
      throw new ConvexError("Only pending credits can be reviewed");
    const reason = args.reason.trim();
    if (!reason || reason.length > 1000)
      throw new ConvexError("Give a decision reason of 1–1000 characters");
    const money = await creditMoney(ctx, row);
    if (money.net !== row.eligibleNet || money.eligible !== row.eligible)
      throw new ConvexError(
        "Sale changed; refresh the credit before reviewing",
      );
    let affiliateId = row.affiliateId;
    if (args.decision === "approved") {
      if (!money.eligible)
        throw new ConvexError("Only eligible settled sales can be approved");
      if (
        row.snapshot.flags.includes("affiliate_conflict") &&
        !args.affiliateId
      )
        throw new ConvexError(
          "Choose the partner explicitly to resolve this conflict",
        );
      affiliateId = args.affiliateId ?? affiliateId;
      const candidate = row.snapshot.candidates.find(
        (c) => c.affiliateId === affiliateId && c.eligible,
      );
      if (!candidate)
        throw new ConvexError("Choose an eligible frozen partner candidate");
      const partner = await ctx.db.get(candidate.affiliateId);
      if (!partner || partner.status === "archived")
        throw new ConvexError("Archived partner cannot receive credit");
    }
    await ctx.db.patch(row._id, {
      state: args.decision,
      affiliateId,
      reason,
      eligible: money.eligible,
      eligibleNet: money.net,
      approvedNet: args.decision === "approved" ? money.net : 0,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    await appendCreditChange(
      ctx,
      (await ctx.db.get(row._id))!,
      actor.email,
      "reviewed",
      reason,
    );
    return null;
  },
});
