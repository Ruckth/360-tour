import { ConvexError, v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { affiliateState, creditState } from "./lib/affiliateTypes";
import { requireMarketingPermission } from "./lib/marketingAccess";
import {
  appendCreditChange,
  creditMoney,
  syncAffiliateCredit,
} from "./lib/affiliateCredits";
import { appendRecordHistory } from "./lib/recordHistory";
import { isIsoDate } from "./lib/dates";
import { canReadMarketingPersonalData, withoutContactEmail, withMarketingReasonPrivacy } from "./lib/marketingPrivacy";
const LIMIT = 200;
const AFFILIATE_LIMIT = 50;
const SUMMARY_LIMIT = 50;
export type AffiliateRow = Doc<"marketingAffiliates"> & {
  canonicalPath: string;
  linkStatus: Doc<"marketingLinks">["status"] | null;
  campaignName: string;
  coupons: { _id: Id<"coupons">; code: string }[];
  summary: {
    pending: number;
    approved: number;
    rejected: number;
    reversed: number;
    approvedNet: number;
    partial: boolean;
  };
};
export type CreditRow = Omit<Doc<"affiliateCredits">, "reason"> & {
  reason?: string | null;
  reasonHidden?: boolean;
  label: string;
  ref: string;
  candidates: Doc<"affiliateCredits">["snapshot"]["candidates"];
  flags: string[];
  affiliateName: string | null;
};
async function creditRow(
  ctx: QueryCtx,
  row: Doc<"affiliateCredits">,
  fullDetail: boolean,
): Promise<CreditRow> {
  const booking = row.bookingId ? await ctx.db.get(row.bookingId) : null;
  const order = row.billId ? await ctx.db.get(row.billId) : null;
  const partner = row.affiliateId ? await ctx.db.get(row.affiliateId) : null;
  const candidates = fullDetail ? row.snapshot.candidates : row.snapshot.candidates.map(withoutContactEmail);
  return {
    ...withMarketingReasonPrivacy(row, fullDetail),
    snapshot: { ...row.snapshot, candidates },
    label: !fullDetail ? "Guest" :
      booking?.guestName ??
      order?.customerSnapshot?.name ??
      order?.guestName ??
      "Walk-in",
    ref:
      (!fullDetail && booking ? "Booking" : booking?.confirmationCode) ??
      (order ? `Order #${order.orderNumber}` : "Booking"),
    candidates,
    flags: row.snapshot.flags,
    affiliateName: partner?.name ?? null,
  };
}
export const listAffiliates = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireMarketingPermission(ctx, "view");
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
          ...(canReadMarketingPersonalData(access) ? row : withoutContactEmail(row)),
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
export const saveAffiliate = mutation({
  args: {
    id: v.optional(v.id("marketingAffiliates")),
    name: v.string(),
    slug: v.string(),
    campaignId: v.id("marketingCampaigns"),
    contactEmail: v.optional(v.string()),
    propertySlugs: v.optional(v.array(v.string())),
    startsOn: v.optional(v.string()),
    endsOn: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireMarketingPermission(ctx, "partners");
    const { id, ...input } = args;
    const slug = input.slug.trim().toLowerCase();
    const name = input.name.trim();
    const contactEmail = input.contactEmail?.trim().toLowerCase() || undefined;
    if (!name || name.length > 120 || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(slug))
      throw new ConvexError(
        "Enter a name and a slug of 1–30 lowercase letters, numbers or hyphens",
      );
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
      throw new ConvexError("Enter a valid contact email");
    if (
      (input.startsOn && !isIsoDate(input.startsOn)) ||
      (input.endsOn && !isIsoDate(input.endsOn)) ||
      (input.startsOn && input.endsOn && input.startsOn > input.endsOn)
    )
      throw new ConvexError("Invalid partner dates");
    if (
      (input.propertySlugs?.length ?? 0) > 100 ||
      (input.notes?.length ?? 0) > 4000
    )
      throw new ConvexError("Partner scope or notes too long");
    for (const propertySlug of input.propertySlugs ?? [])
      if (
        !(await ctx.db
          .query("properties")
          .withIndex("by_slug", (q) => q.eq("slug", propertySlug))
          .unique())
      )
        throw new ConvexError("Property not found");
    if (!(await ctx.db.get(args.campaignId)))
      throw new ConvexError("Campaign not found");
    const old = id ? await ctx.db.get(id) : null;
    if (id && !old) throw new ConvexError("Partner not found");
    if (old && old.slug !== slug)
      throw new ConvexError("Partner slug is permanent");
    if (old?.status === "archived")
      throw new ConvexError("Archived partners cannot be edited");
    const taken = await ctx.db
      .query("marketingAffiliates")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (taken && taken._id !== id)
      throw new ConvexError("Partner slug is taken");
    const fields = {
      ...input,
      name,
      slug,
      contactEmail,
      updatedAt: Date.now(),
      updatedByEmail: actor.email,
    };
    if (old && id) {
      await ctx.db.patch(id, fields);
      if (old.canonicalLinkId)
        await ctx.db.patch(old.canonicalLinkId, {
          name,
          campaignId: input.campaignId,
          updatedAt: Date.now(),
          updatedByEmail: actor.email,
        });
      await appendRecordHistory(ctx, {
        entityType: "marketingAffiliate",
        entityId: id,
        actor: actor.email,
        kind: "updated",
        before: {
          name: old.name,
          campaignId: old.campaignId,
          notes: old.notes ?? null,
          contactEmail: old.contactEmail ?? null,
          propertySlugs: old.propertySlugs ?? null,
          startsOn: old.startsOn ?? null,
          endsOn: old.endsOn ?? null,
        },
        after: {
          name,
          campaignId: input.campaignId,
          notes: input.notes ?? null,
          contactEmail: contactEmail ?? null,
          propertySlugs: input.propertySlugs ?? null,
          startsOn: input.startsOn ?? null,
          endsOn: input.endsOn ?? null,
        },
      });
      return id;
    }
    const alias = await ctx.db
      .query("marketingLinks")
      .withIndex("by_slug", (q) => q.eq("slug", `r/${slug}`))
      .unique();
    if (alias) throw new ConvexError("Partner alias is taken");
    const affiliateId = await ctx.db.insert("marketingAffiliates", {
      ...fields,
      status: "paused",
      createdAt: Date.now(),
    });
    const canonicalLinkId = await ctx.db.insert("marketingLinks", {
      slug: `r/${slug}`,
      name,
      campaignId: input.campaignId,
      affiliateId,
      destination: { kind: "booking" },
      entry: "link",
      status: "draft",
      opens: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedByEmail: actor.email,
    });
    await ctx.db.patch(affiliateId, { canonicalLinkId });
    await appendRecordHistory(ctx, {
      entityType: "marketingAffiliate",
      entityId: affiliateId,
      actor: actor.email,
      kind: "created",
      after: {
        name,
        slug,
        campaignId: input.campaignId,
        contactEmail: contactEmail ?? null,
        propertySlugs: input.propertySlugs ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        notes: input.notes ?? null,
      },
    });
    return affiliateId;
  },
});
export const setAffiliateStatus = mutation({
  args: { affiliateId: v.id("marketingAffiliates"), status: affiliateState },
  handler: async (ctx, args) => {
    const actor = await requireMarketingPermission(ctx, "partners");
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
export const assignCoupon = mutation({
  args: {
    affiliateId: v.id("marketingAffiliates"),
    couponId: v.union(v.id("coupons"), v.null()),
  },
  handler: async (ctx, args) => {
    const actor = await requireMarketingPermission(ctx, "partners");
    const partner = await ctx.db.get(args.affiliateId);
    if (!partner || partner.status === "archived")
      throw new ConvexError("Partner unavailable");
    if (args.couponId) {
      const coupon = await ctx.db.get(args.couponId);
      if (!coupon) throw new ConvexError("Coupon not found");
      if (coupon.affiliateId && coupon.affiliateId !== partner._id)
        throw new ConvexError("Coupon already belongs to another partner");
      await ctx.db.patch(coupon._id, {
        affiliateId: partner._id,
        updatedAt: Date.now(),
        updatedByEmail: actor.email,
      });
      await appendRecordHistory(ctx, {
        entityType: "coupon",
        entityId: coupon._id,
        actor: actor.email,
        kind: "affiliate_assigned",
        after: { affiliate: partner.name },
      });
    } else {
      const coupons = await ctx.db
        .query("coupons")
        .withIndex("by_affiliateId", (q) => q.eq("affiliateId", partner._id))
        .take(201);
      if (coupons.length > 200)
        throw new ConvexError("Too many coupons to unassign");
      for (const coupon of coupons) {
        await ctx.db.patch(coupon._id, {
          affiliateId: undefined,
          updatedAt: Date.now(),
          updatedByEmail: actor.email,
        });
        await appendRecordHistory(ctx, {
          entityType: "coupon",
          entityId: coupon._id,
          actor: actor.email,
          kind: "affiliate_unassigned",
          before: { affiliate: partner.name },
          after: { affiliate: null },
        });
      }
    }
    return null;
  },
});
export const listCredits = query({
  args: {
    affiliateId: v.optional(v.id("marketingAffiliates")),
    state: v.optional(creditState),
  },
  handler: async (ctx, args) => {
    const access = await requireMarketingPermission(ctx, "view");
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
export const getCredit = query({
  args: { creditId: v.id("affiliateCredits") },
  handler: async (ctx, args) => {
    const access = await requireMarketingPermission(ctx, "view");
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
export const refreshCredit = mutation({
  args: { creditId: v.id("affiliateCredits") },
  handler: async (ctx, args) => {
    const actor = await requireMarketingPermission(ctx, "reviewCredits");
    const row = await ctx.db.get(args.creditId);
    if (!row) throw new ConvexError("Credit not found");
    await syncAffiliateCredit(
      ctx,
      row.bookingId ? { bookingId: row.bookingId } : { billId: row.billId! },
      actor.email,
    );
    return null;
  },
});
export const reviewCredit = mutation({
  args: {
    creditId: v.id("affiliateCredits"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string(),
    expectedRevision: v.number(),
    affiliateId: v.optional(v.id("marketingAffiliates")),
  },
  handler: async (ctx, args) => {
    const actor = await requireMarketingPermission(ctx, "reviewCredits");
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
