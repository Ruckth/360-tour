import { DIRECT_BOOKING_DISCOUNT_PERCENT, getDiscountedPrice } from '$lib/data/booking-config';

export type BookingStep = 'unit' | 'dates' | 'guests' | 'info' | 'review';

class BookingState {
	checkInDate = $state<string>('');
	checkOutDate = $state<string>('');
	guestCount = $state<number>(1);
	currentStep = $state<BookingStep>('unit');
	discountActive = $state<boolean>(true);
	bookingConfirmed = $state<boolean>(false);
	selectedPropertyId = $state<string>('');

	// Guest information
	guestName = $state<string>('');
	guestEmail = $state<string>('');
	guestPhone = $state<string>('');

	// Payment state
	isSubmitting = $state<boolean>(false);
	paymentError = $state<string>('');
	bookingId = $state<string>('');

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
		return DIRECT_BOOKING_DISCOUNT_PERCENT;
	}

	getDiscounted(price: number): number {
		return this.discountActive ? getDiscountedPrice(price) : price;
	}

	initFromUrl(propertyId?: string, checkin?: string, checkout?: string, guests?: number) {
		this.bookingConfirmed = false;
		this.isSubmitting = false;
		this.paymentError = '';

		if (propertyId) {
			this.selectedPropertyId = propertyId;
			this.currentStep = 'dates';
			if (checkin) this.checkInDate = checkin;
			if (checkout) this.checkOutDate = checkout;
			if (guests) this.guestCount = guests;
		} else {
			this.currentStep = 'unit';
		}
	}

	selectUnit(propertyId: string) {
		this.selectedPropertyId = propertyId;
		this.currentStep = 'dates';
	}

	goToUnit() {
		this.currentStep = 'unit';
		this.selectedPropertyId = '';
	}

	setDates(checkIn: string, checkOut: string) {
		this.checkInDate = checkIn;
		this.checkOutDate = checkOut;
	}

	goToDates() {
		this.currentStep = 'dates';
	}

	goToGuests() {
		if (this.checkInDate && this.checkOutDate) {
			this.currentStep = 'guests';
		}
	}

	setGuests(count: number) {
		this.guestCount = Math.max(1, count);
	}

	goToInfo() {
		this.currentStep = 'info';
	}

	setGuestInfo(name: string, email: string, phone: string) {
		this.guestName = name;
		this.guestEmail = email;
		this.guestPhone = phone;
	}

	goToReview() {
		if (this.guestName && this.guestEmail && this.guestPhone) {
			this.currentStep = 'review';
		}
	}

	confirmBooking() {
		this.bookingConfirmed = true;
	}

	setPaymentError(error: string) {
		this.paymentError = error;
		this.isSubmitting = false;
	}

	reset() {
		this.checkInDate = '';
		this.checkOutDate = '';
		this.guestCount = 1;
		this.currentStep = 'unit';
		this.bookingConfirmed = false;
		this.selectedPropertyId = '';
		this.guestName = '';
		this.guestEmail = '';
		this.guestPhone = '';
		this.isSubmitting = false;
		this.paymentError = '';
		this.bookingId = '';
	}
}

export const bookingState = new BookingState();
