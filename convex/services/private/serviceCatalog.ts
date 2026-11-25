import { ConvexError } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { satangToBaht } from '../../shared/money';
import { serviceOptions } from '../../shared/serviceOptions';

type Service = Pick<Doc<'services'>, 'options' | 'durationMin' | 'price'>;

export function findServiceOption(service: Service, durationMin = service.durationMin) {
	return serviceOptions(service).find(option => option.durationMin === durationMin);
}

export function resolveServiceOption(service: Service, durationMin?: number) {
	const option = findServiceOption(service, durationMin);
	if (!option) throw new ConvexError({ code: 'UNKNOWN_DURATION', message: 'This duration is unavailable for the service.' });
	return option;
}

export function assertServicePrice(price: number, currency: string, expectedPrice?: number) {
	if (expectedPrice === undefined || expectedPrice === price) return;
	const amount = satangToBaht(price).toLocaleString('en-US', { maximumFractionDigits: 2 });
	throw new ConvexError({ code: 'SERVICE_PRICE_CHANGED', message: `The price changed to ${currency === 'THB' ? '฿' : `${currency} `}${amount}. Review and try again.` });
}

export function publicService(service: Doc<"services">) {
  return {
    slug: service.slug,
    name: service.name,
    description: service.description.slice(0, 1000),
    category: service.category,
    durationMin: service.durationMin,
    price: service.price,
    options: serviceOptions(service),
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
