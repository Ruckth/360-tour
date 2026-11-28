import type { Property } from "@/lib/data/properties";

export type BookingProperty = Property & {
  _id?: string;
  slug: string;
  currency: string;
  directDiscountPercent: number;
  source: "live";
};

export type BookingStep = "select" | "info" | "review";

export const bookingSteps: { key: BookingStep; label: string }[] = [
  { key: "select", label: "Villa & Dates" },
  { key: "info", label: "Guest details" },
  { key: "review", label: "Pay" },
];

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** `phone` is the parsed E.164 value (see `guestPhoneE164`); empty when the draft is not a valid number. */
export function isValidGuestInfo(name: string, email: string, phone: string): boolean {
  return name.trim().length >= 2 && isValidEmail(email) && /^\+[1-9]\d{6,14}$/.test(phone);
}

export function getHighestAllowedStepIndex({
  selectValid,
  guestsValid,
  infoValid,
}: {
  selectValid: boolean;
  guestsValid: boolean;
  infoValid: boolean;
}) {
  if (!selectValid) return 0;
  if (!guestsValid || !infoValid) return 1;
  return 2;
}

/** A whole-number URL count; absent, blank or malformed values are missing (Number("") is 0). */
function urlCount(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const count = Number(value);
  return Number.isFinite(count) ? Math.floor(count) : undefined;
}

/**
 * Starting party from booking-link params. Explicit adults/children win; adults are derived
 * from the total guest count only when the adults value is missing. Capacity is checked later.
 */
export function initialGuestCounts({ guests, adults, children }: { guests: string; adults: string; children: string }) {
  const childCount = Math.max(0, urlCount(children) ?? 0);
  const explicitAdults = urlCount(adults);
  const totalGuests = Math.max(1, urlCount(guests) ?? 1);
  return {
    adults: Math.max(1, explicitAdults ?? totalGuests - childCount),
    children: childCount,
  };
}
