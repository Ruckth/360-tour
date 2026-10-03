import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { factRetrievalEnabled } from "./lib/factRetrieval";
import { requireAdmin } from "./lib/adminAuth";

const status = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("archived"),
);

function text(value: string, label: string, limit: number) {
  const clean = value.trim();
  if (!clean || clean.length > limit)
    throw new Error(`${label} must contain 1–${limit} characters`);
  return clean;
}

export const adminList = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(status) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = args.status
      ? ctx.db
          .query("businessFacts")
          .withIndex("by_status_and_updatedAt", (q) =>
            q.eq("status", args.status!),
          )
      : ctx.db.query("businessFacts");
    return await rows.order("desc").paginate(args.paginationOpts);
  },
});

export const adminMissing = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.union(
      v.literal("new"),
      v.literal("resolved"),
      v.literal("ignored"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("chatUnknownQuestions")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", args.status))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const adminSetMissingStatus = mutation({
  args: {
    unknownId: v.id("chatUnknownQuestions"),
    status: v.union(v.literal("new"), v.literal("ignored")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(args.unknownId)))
      throw new Error("Missing-information report not found");
    await ctx.db.patch(args.unknownId, {
      status: args.status,
      updatedAt: Date.now(),
      ignoredAt: args.status === "ignored" ? Date.now() : undefined,
      resolvedAt: undefined,
      resolvedFactId: undefined,
      resolvedAnswerId: undefined,
      resolvedQuestionId: undefined,
    });
  },
});

export const adminApprovedOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (
      await ctx.db
        .query("businessFacts")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "approved"))
        .order("desc")
        .take(100)
    ).map((fact) => ({
      factId: fact._id,
      title: fact.title,
      propertyId: fact.propertyId,
    }));
  },
});

export const adminResolveMissing = mutation({
  args: {
    unknownId: v.id("chatUnknownQuestions"),
    factId: v.id("businessFacts"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const unknown = await ctx.db.get(args.unknownId);
    const fact = await ctx.db.get(args.factId);
    if (!unknown || !fact || fact.status !== "approved")
      throw new Error("Choose an approved fact");
    if (fact.propertyId && unknown.propertyId !== fact.propertyId)
      throw new Error("The fact must apply to the reported property");
    await ctx.db.patch(unknown._id, {
      status: "resolved",
      resolvedFactId: fact._id,
      resolvedAnswerId: undefined,
      resolvedQuestionId: undefined,
      ignoredAt: undefined,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const adminSave = mutation({
  args: {
    factId: v.optional(v.id("businessFacts")),
    expectedRevision: v.optional(v.number()),
    title: v.string(),
    body: v.string(),
    searchText: v.string(),
    source: v.string(),
    propertyId: v.optional(v.id("properties")),
    status,
    unknownQuestionId: v.optional(v.id("chatUnknownQuestions")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const existing = args.factId ? await ctx.db.get(args.factId) : null;
    if (args.factId && !existing) throw new Error("Fact not found");
    if (existing && args.expectedRevision !== existing.revision)
      throw new Error("This fact changed. Reload before saving.");
    if (args.propertyId) {
      const property = await ctx.db.get(args.propertyId);
      if (
        !property ||
        (args.status !== "archived" && property.status !== "active")
      )
        throw new Error("Choose an active property");
    }
    const fields = {
      title: text(args.title, "Title", 160),
      body: text(args.body, "Fact", 2400),
      searchText: text(args.searchText, "English search terms", 1200),
      source: text(args.source, "Source", 500),
      propertyId: args.propertyId,
      status: args.status,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      updatedByAdminEmail: admin.email,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    const factId =
      existing?._id ??
      (await ctx.db.insert("businessFacts", {
        ...fields,
        createdAt: Date.now(),
        createdByAdminEmail: admin.email,
      }));
    if (args.unknownQuestionId) {
      const unknown = await ctx.db.get(args.unknownQuestionId);
      if (!unknown) throw new Error("Missing-information report not found");
      if (args.status !== "approved")
        throw new Error(
          "Approve the fact before resolving missing information",
        );
      if (args.propertyId && unknown.propertyId !== args.propertyId)
        throw new Error("The fact must apply to the reported property");
      await ctx.db.patch(unknown._id, {
        status: "resolved",
        resolvedFactId: factId,
        resolvedAnswerId: undefined,
        resolvedQuestionId: undefined,
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
        ignoredAt: undefined,
      });
    }
    return factId;
  },
});

/** Session authorization and real property scope are resolved server-side, never from a user ID. */
export const search = internalQuery({
  args: {
    sessionId: v.id("chatSessions"),
    query: v.string(),
    propertySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.aiPaused) throw new Error("No active AI session");
    if (!factRetrievalEnabled(args.sessionId))
      return { facts: [], noMatch: true };
    const queryText = text(args.query, "Search query", 500);
    const terms =
      queryText
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((term) => term.length <= 32)
        .slice(0, 16)
        .join(" ") ?? "";
    if (!terms) return { facts: [], noMatch: true };
    const slug = args.propertySlug ?? session.propertySlug;
    const property = slug
      ? await ctx.db
          .query("properties")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique()
      : null;
    if (slug && (!property || property.status !== "active"))
      throw new Error("Unknown active property");
    const scoped = property
      ? await ctx.db
          .query("businessFacts")
          .withSearchIndex("search_text", (q) =>
            q
              .search("searchText", terms)
              .eq("status", "approved")
              .eq("propertyId", property._id),
          )
          .take(6)
      : [];
    const global = await ctx.db
      .query("businessFacts")
      .withSearchIndex("search_text", (q) =>
        q
          .search("searchText", terms)
          .eq("status", "approved")
          .eq("propertyId", undefined),
      )
      .take(6);
    // Property facts override global facts on the same maintained subject (title).
    const subjects = new Set(
      scoped.map((fact) => fact.title.trim().toLowerCase()),
    );
    const selected: Doc<"businessFacts">[] = [
      ...scoped,
      ...global.filter(
        (fact) => !subjects.has(fact.title.trim().toLowerCase()),
      ),
    ].slice(0, 6);
    let remaining = 8000; // Conservative character cap in addition to bounded rows/body size.
    const facts = selected.flatMap((fact) => {
      const size = fact.title.length + fact.body.length + fact.source.length;
      if (size > remaining) return [];
      remaining -= size;
      return [
        {
          factId: fact._id,
          title: fact.title,
          body: fact.body,
          source: fact.source,
          revision: fact.revision,
          updatedAt: fact.updatedAt,
          propertySlug: fact.propertyId ? property?.slug : null,
        },
      ];
    });
    return { facts, noMatch: facts.length === 0 };
  },
});
