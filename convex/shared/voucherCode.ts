/**
 * Gift voucher codes (v27 D15): "GV", then two groups of four letters or digits, as in GV-7K2M-Q9XD.
 * People type and paste them in any case, with hyphens, spaces or nothing between the groups, so a
 * code is recognised in every one of those spellings. Only the gift slip shows a full code; anything
 * else a guest can see (receipt paper, shared receipt text, the customer display, Show guest)
 * shows its mask, "GV-••••-Q9XD", which keeps the last four characters.
 *
 * A code glued to a word ("giftGV7K2MQ9XD") is still a code: the secret matters more than the rare
 * word with "gv" and eight letters or digits after it. Room numbers, phone numbers, amounts and
 * names never hold "GV" and two groups of four, so they stay as they are.
 */

export const VOUCHER_CODE_PREFIX = 'GV';
const GROUP = '[A-Z0-9]{4}';
// Between groups: nothing, or up to three spaces, hyphens or dashes (‐ ‑ ‒ – — ―), dots or underscores.
const SEPARATOR = '[\\s\\-\\u2010-\\u2015._]{0,3}';
const BODY = `${VOUCHER_CODE_PREFIX}${SEPARATOR}(${GROUP})${SEPARATOR}(${GROUP})`;
/** Recognises a code anywhere in free text. */
const IN_TEXT = new RegExp(BODY, 'gi');
const WHOLE = new RegExp(`^\\s*${BODY}\\s*$`, 'i');

/** "gv 7k2m q9xd" → "GV-7K2M-Q9XD"; null when the text isn't exactly one code. */
export function normalizeVoucherCode(text: string): string | null {
  const match = WHOLE.exec(text);
  return match ? `${VOUCHER_CODE_PREFIX}-${match[1].toUpperCase()}-${match[2].toUpperCase()}` : null;
}

/** The mask of one code: "GV-••••-Q9XD". A value that isn't a code masks to "••••". */
export function voucherCodeMask(code: string): string {
  const normalized = normalizeVoucherCode(code);
  return normalized ? `${VOUCHER_CODE_PREFIX}-••••-${normalized.slice(-4)}` : '••••';
}

/** True when the text holds a full code in any accepted spelling. */
export function containsVoucherCode(text: string): boolean {
  IN_TEXT.lastIndex = 0;
  return IN_TEXT.test(text);
}

/** Every full code in the text becomes its mask; everything else is unchanged. Masking twice changes nothing. */
export function maskVoucherCodes(text: string): string {
  return text.replace(IN_TEXT, (_match, _first: string, last: string) => `${VOUCHER_CODE_PREFIX}-••••-${last.toUpperCase()}`);
}
