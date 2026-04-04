/**
 * Urgency & scarcity demo data — all values are simulated for demo purposes.
 */

export const DISCOUNT_PERCENT = 15;

/** Two-hour countdown in milliseconds */
export const COUNTDOWN_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Deterministic availability based on property ID hash.
 * Returns 3-7 "dates left this month".
 */
export function getAvailability(propertyId: string): number {
	let hash = 0;
	for (let i = 0; i < propertyId.length; i++) {
		hash = (hash << 5) - hash + propertyId.charCodeAt(i);
		hash |= 0;
	}
	return 3 + (Math.abs(hash) % 5); // 3-7
}

/**
 * Returns a base viewer count (12-34) deterministic by property ID.
 */
export function getViewerCount(propertyId: string): number {
	let hash = 0;
	for (let i = 0; i < propertyId.length; i++) {
		hash = (hash << 3) + hash + propertyId.charCodeAt(i);
		hash |= 0;
	}
	return 12 + (Math.abs(hash) % 23); // 12-34
}

/**
 * Fluctuates a count by +/-2.
 */
export function fluctuateViewerCount(current: number): number {
	const delta = Math.floor(Math.random() * 5) - 2; // -2 to +2
	return Math.max(8, Math.min(40, current + delta));
}

export function getDiscountedPrice(price: number): number {
	return Math.round(price * (1 - DISCOUNT_PERCENT / 100));
}

export interface BookingNotification {
	guest: string;
	property: string;
	timeAgo: string;
}

const recentBookings: BookingNotification[] = [
	{ guest: 'Sarah M.', property: 'Pool Villa', timeAgo: '3 minutes ago' },
	{ guest: 'Tanaka K.', property: 'Penthouse', timeAgo: '8 minutes ago' },
	{ guest: 'James & Emily', property: 'Garden Suite', timeAgo: '12 minutes ago' },
	{ guest: 'Priya S.', property: 'Pool Villa', timeAgo: '18 minutes ago' },
	{ guest: 'Marco R.', property: 'Penthouse', timeAgo: '25 minutes ago' },
	{ guest: 'Yuki T.', property: 'Garden Suite', timeAgo: '31 minutes ago' },
	{ guest: 'Anna & Liam', property: 'Pool Villa', timeAgo: '42 minutes ago' },
	{ guest: 'Chen W.', property: 'Penthouse', timeAgo: '55 minutes ago' }
];

let bookingIndex = 0;

/**
 * Cycles through pre-written fake booking notifications.
 */
export function getRecentBooking(): BookingNotification {
	const booking = recentBookings[bookingIndex % recentBookings.length];
	bookingIndex++;
	return booking;
}
