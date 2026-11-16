import { bahtToSatang } from 'convex/shared/money';
/** Human form text is baht (or percent); drafts stay invalid until they parse to two decimals. */
export function parseMoneyInput(text: string): number {
  const trimmed = text.trim();
  // Accept conventional thousands groups when staff paste a formatted amount.
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d{0,2})?$/.test(trimmed) || !trimmed || trimmed === '.') return NaN;
  const value = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(value)) return NaN;
  try { return bahtToSatang(value); } catch { return NaN; }
}
