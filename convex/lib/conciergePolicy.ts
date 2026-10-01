import type { EffectiveSettings } from './siteSettings';

export function replyLocale(message: string): 'en' | 'th' | 'ko' {
	if (/[\u0E00-\u0E7F]/.test(message)) return 'th';
	if (/[\uAC00-\uD7AF]/.test(message)) return 'ko';
	return 'en';
}

export function requiresLiveFacts(message: string) {
	return /\b(price|pricing|cost|rates?|nightly|discount|guests?|cancellation|refund|policy|availability|available|book|booking|reservation|cancel|check[ -]?in|check[ -]?out|services?|spa|massage|duration|capacity|bedrooms?|bathrooms?)\b|฿|THB|ราคา|ส่วนลด|ว่าง|จอง|ยกเลิก|บริการ|นวด|จำนวนห้อง|เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|요금|가격|예약|취소|서비스|마사지|체크인|체크아웃/iu.test(message);
}

export function isCheckTimeQuestion(message: string) {
	if (!/check[ -]?(?:in|out)|เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|체크인|체크아웃/iu.test(message)) return false;
	const remaining = message.toLowerCase()
		.replace(/check[ -]?(?:in|out)/gu, '')
		.replace(/\b(?:what|which|when|time|times|is|are|the|your|and|please|tell|me|can|you)\b/gu, '')
		.replace(/เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|เวลา|กี่โมง|เมื่อไหร่|ครับ|ค่ะ|คะ|และ|ได้|ตอน|체크아웃|체크인|알려주세요|인가요|시간|몇|시|은|는|과|와|하고/gu, '')
		.replace(/[\s?!.\/,;&-]/gu, '');
	return remaining.length === 0;
}

export function checkTimeReply(message: string, settings: EffectiveSettings) {
	if (!isCheckTimeQuestion(message)) return null;
	const locale = replyLocale(message);
	if (locale === 'th') return `เช็กอินตั้งแต่ ${settings.checkInTime} น. และเช็กเอาต์ภายใน ${settings.checkOutTime} น. ตามเวลา ${settings.timezone} ครับ`;
	if (locale === 'ko') return `체크인은 ${settings.checkInTime}부터, 체크아웃은 ${settings.checkOutTime}까지입니다. 시간대는 ${settings.timezone}입니다.`;
	return `Check-in is from ${settings.checkInTime}; check-out is by ${settings.checkOutTime} (${settings.timezone}).`;
}

export function capabilityReply(message: string) {
	const locale = replyLocale(message);
	if (/\breschedul|\bmove\b.{0,50}\b(?:booking|appointment|reservation)\b|เลื่อน(?:นัด|เวลา|วัน|จอง)|เปลี่ยน(?:วัน|เวลา).{0,30}(?:จอง|นัด)|예약.{0,30}변경|일정.{0,20}변경/iu.test(message)) {
		return {
			en: 'I cannot reschedule an existing booking in chat yet. Your existing booking has not been changed. Please contact the host to arrange the change.',
			th: 'ตอนนี้ผมยังเลื่อนวันหรือเวลาของการจองเดิมในแชตไม่ได้ครับ การจองเดิมยังไม่ถูกเปลี่ยน กรุณาติดต่อเจ้าหน้าที่เพื่อจัดการเลื่อนนัดครับ',
			ko: '현재 채팅에서는 기존 예약의 일정을 변경할 수 없습니다. 기존 예약은 변경되지 않았습니다. 변경은 담당자에게 문의해 주세요.'
		}[locale];
	}
	if (/(?:write|generate|create|debug).{0,50}(?:python|javascript|script|code)|(?:python|javascript).{0,30}(?:script|code)|(?:เขียน|สร้าง|แก้).{0,20}(?:โค้ด|โปรแกรม|สคริปต์)|(?:코드|스크립트).{0,20}(?:작성|만들)/iu.test(message)) {
		return {
			en: 'I can help with villas, services, pricing, availability, bookings, and tours. Which of those would you like help with?',
			th: 'ผมช่วยเรื่องวิลล่า บริการ ราคา วันว่าง การจอง และทัวร์ได้ครับ ต้องการให้ช่วยเรื่องไหนครับ?',
			ko: '빌라, 서비스, 가격, 예약 가능 여부, 예약 및 투어를 도와드릴 수 있습니다. 어떤 도움이 필요하신가요?'
		}[locale];
	}
	return null;
}

