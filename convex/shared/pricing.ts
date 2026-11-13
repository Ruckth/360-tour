import { percentageOf } from './money';

export type PriceQuote = {
	pricePerNight: number;
	nights: number;
	subtotal: number;
	discountPercent: number;
	discountAmount: number;
	directTotal: number;
	currency: string;
};

export function calculateDirectQuote(
	property: { pricePerNight: number; directDiscountPercent: number; currency: string },
	nights: number
): PriceQuote {
	// Empty/reversed date input shows a zero-night quote in the browser.
	nights = Math.max(0, nights);
	const subtotal = property.pricePerNight * nights;
	const discountPercent = property.directDiscountPercent;
	const discountAmount = percentageOf(subtotal, discountPercent);
	const directTotal = subtotal - discountAmount;

	return {
		pricePerNight: property.pricePerNight,
		nights,
		subtotal,
		discountPercent,
		discountAmount,
		directTotal,
		currency: property.currency
	};
}

export function maxSavings(directTotal: number, otaTotals: number[]): number {
	if (otaTotals.length === 0) return 0;
	return Math.max(...otaTotals) - directTotal;
}
