export const DIRECT_BOOKING_DISCOUNT_PERCENT = 15;

export function getDiscountedPrice(price: number): number {
	return Math.round(price * (1 - DIRECT_BOOKING_DISCOUNT_PERCENT / 100));
}
