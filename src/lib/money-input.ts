import { bahtToSatang } from 'convex/shared/money';
/** Human form text is baht (or percent); drafts stay invalid until they parse to two decimals. */
export function parseMoneyInput(text: string): number {
  if (!/^\d*(?:\.\d{0,2})?$/.test(text) || !text || text === '.') return NaN;
  const value = Number(text);
  if (!Number.isFinite(value)) return NaN;
  try { return bahtToSatang(value); } catch { return NaN; }
}
