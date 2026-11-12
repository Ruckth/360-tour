export { chatCouponSummary, unverifiedCouponReply } from '../concierge/copy';
/** Deterministic coupon wording for tool replies; prices never come from model prose. */


export function mentionsCoupon(message: string) {
  return /\b(?:coupon|(?:promo(?:tion)?|discount)\s*code|code\s*promo|voucher|codice\s*(?:sconto|promozionale))\b|คูปอง|โค้ด|쿠폰|优惠码|優惠碼|クーポン|Gutschein|cupón|купон|промокод|कूपन/iu.test(message);
}



export type DirectOfferEvidence = { percents: Set<number>; savings: Set<number> };

/** Only successful pricing tools can justify numeric direct-offer claims in model prose. */
export function rememberDirectOffer(name: string, result: Record<string, unknown>, evidence: DirectOfferEvidence) {
  if (!['calculate_price', 'check_availability', 'get_property_details', 'list_properties'].includes(name)) return;
  const numbers = (row: Record<string, unknown>) => {
    if (typeof row.discountPercent === 'number') evidence.percents.add(row.discountPercent);
    if (typeof row.discountAmount === 'number') evidence.savings.add(row.discountAmount);
    if (typeof row.maxSavings === 'number') evidence.savings.add(row.maxSavings);
    const nights = typeof row.nights === 'number' ? row.nights : 1;
    const listed = typeof row.listedTotal === 'number' ? row.listedTotal : typeof row.pricePerNight === 'number' ? row.pricePerNight * nights : undefined;
    const direct = typeof row.directTotal === 'number' ? row.directTotal : typeof row.totalDirect === 'number' ? row.totalDirect : row.directPrice;
    if (listed && typeof direct === 'number') {
      evidence.savings.add(listed - direct);
      evidence.percents.add(Math.round((listed - direct) / listed * 100 * 100) / 100);
    }
  };
  numbers(result);
  if (Array.isArray(result.properties)) for (const row of result.properties) {
    if (row && typeof row === 'object' && !Array.isArray(row)) numbers(row as Record<string, unknown>);
  }
}

/** Coupon proposals short-circuit to owned replies. Any remaining code instruction is unverified. */
export function hasUnverifiedOfferClaim(message: string, content: string, evidence: DirectOfferEvidence) {
  const promotionContext = /\b(?:deals?|discounts?|offers?|promos?|promotions?|savings?)\b|ส่วนลด|โปรโมชัน|할인/iu.test(message);
  const redemptionContext = /\b(?:checkout|redeem|discount|off|saving|save)\b|ชำระเงิน|ส่วนลด|할인/iu.test(content);
  const codeInstructions = /\b(?:use|enter|apply|redeem|type)\s+(?:(?:the|code)\s+)*["'`“”]?([a-z0-9][a-z0-9-]{2,31})(?![a-z0-9-])/giu;
  const ordinary = new Set(['THE', 'OUR', 'YOUR', 'WEBSITE', 'BOOKING', 'DIRECT', 'ONLINE', 'LINE', 'WHATSAPP', 'FACEBOOK', 'THB', 'USD']);
  for (const match of content.matchAll(codeInstructions)) {
    const raw = match[1];
    if (!ordinary.has(raw.toUpperCase()) && (promotionContext || redemptionContext)
      && (raw === raw.toUpperCase() || /\d/u.test(raw) || /\bcheckout\b/iu.test(content))) return true;
  }
  const discountContext = /\b(?:off|discounts?|save|saves|saving|savings|deal|offer|promotion)\b|ส่วนลด|ประหยัด|ลดราคา|할인/iu.test(content);
  if (!discountContext) return false;
  if (!evidence.percents.size && !evidence.savings.size
    && /\b(?:we\s+(?:have|offer)|you\s+(?:get|receive)|enjoy|exclusive|special)\b[^.!?]{0,60}\b(?:deals?|discounts?|offers?|promotions?)\b|\b(?:deals?|discounts?|offers?)\s+(?:(?:are|is)\s+)?available\b/iu.test(content)) return true;
  for (const match of content.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent\b)/giu)) {
    if (!evidence.percents.has(Number(match[1]))) return true;
  }
  for (const match of content.matchAll(/\b(?:save|saves|saving|savings|discount)\s*(?:(?:up to|of|is|about|at least)\s*)?(?:฿\s*|THB\s*|USD\s*|\$\s*)?(\d[\d,]*(?:\.\d+)?)/giu)) {
    if (/^\s*(?:%|percent\b)/iu.test(content.slice(match.index! + match[0].length))) continue;
    if (!evidence.savings.has(Number(match[1].replaceAll(',', '')))) return true;
  }
  for (const match of content.matchAll(/(?:฿\s*|THB\s*|\$\s*)(\d[\d,]*(?:\.\d+)?)\s*(?:off|discount)/giu)) {
    if (!evidence.savings.has(Number(match[1].replaceAll(',', '')))) return true;
  }
  return false;
}