export function isGuestConfirmation(message: string) {
	return /^(?:(?:yes|yeah|yep|ok(?:ay)?)(?:[\s,]+(?:please|confirm(?: it| the booking)?|cancel it))?|confirm(?: it| the booking)?|please confirm|(?:ใช่|ยืนยัน|ตกลง)(?:\s*(?:ครับ|ค่ะ))?|(?:네|예|확인)(?:해 주세요|합니다)?)[\s.!]*$/iu.test(message.trim());
}

export function isCancellationPolicyQuestion(message: string) {
	return /^(?:(?:what(?: is|'s)|tell me|explain)\s+)?(?:(?:the|your)\s+)?cancellation policy[\s?!.]*$|^(?:นโยบายยกเลิก|นโยบายการยกเลิก)(?:เป็นยังไง|คืออะไร|ครับ|ค่ะ|\s|[?!.])*$|^취소\s*정책(?:은|이|을|\s|무엇인가요|알려주세요|[?!.])*$/iu.test(message.trim());
}

export function cancellationPolicyReply(message: string, settings: EffectiveSettings) {
	if (!isCancellationPolicyQuestion(message)) return null;
	return settings.cancellationPolicy || { en: 'Please ask the host for the current cancellation policy.', th: 'กรุณาสอบถามนโยบายยกเลิกล่าสุดกับเจ้าหน้าที่ครับ', ko: '현재 취소 정책은 담당자에게 문의해 주세요.' }[replyLocale(message)];
}

export function isCancellationRequest(message: string) {
	return /cancel|ยกเลิก|취소/iu.test(message) && !/\b(?:no|not|don't|do not|never)\b|ไม่|취소하지|아니/iu.test(message);
}

export function toolFailureReply(message: string) {
	return {
		en: 'I could not verify the result of that request. Please check your booking status with the host before trying again.',
		th: 'ผมยังยืนยันผลคำขอนี้ไม่ได้ครับ กรุณาตรวจสถานะการจองกับเจ้าหน้าที่ก่อนลองอีกครั้งครับ',
		ko: '요청 결과를 확인할 수 없습니다. 다시 시도하기 전에 담당자에게 예약 상태를 확인해 주세요.'
	}[replyLocale(message)];
}

/** Only committed tool results may supply transaction acknowledgements. */
export function committedReply(name: string, result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false) return null;
	const locale = replyLocale(message);
	if (name === 'confirm_booking' && typeof result.confirmationCode === 'string' && typeof result.total === 'number') {
		const title = { en: result.status === 'paid' ? 'Villa booking confirmed; payment received.' : 'Villa booking created; payment is pending.', th: result.status === 'paid' ? 'ยืนยันการจองวิลล่าแล้วครับ ชำระเงินแล้ว' : 'สร้างการจองวิลล่าแล้วครับ ยังรอชำระเงิน', ko: result.status === 'paid' ? '빌라 예약이 확정되었습니다. 결제가 완료되었습니다.' : '빌라 예약이 생성되었습니다. 결제 대기 중입니다.' }[locale];
		return `${title}\n${result.confirmationCode}\n${result.property} · ${result.checkIn} → ${result.checkOut}\n${result.guests} guests · ${result.nights} nights\n${result.currency} ${result.total.toLocaleString('en-US')}\n${typeof result.paymentUrl === 'string' ? result.paymentUrl : ''}`.trim();
	}
	if (name === 'confirm_service_booking' && typeof result.confirmationCode === 'string') {
		const title = { en: 'Service booking confirmed. Payment is at the resort.', th: 'ยืนยันการจองบริการแล้วครับ ชำระเงินที่รีสอร์ต', ko: '서비스 예약이 확정되었습니다. 리조트에서 결제해 주세요.' }[locale];
		return `${title}\n${result.confirmationCode}\n${result.service} · ${result.date} ${result.time}\n${result.staff}\n${result.currency} ${Number(result.price).toLocaleString('en-US')}`;
	}
	if (name === 'cancel_booking' && ['cancelled', 'already_cancelled'].includes(String(result.state))) {
		return `${{ en: 'Booking cancelled.', th: 'ยกเลิกการจองแล้วครับ', ko: '예약이 취소되었습니다.' }[locale]}\n${result.reference}`;
	}
	return null;
}

export function proposalReply(name: string, result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false) return null;
	const locale = replyLocale(message);
	const confirm = { en: 'Reply yes to confirm this summary.', th: 'ตอบ “ใช่” เพื่อยืนยันรายละเอียดนี้ครับ', ko: '이 내용을 확인하고 동의하시면 “네”라고 답해 주세요.' }[locale];
	if (name === 'prepare_booking' && typeof result.total === 'number') {
		const title = { en: 'Villa booking proposal — not booked yet.', th: 'รายละเอียดที่เตรียมไว้ ยังไม่ได้สร้างการจองวิลล่าครับ', ko: '빌라 예약 제안입니다. 아직 예약되지 않았습니다.' }[locale];
		return `${title}\n${result.property} · ${result.checkIn} → ${result.checkOut}\n${result.guests} guests · ${result.nights} nights\n${result.currency} ${result.total.toLocaleString('en-US')}\n${confirm}`;
	}
	if (name === 'prepare_service_booking' && typeof result.price === 'number') {
		const title = { en: 'Service booking proposal — not confirmed yet.', th: 'รายละเอียดที่เตรียมไว้ ยังไม่ได้ยืนยันการจองบริการครับ', ko: '서비스 예약 제안입니다. 아직 확정되지 않았습니다.' }[locale];
		return `${title}\n${result.service} · ${result.date} ${result.time}\n${result.durationMin} min · ${result.staff}\n${result.currency} ${result.price.toLocaleString('en-US')}${typeof result.staffPreferenceIgnored === 'string' ? `\n${result.staffPreferenceIgnored}` : ''}\n${confirm}`;
	}
	if (name === 'cancel_booking' && result.state === 'needs_confirmation') {
		const title = { en: 'Cancel this booking? It has not been cancelled yet.', th: 'ต้องการยกเลิกการจองนี้ใช่ไหมครับ ตอนนี้ยังไม่ได้ยกเลิก', ko: '이 예약을 취소할까요? 아직 취소되지 않았습니다.' }[locale];
		return `${title}\n${result.reference}\n${result.service ?? ''} ${result.date ?? result.checkIn ?? ''} ${result.time ?? result.checkOut ?? ''}\n${confirm}`;
	}
	return null;
}

/** Status words and references come directly from owned rows, never model prose. */
export function bookingStatusReply(result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false || !Array.isArray(result.bookings) || !Array.isArray(result.services)) return null;
	const rows = [...result.bookings, ...result.services] as Record<string, unknown>[];
	const title = rows.length
		? { en: 'Your booking records:', th: 'รายการจองของคุณ:', ko: '예약 내역:' }[replyLocale(message)]
		: { en: 'No booking records were found for this guest.', th: 'ไม่พบรายการจองของผู้เข้าพักนี้ครับ', ko: '이 고객의 예약 내역이 없습니다.' }[replyLocale(message)];
	return [title, ...rows.map(row => [row.reference, row.property ?? row.service, row.date ?? row.checkIn, row.time ?? row.checkOut, `status: ${row.status}`, ...(row.paymentStatus ? [`payment: ${row.paymentStatus}`] : []), ...(typeof row.total === 'number' ? [`${row.currency} ${row.total.toLocaleString('en-US')}`] : []), ...(typeof row.paymentUrl === 'string' ? [row.paymentUrl] : [])].join(' · '))].join('\n');
}


/** Detect positive completion assertions, preserving guidance and honest negatives. */
export function hasTransactionCompletionClaim(content: string) {
	return content.split(/[.!?;\n]+|\b(?:but|and)\b|แต่|และ|하지만/iu).some(clause => {
		if (/(?:^|[,])\s*(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|success)\s*$|\b(?:is|are|was|were|has|have|already|successfully|now|just)\s+(?:been\s+)?(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|created)\b|\b(?:I|we)\s+(?:booked|confirmed|cancelled|canceled|rescheduled|refunded)\b|\b(?:booking|reservation|appointment|payment)\s+(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|created)\b/iu.test(clause)) return true;
		return !/ไม่|ยังไม่|않|아직/iu.test(clause) && /ยืนยัน.*แล้ว|จอง.*แล้ว|ยกเลิก.*แล้ว|예약.*(?:완료|확정되었습니다)|취소.*(?:완료|되었습니다)/iu.test(clause);
	});
}
