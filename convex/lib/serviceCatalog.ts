import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function publicService(service: Doc<"services">) {
  return {
    slug: service.slug,
    name: service.name,
    description: service.description.slice(0, 1000),
    category: service.category,
    durationMin: service.durationMin,
    price: service.price,
    currency: service.currency,
    ...(service.imageUrl ? { imageUrl: service.imageUrl } : {}),
  };
}

export function catalogFilter(value?: string): string | undefined {
  const text = value?.trim();
  if (text && text.length > 100) throw new Error("Search is too long");
  return text || undefined;
}

export function catalogCategory(value?: string): string | undefined {
  return value?.trim() || undefined;
}

export function serviceQuery(
  ctx: QueryCtx,
  args: { category?: string; query?: string },
) {
  const category = catalogCategory(args.category);
  const query = catalogFilter(args.query);
  if (query)
    return ctx.db.query("services").withSearchIndex("search_name", (q) => {
      const search = q.search("name", query).eq("status", "active");
      return category ? search.eq("category", category) : search;
    });
  return ctx.db
    .query("services")
    .withIndex("by_status_and_category", (q) =>
      category
        ? q.eq("status", "active").eq("category", category)
        : q.eq("status", "active"),
    );
}

/** Walk distinct indexed categories, skipping whole groups instead of scanning all services. */
export async function serviceCategories(
  ctx: QueryCtx,
  limit: number,
  after?: string,
) {
  const categories: Array<{ name: string; imageUrl?: string }> = [];
  let previous = after;
  for (let index = 0; index <= limit; index++) {
    const service = await ctx.db
      .query("services")
      .withIndex("by_status_and_category", (q) =>
        previous === undefined
          ? q.eq("status", "active")
          : q.eq("status", "active").gt("category", previous),
      )
      .first();
    if (!service) return { categories, nextCategory: null };
    if (index === limit) return { categories, nextCategory: previous ?? null };
    categories.push({
      name: service.category,
      ...(service.imageUrl ? { imageUrl: service.imageUrl } : {}),
    });
    previous = service.category;
  }
  return { categories, nextCategory: null };
}
