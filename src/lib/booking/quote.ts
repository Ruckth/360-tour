import { percentageOf } from 'convex/shared/money';
export type BookingQuote = {
  pricePerNight: number;
  nights: number;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  directTotal: number;
  currency: string;
};

export function calculateBookingQuote({
  pricePerNight,
  nights,
  discountPercent,
  currency,
}: {
  pricePerNight: number;
  nights: number;
  discountPercent: number;
  currency: string;
}): BookingQuote {
  const safeNights = Math.max(0, nights);
  const subtotal = pricePerNight * safeNights;
  const discountAmount = percentageOf(subtotal, discountPercent);

  return {
    pricePerNight,
    nights: safeNights,
    subtotal,
    discountPercent,
    discountAmount,
    directTotal: subtotal - discountAmount,
    currency,
  };
}
