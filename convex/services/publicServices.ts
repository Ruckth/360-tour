import { publicServicesCategoriesResult, publicServicesListResult, publicServicesGetBySlugResult } from './validators';
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, publicQuery } from '../auth/model';
import { catalogCategory, catalogFilter, publicService, serviceCategories, serviceQuery } from './private/serviceCatalog';

export const categories = publicQuery({
  returns: publicServicesCategoriesResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
  args: { after: v.optional(v.string()) },
  handler: (ctx, args) =>
    serviceCategories(ctx, 20, catalogCategory(args.after)),
});

export const list = publicQuery({
  returns: publicServicesListResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
  args: {
    category: v.optional(v.string()),
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await serviceQuery(ctx, args).paginate({
      ...args.paginationOpts,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 20)),
    });
    return { ...result, page: result.page.map(publicService) };
  },
});

export const getBySlug = publicQuery({
  returns: publicServicesGetBySlugResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (slug.length > 500) return null;
    const service = await ctx.db
      .query("services")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    return service?.status === "active" ? publicService(service) : null;
  },
});

export const browseForChat = internalQuery({
  args: {
    category: v.optional(v.string()),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const category = catalogCategory(args.category);
    const query = catalogFilter(args.query);
    if (!category && !query) {
      const result = await serviceCategories(ctx, 8);
      return { mode: "categories" as const, ...result, services: [] };
    }
    const limit = args.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5)
      throw new Error("Choose a limit from 1 to 5");
    const services = await serviceQuery(ctx, { category, query }).take(
      limit + 1,
    );
    return {
      mode: "services" as const,
      services: services.slice(0, limit).map(publicService),
      hasMore: services.length > limit,
      ...(category ? { category } : {}),
      ...(query ? { query } : {}),
    };
  },
});
