/** Services by category, both A→Z. */
export function groupServices<T extends { name: string; category: string }>(services: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const service of services) {
    const category = service.category.trim() || "Other";
    const items = groups.get(category);
    if (items) items.push(service);
    else groups.set(category, [service]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([category, items]) =>
        [category, items.sort((a, b) => a.name.localeCompare(b.name))] as const,
    );
}

export { matchPickerSearch as matchServiceSearch } from "./picker";
