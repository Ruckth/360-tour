import type { Doc } from '../_generated/dataModel';

export type PriceQuote = {
	pricePerNight: number;
	nights: number;
	subtotal: number;
	discountPercent: number;
	discountAmount: number;
	directTotal: number;
	currency: string;
};

export function calculateDirectQuote(property: Doc<'properties'>, nights: number): PriceQuote {
	const subtotal = property.pricePerNight * nights;
	const discountPercent = property.directDiscountPercent;
	const discountAmount = Math.round(subtotal * (discountPercent / 100));
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
