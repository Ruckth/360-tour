import { getPricingByPropertyId, type PropertyPricing, type OTAPricing } from '$lib/data/pricing';

export interface OTATotal {
	platform: OTAPricing['platform'];
	displayName: string;
	logo: string;
	nightlyRate: number;
	subtotal: number;
	serviceFee: number;
	cleaningFee: number;
	total: number;
}

class PricingState {
	nights = $state<number>(3);
	guests = $state<number>(2);
	propertyId = $state<string>('');
	pricing = $state<PropertyPricing | undefined>(undefined);

	directRate = $derived<number>(this.pricing?.directRate ?? 0);

	directTotal = $derived<number>(this.directRate * this.nights);

	otaTotals = $derived<OTATotal[]>(
		(this.pricing?.otaPricing ?? []).map((ota) => {
			const subtotal = ota.nightlyRate * this.nights;
			const serviceFee = Math.round(subtotal * (ota.serviceFeePercent / 100));
			return {
				platform: ota.platform,
				displayName: ota.displayName,
				logo: ota.logo,
				nightlyRate: ota.nightlyRate,
				subtotal,
				serviceFee,
				cleaningFee: ota.cleaningFee,
				total: subtotal + serviceFee + ota.cleaningFee
			};
		})
	);

	maxOtaFees = $derived<number>(
		this.otaTotals.length > 0
			? Math.max(...this.otaTotals.map((o) => o.total)) - this.directTotal
			: 0
	);

	// Keep maxSavings as alias for backward compatibility
	get maxSavings() { return this.maxOtaFees; }

	averageOtaFees = $derived<number>(
		this.otaTotals.length > 0
			? Math.round(
					this.otaTotals.reduce((sum, o) => sum + (o.total - this.directTotal), 0) /
						this.otaTotals.length
				)
			: 0
	);

	init(propertyId: string) {
		this.propertyId = propertyId;
		this.pricing = getPricingByPropertyId(propertyId);
		this.nights = 3;
		this.guests = 2;
	}

	setNights(n: number) {
		this.nights = Math.max(1, Math.min(14, n));
	}

	setGuests(n: number) {
		this.guests = Math.max(1, Math.min(10, n));
	}
}

export const pricingState = new PricingState();
