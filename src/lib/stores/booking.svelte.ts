import { COUNTDOWN_DURATION_MS, DISCOUNT_PERCENT, getDiscountedPrice } from '$lib/data/urgency';

class BookingState {
	checkInDate = $state<string>('');
	checkOutDate = $state<string>('');
	guestCount = $state<number>(1);
	currentStep = $state<number>(1);
	discountActive = $state<boolean>(true);
	discountEndTime = $state<number>(Date.now() + COUNTDOWN_DURATION_MS);
	bookingConfirmed = $state<boolean>(false);
	modalOpen = $state<boolean>(false);
	selectedPropertyId = $state<string>('');

	nightCount = $derived(
		!this.checkInDate || !this.checkOutDate
			? 0
			: Math.max(
					0,
					Math.round(
						(new Date(this.checkOutDate).getTime() - new Date(this.checkInDate).getTime()) /
							(1000 * 60 * 60 * 24)
					)
				)
	);

	get discountPercent(): number {
		return DISCOUNT_PERCENT;
	}

	getDiscounted(price: number): number {
		return this.discountActive ? getDiscountedPrice(price) : price;
	}

	startBooking(propertyId: string) {
		this.selectedPropertyId = propertyId;
		this.currentStep = 1;
		this.bookingConfirmed = false;
		this.modalOpen = true;
	}

	setDates(checkIn: string, checkOut: string) {
		this.checkInDate = checkIn;
		this.checkOutDate = checkOut;
		if (checkIn && checkOut) {
			this.currentStep = 2;
		}
	}

	setGuests(count: number) {
		this.guestCount = Math.max(1, count);
		this.currentStep = 3;
	}

	confirmBooking() {
		this.bookingConfirmed = true;
	}

	reset() {
		this.checkInDate = '';
		this.checkOutDate = '';
		this.guestCount = 1;
		this.currentStep = 1;
		this.bookingConfirmed = false;
		this.modalOpen = false;
		this.selectedPropertyId = '';
	}
}

export const bookingState = new BookingState();
