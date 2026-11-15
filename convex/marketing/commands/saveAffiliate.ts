import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { isIsoDate } from '../../shared/dates';
import { appendRecordHistory } from '../../settings/model';

export const saveAffiliate = marketingMutation({
  permission: "partners",
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
    const actor = ctx.marketing;
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
