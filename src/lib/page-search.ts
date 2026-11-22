/** Search parameters as Next `searchParams` and the Start router (`parseUrlSearch`) present them. */
export type PageSearch = Record<string, string | string[] | undefined>;

/** The first value of a possibly repeated search parameter. */
export function firstParam(params: PageSearch, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}
