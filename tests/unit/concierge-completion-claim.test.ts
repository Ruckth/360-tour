import { describe, expect, it } from 'vitest';
import { hasTransactionCompletionClaim } from '../../convex/shared/conciergeCopy';

describe('hasTransactionCompletionClaim', () => {
	it.each([
		'Your booking is confirmed!',
		'Booked!',
		'Your booking has been confirmed.',
		'I booked Pool Villa for you.',
		'Great news, your appointment has been rescheduled.',
		'Reservation created for 21–23 December.',
		'Nothing to pay today, your booking is confirmed.',
		'No problem — your booking is confirmed.',
		'Your stay is not just available, it has been booked.',
		'ยืนยันการจองแล้วครับ',
		'예약이 완료되었습니다.',
		'No booking has been confirmed except yours.',
		'It is false that nothing has been booked.',
		'Nothing other than your villa has been booked.'
	])('flags a completion claim: %s', text => {
		expect(hasTransactionCompletionClaim(text)).toBe(true);
	});

	it.each([
		'Yes—Pool Villa is available for 21–23 December 2026. The direct-booking total is ฿14,450.\n\nNothing has been booked. If you decide to proceed, use the booking card below the chat. [[ANSWERED]]',
		'Yes, Thai Massage is available on January 18, 2027, at 14:00 resort time. Nothing was booked. [[ANSWERED]]',
		'Both villas sleep four. Availability wasn’t checked, and nothing was booked. [[ANSWERED]]',
		'Nothing has been booked or confirmed yet.',
		'No booking has been made.',
		'Your booking has not been confirmed yet.',
		"The appointment hasn't been booked.",
		'I have not booked anything.',
		'The reservation was never confirmed.',
		'Reply yes to confirm the booking.',
		'날짜가 없어 예약은 진행하지 않았습니다.',
		'ยังไม่ได้จองให้นะครับ'
	])('allows an honest negative or guidance: %s', text => {
		expect(hasTransactionCompletionClaim(text)).toBe(false);
	});
});
