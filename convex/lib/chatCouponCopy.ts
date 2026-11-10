/** Deterministic coupon wording for tool replies; prices never come from model prose. */
export function chatCouponSummary(value: unknown, currency: unknown, locale = 'en'): string {
  if (!value || typeof value !== 'object') return '';
  const coupon = value as { code?: string; status?: string; discount?: number; problem?: { code?: string } };
  if (!coupon.code) return '';
  const amount = `${currency} ${Number(coupon.discount ?? 0).toLocaleString('en-US')}`;
  const lang = locale === 'th' || locale === 'ko' ? locale : 'en';
  if (coupon.status === 'applied') return {
    en: `${coupon.code}: save ${amount}. This replaces the direct discount.`,
    th: `${coupon.code}: ประหยัด ${amount} ใช้แทนส่วนลดจองตรงครับ`,
    ko: `${coupon.code}: ${amount} 할인. 직접 예약 할인 대신 적용됩니다.`
  }[lang];
  if (coupon.status === 'coupon_worse') return {
    en: `${coupon.code} not used: the direct price is already better.`,
    th: `ไม่ได้ใช้ ${coupon.code} เพราะราคาจองตรงดีกว่าอยู่แล้วครับ`,
    ko: `${coupon.code} 미적용: 직접 예약 요금이 더 저렴합니다.`
  }[lang];
  const reasons: Record<string, [string, string, string]> = {
    not_found: ['Code not found', 'ไม่พบรหัสนี้', '코드를 찾을 수 없습니다'],
    not_active: ['Code unavailable', 'รหัสยังไม่พร้อมใช้', '현재 사용할 수 없는 코드입니다'],
    not_started: ['Offer has not started', 'โปรโมชันยังไม่เริ่ม', '아직 시작되지 않은 혜택입니다'],
    expired: ['Offer expired', 'โปรโมชันหมดอายุแล้ว', '만료된 혜택입니다'],
    sold_out: ['No uses left', 'สิทธิ์ถูกใช้ครบแล้ว', '사용 한도에 도달했습니다'],
    budget_used: ['Discount budget used', 'งบส่วนลดถูกใช้ครบแล้ว', '할인 예산이 소진되었습니다'],
    wrong_property: ['Code does not apply to this villa', 'รหัสใช้กับวิลล่านี้ไม่ได้', '이 빌라에는 사용할 수 없습니다'],
    stay_outside_dates: ['Stay dates are outside the offer', 'วันเข้าพักอยู่นอกช่วงโปรโมชัน', '숙박일이 혜택 기간에 해당하지 않습니다'],
    min_nights: ['Stay does not meet the minimum nights', 'จำนวนคืนยังไม่ถึงขั้นต่ำ', '최소 숙박일을 충족하지 않습니다'],
    min_subtotal: ['Stay does not meet the minimum spend', 'ยอดเข้าพักยังไม่ถึงขั้นต่ำ', '최소 결제 금액을 충족하지 않습니다'],
    nothing_eligible: ['Code does not apply to accommodation', 'รหัสนี้ใช้กับที่พักไม่ได้', '숙박에 적용되지 않는 코드입니다']
  };
  const reason = (reasons[coupon.problem?.code ?? ''] ?? reasons.not_active)[lang === 'th' ? 1 : lang === 'ko' ? 2 : 0];
  return `${coupon.code}: ${reason}. ${{ en: 'Direct price shown.', th: 'แสดงราคาจองตรงครับ', ko: '직접 예약 요금이 표시됩니다.' }[lang]}`;
}

export function mentionsCoupon(message: string) {
  return /\b(?:coupon|(?:promo(?:tion)?|discount)\s*code|code\s*promo|voucher|codice\s*(?:sconto|promozionale))\b|คูปอง|โค้ด|쿠폰|优惠码|優惠碼|クーポン|Gutschein|cupón|купон|промокод|कूपन/iu.test(message);
}

export function unverifiedCouponReply(locale = 'en') {
  return locale === 'th'
    ? 'กรุณาส่งรหัสคูปอง วิลล่า และวันเข้าพัก เพื่อให้ผมตรวจสิทธิ์และราคาปัจจุบันก่อนยืนยันส่วนลดครับ'
    : locale === 'ko'
      ? '쿠폰 코드, 빌라 및 숙박일을 알려 주세요. 할인을 안내하기 전에 현재 사용 조건과 요금을 확인하겠습니다.'
      : 'Please share your coupon code, villa and stay dates so I can check the current eligibility and price before quoting a saving.';
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
