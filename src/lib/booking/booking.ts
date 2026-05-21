import type { Property } from "@/lib/data/properties";

export type BookingProperty = Property & {
  _id?: string;
  slug: string;
  currency: string;
  directDiscountPercent: number;
  source: "live" | "demo";
};

export type BookingMode = "demo" | "live";

export type BookingStep = "select" | "guests" | "info" | "review";

export const bookingSteps: { key: BookingStep; label: string }[] = [
  { key: "select", label: "Villa & Dates" },
  { key: "guests", label: "Guests" },
  { key: "info", label: "Details" },
  { key: "review", label: "Pay" },
];

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPhone(phone: string): boolean {
  return phone.trim().replace(/^\+\d{1,3}\s*/, "").replace(/\D/g, "").length >= 6;
}

export function isValidGuestInfo(name: string, email: string, phone: string): boolean {
  return name.trim().length >= 2 && isValidEmail(email) && isValidPhone(phone);
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
  if (!guestsValid) return 1;
  if (!infoValid) return 2;
  return 3;
}
