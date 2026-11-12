import { describe, expect, it } from "vitest";
import { calculateBookingQuote } from "@/lib/booking/quote";

describe("calculateBookingQuote", () => {
  it("calculates subtotal, discount, and direct total", () => {
    expect(
      calculateBookingQuote({
        pricePerNight: 850000,
        nights: 3,
        discountPercent: 1500,
        currency: "THB",
      }),
    ).toEqual({
      pricePerNight: 850000,
      nights: 3,
      subtotal: 2550000,
      discountPercent: 1500,
      discountAmount: 382500,
      directTotal: 2167500,
      currency: "THB",
    });
  });

  it("clamps negative nights to zero", () => {
    expect(
      calculateBookingQuote({
        pricePerNight: 450000,
        nights: -2,
        discountPercent: 1500,
        currency: "THB",
      }),
    ).toMatchObject({
      nights: 0,
      subtotal: 0,
      discountAmount: 0,
      directTotal: 0,
    });
  });

  it("rounds fractional discount amounts", () => {
    expect(
      calculateBookingQuote({
        pricePerNight: 333300,
        nights: 1,
        discountPercent: 1250,
        currency: "THB",
      }).discountAmount,
    ).toBe(41663);
  });
});
