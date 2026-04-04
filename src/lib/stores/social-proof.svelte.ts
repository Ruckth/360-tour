import { recentBookings } from '$lib/data/social-proof';

class SocialProofState {
	currentBookingIndex = $state<number>(0);
	showBookingFeed = $state<boolean>(false);
	reviewCarouselIndex = $state<number>(0);
	showPostTourOverlay = $state<boolean>(false);
	tourDuration = $state<number>(0);

	private bookingInterval: ReturnType<typeof setInterval> | undefined;
	private tourTimer: ReturnType<typeof setInterval> | undefined;
	private feedTimeout: ReturnType<typeof setTimeout> | undefined;
	private hideTimeout: ReturnType<typeof setTimeout> | undefined;

	get currentBooking() {
		return recentBookings[this.currentBookingIndex];
	}

	startBookingFeed() {
		this.currentBookingIndex = 0;

		this.feedTimeout = setTimeout(() => {
			this.showBookingFeed = true;

			this.hideTimeout = setTimeout(() => {
				this.showBookingFeed = false;
			}, 4000);

			this.bookingInterval = setInterval(() => {
				this.nextBooking();
				this.showBookingFeed = true;

				if (this.hideTimeout) clearTimeout(this.hideTimeout);
				this.hideTimeout = setTimeout(() => {
					this.showBookingFeed = false;
				}, 4000);
			}, 12000);
		}, 3000);
	}

	stopBookingFeed() {
		if (this.bookingInterval) clearInterval(this.bookingInterval);
		if (this.feedTimeout) clearTimeout(this.feedTimeout);
		if (this.hideTimeout) clearTimeout(this.hideTimeout);
		this.showBookingFeed = false;
	}

	nextBooking() {
		this.currentBookingIndex = (this.currentBookingIndex + 1) % recentBookings.length;
	}

	startTourTimer() {
		this.tourDuration = 0;
		this.tourTimer = setInterval(() => {
			this.tourDuration++;
		}, 1000);
	}

	stopTourTimer() {
		if (this.tourTimer) clearInterval(this.tourTimer);
	}
}

export const socialProofState = new SocialProofState();
