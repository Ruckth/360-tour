import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";

async function read<T>(
  operation: (client: ConvexHttpClient) => Promise<T>,
): Promise<T | null> {
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(new ConvexHttpClient(url)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 3000);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function getServiceCatalog(args: {
  category?: string;
  query?: string;
  cursor?: string;
  categoryAfter?: string;
}) {
  return Promise.all([
    read((client) =>
      client.query(api.services.publicServices.categories, {
        ...(args.categoryAfter ? { after: args.categoryAfter } : {}),
      }),
    ),
    read((client) =>
      client.query(api.services.publicServices.list, {
        ...(args.category ? { category: args.category } : {}),
        ...(args.query ? { query: args.query } : {}),
        paginationOpts: { numItems: 20, cursor: args.cursor ?? null },
      }),
    ),
  ]);
}

export function getPublicService(slug: string) {
  return read((client) => client.query(api.services.publicServices.getBySlug, { slug }));
}
