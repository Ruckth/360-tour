const TOKEN = /^\s*["'`“”]?([A-Z0-9-]{3,32})(?![A-Z0-9-])/iu;
const LABEL_PROSE = new Set(['CODE', 'CODES', 'PLEASE', 'FOR', 'ANY', 'AVAILABLE', 'VALID', 'WORKS', 'DOES', 'HAVE', 'THERE', 'IS', 'ME', 'US', 'THE']);
const bareCode = (code: string) => /[A-Z]/iu.test(code) && /\d/u.test(code);
const mixedCode = (code: string) => /[A-Z]/iu.test(code) && /[\d-]/u.test(code);

/** Consume the label before parsing its value, so optional `code` cannot backtrack into a value. */
export function extractGuestCouponCode(message: string): string | undefined {
  const labels = /\b(?:coupon|promo(?:tion)?|discount\s+code|voucher)\b|คูปอง|โค้ด(?:ส่วนลด)?|쿠폰(?:\s*코드)?|优惠码|優惠碼|クーポン|Gutschein|cupón|промокод|купон|कूपन/giu;
  let found: string | undefined;
  for (const label of message.matchAll(labels)) {
    const tail = message.slice(label.index! + label[0].length);
    const codeLabel = /^\s+code\b\s*/iu.test(tail);
    const afterLabel = tail.replace(/^\s+code\b\s*/iu, '');
    const declaredValue = /^\s*(?:(?:is|คือ)\b\s*|[:=]\s*)/iu.test(afterLabel);
    const remainder = afterLabel.replace(/^\s*(?:(?:is|คือ)\b\s*|[:=]\s*)/iu, '');
    const match = TOKEN.exec(remainder);
    if (!match || /^\s*(?:%|percent\b)/iu.test(remainder.slice(match[0].length))) continue;
    const raw = match[1];
    const literalSyntax = /^\s*(?:[:=]\s*|["'`“”])/u.test(afterLabel);
    if (LABEL_PROSE.has(raw.toUpperCase()) && !literalSyntax) continue;
    const explicitIntent = !/[?？]/u.test(message) && (codeLabel || label.index === 0
      || /\b(?:use|apply|redeem|enter|my)\s*$/iu.test(message.slice(0, label.index)));
    if (mixedCode(raw) || raw === raw.toUpperCase() || declaredValue || explicitIntent) found = raw.toUpperCase();
  }
  if (found) return found;
  // Bare tokens need a letter plus a digit. Greetings, dates, phones and amounts are ambiguous.
  const explicit = /\b(?:use|apply|redeem|enter|have)\s+["'`“”]?([A-Z0-9-]{3,32})(?![A-Z0-9-])/giu;
  for (const match of message.matchAll(explicit)) if (bareCode(match[1])) found = match[1].toUpperCase();
  if (found) return found;
  const standalone = /^["'`“”]?([A-Z0-9-]{3,32})["'`“”]?[.!]?$/iu.exec(message.trim());
  return standalone && bareCode(standalone[1]) ? standalone[1].toUpperCase() : undefined;
}

export function guestCouponFromHistory(messages: readonly string[]): string | undefined {
  let code: string | undefined;
  for (const message of messages) {
    if (/\b(?:remove|without|no|drop|do not use|don't use)\s+(?:the\s+|a\s+)?(?:coupon|promo(?:tion)?\s*code|discount\s*code)\b|(?:ไม่ใช้|ลบ)\s*(?:คูปอง|โค้ด)|쿠폰\s*없이/iu.test(message)) code = undefined;
    else code = extractGuestCouponCode(message) ?? code;
  }
  return code;
}
