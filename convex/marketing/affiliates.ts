import { v } from 'convex/values';
import { marketingQuery } from '../auth/model';
import { creditState } from '../lib/affiliateTypes';
import { canReadMarketingPersonalData, withMarketingReasonPrivacy, withoutPartnerPersonalData } from '../lib/marketingPrivacy';
import type { AffiliateRow } from '../shared/marketingAffiliateTypes';
import { AFFILIATE_LIMIT, LIMIT, SUMMARY_LIMIT, creditRow } from './affiliateRead';

export const listAffiliates = marketingQuery({
  permission: "view",
  args: {},
  handler: async (ctx) => {
    const access = ctx.marketing;
    const all = await ctx.db
      .query("marketingAffiliates")
      .take(AFFILIATE_LIMIT + 1);
    const rows: AffiliateRow[] = await Promise.all(
      all.slice(0, AFFILIATE_LIMIT).map(async (row) => {
        const [link, campaign, coupons, credits] = await Promise.all([
          row.canonicalLinkId ? ctx.db.get(row.canonicalLinkId) : null,
          ctx.db.get(row.campaignId),
          ctx.db
            .query("coupons")
            .withIndex("by_affiliateId", (q) => q.eq("affiliateId", row._id))
            .take(SUMMARY_LIMIT + 1),
          ctx.db
            .query("affiliateCredits")
            .withIndex("by_affiliateId_and_state", (q) =>
              q.eq("affiliateId", row._id),
            )
            .take(SUMMARY_LIMIT + 1),
        ]);
        const summary = {
          pending: 0,
          approved: 0,
          rejected: 0,
          reversed: 0,
          approvedNet: 0,
          partial:
            credits.length > SUMMARY_LIMIT || coupons.length > SUMMARY_LIMIT,
        };
        for (const credit of credits.slice(0, SUMMARY_LIMIT)) {
          summary[credit.state]++;
          summary.approvedNet += credit.approvedNet;
        }
        return {
          ...(canReadMarketingPersonalData(access) ? row : withoutPartnerPersonalData(row)),
          canonicalPath: `/r/${row.slug}`,
          linkStatus: link?.status ?? null,
          campaignName: campaign?.name ?? "",
          coupons: coupons
            .slice(0, SUMMARY_LIMIT)
            .map((c) => ({ _id: c._id, code: c.code })),
          summary,
        };
      }),
    );
    return { rows, partial: all.length > AFFILIATE_LIMIT };
  },
});

export const listCredits = marketingQuery({
  permission: "view",
  args: {
    affiliateId: v.optional(v.id("marketingAffiliates")),
    state: v.optional(creditState),
  },
  handler: async (ctx, args) => {
    const access = ctx.marketing;
    const all = args.affiliateId
      ? await ctx.db
          .query("affiliateCredits")
          .withIndex("by_affiliateId_and_state", (q) =>
            args.state
              ? q.eq("affiliateId", args.affiliateId).eq("state", args.state)
              : q.eq("affiliateId", args.affiliateId),
          )
          .order("desc")
          .take(LIMIT + 1)
      : await ctx.db
          .query("affiliateCredits")
          .withIndex("by_state", (q) =>
            args.state ? q.eq("state", args.state) : q,
          )
          .order("desc")
          .take(LIMIT + 1);
    return {
      rows: await Promise.all(
        all.slice(0, LIMIT).map((row) => creditRow(ctx, row, canReadMarketingPersonalData(access))),
      ),
      partial: all.length > LIMIT,
    };
  },
});

export const getCredit = marketingQuery({
  permission: "view",
  args: { creditId: v.id("affiliateCredits") },
  handler: async (ctx, args) => {
    const access = ctx.marketing;
    const row = await ctx.db.get(args.creditId);
    if (!row) return null;
    const history = await ctx.db
      .query("affiliateCreditChanges")
      .withIndex("by_creditId_and_revision", (q) => q.eq("creditId", row._id))
      .order("desc")
      .take(LIMIT + 1);
    return {
      credit: await creditRow(ctx, row, canReadMarketingPersonalData(access)),
      history: history.slice(0, LIMIT).map(change => withMarketingReasonPrivacy(change, canReadMarketingPersonalData(access))),
      partial: history.length > LIMIT,
    };
  },
});
