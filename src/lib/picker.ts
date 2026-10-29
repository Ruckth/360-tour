/** Plain substring match on visible labels and keywords; cmdk's fuzzy default also matched letters of the ID. */
export function matchPickerSearch(
  _value: string,
  search: string,
  keywords?: string[],
) {
  const query = search.trim().toLowerCase();
  return !query ||
    (keywords ?? []).some((word) => word.toLowerCase().includes(query))
    ? 1
    : 0;
}
