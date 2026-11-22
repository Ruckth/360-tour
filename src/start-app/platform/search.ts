export function parseUrlSearch(search: string): Record<string, string | string[]> {
  const values = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = values.get(key);
    if (Array.isArray(previous)) previous.push(value);
    else values.set(key, previous === undefined ? value : [previous, value]);
  }
  return Object.fromEntries(values);
}

export function stringifyUrlSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const query = params.toString();
  return query ? "?" + query : "";
}
