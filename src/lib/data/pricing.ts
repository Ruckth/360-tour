export interface OTAPricing {
	platform: 'booking.com' | 'airbnb' | 'agoda';
	displayName: string;
	nightlyRate: number;
	serviceFeePercent: number;
	cleaningFee: number;
	logo: string;
}

export interface DirectBenefit {
	benefit: string;
	directOnly: boolean;
}

export interface PropertyPricing {
	propertyId: string;
	directRate: number;
	otaPricing: OTAPricing[];
	directBenefits: DirectBenefit[];
}

const sharedBenefits: DirectBenefit[] = [
	{ benefit: 'Free airport pickup', directOnly: true },
	{ benefit: 'Welcome basket', directOnly: true },
	{ benefit: 'Late checkout (2pm)', directOnly: true },
	{ benefit: 'No service fees', directOnly: true },
	{ benefit: 'Free cancellation (48h)', directOnly: false },
	{ benefit: 'Direct WhatsApp support', directOnly: true }
];

export const propertyPricingData: PropertyPricing[] = [
	{
		propertyId: 'pool-villa',
		directRate: 8500,
		otaPricing: [
			{
				platform: 'booking.com',
				displayName: 'Booking.com',
				nightlyRate: 10200,
				serviceFeePercent: 14,
				cleaningFee: 800,
				logo: 'B'
			},
			{
				platform: 'airbnb',
				displayName: 'Airbnb',
				nightlyRate: 9800,
				serviceFeePercent: 14,
				cleaningFee: 600,
				logo: 'A'
			},
			{
				platform: 'agoda',
				displayName: 'Agoda',
				nightlyRate: 9950,
				serviceFeePercent: 12,
				cleaningFee: 700,
				logo: 'AG'
			}
		],
		directBenefits: sharedBenefits
	},
	{
		propertyId: 'garden-suite',
		directRate: 4500,
		otaPricing: [
			{
				platform: 'booking.com',
				displayName: 'Booking.com',
				nightlyRate: 5400,
				serviceFeePercent: 14,
				cleaningFee: 500,
				logo: 'B'
			},
			{
				platform: 'airbnb',
				displayName: 'Airbnb',
				nightlyRate: 5200,
				serviceFeePercent: 14,
				cleaningFee: 400,
				logo: 'A'
			},
			{
				platform: 'agoda',
				displayName: 'Agoda',
				nightlyRate: 5300,
				serviceFeePercent: 12,
				cleaningFee: 450,
				logo: 'AG'
			}
		],
		directBenefits: sharedBenefits
	},
	{
		propertyId: 'penthouse',
		directRate: 12000,
		otaPricing: [
			{
				platform: 'booking.com',
				displayName: 'Booking.com',
				nightlyRate: 14400,
				serviceFeePercent: 14,
				cleaningFee: 1200,
				logo: 'B'
			},
			{
				platform: 'airbnb',
				displayName: 'Airbnb',
				nightlyRate: 13800,
				serviceFeePercent: 14,
				cleaningFee: 900,
				logo: 'A'
			},
			{
				platform: 'agoda',
				displayName: 'Agoda',
				nightlyRate: 14100,
				serviceFeePercent: 12,
				cleaningFee: 1000,
				logo: 'AG'
			}
		],
		directBenefits: sharedBenefits
	}
];

export function getPricingByPropertyId(propertyId: string): PropertyPricing | undefined {
	return propertyPricingData.find((p) => p.propertyId === propertyId);
}

export function getMaxSavingsForProperty(propertyId: string, nights: number = 3): number {
	const pricing = getPricingByPropertyId(propertyId);
	if (!pricing) return 0;
	const directTotal = pricing.directRate * nights;
	let maxOtaTotal = 0;
	for (const ota of pricing.otaPricing) {
		const subtotal = ota.nightlyRate * nights;
		const serviceFee = Math.round(subtotal * (ota.serviceFeePercent / 100));
		const total = subtotal + serviceFee + ota.cleaningFee;
		if (total > maxOtaTotal) maxOtaTotal = total;
	}
	return maxOtaTotal - directTotal;
}
