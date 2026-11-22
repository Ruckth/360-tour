import type { PageSearch } from "@/lib/page-search";

export type ServicesQuery = { category?: string; query?: string; cursor?: string; categoryAfter?: string };

/** `/services` filters. Only single string values are honored; repeated parameters are ignored. */
export function servicesQuery(params: PageSearch): ServicesQuery {
  const param = (key: string, max = 100) => {
    const value = params[key];
    return typeof value === "string" ? value.slice(0, max) : undefined;
  };
  return {
    category: param("category", 10000),
    query: param("q"),
    cursor: param("cursor", 10000),
    categoryAfter: param("categoryAfter", 10000),
  };
}
