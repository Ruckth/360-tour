import { describe, expect, it } from "vitest";
import { calculateBookingQuote } from "@/lib/booking/quote";

describe("calculateBookingQuote", () => {
  it("calculates subtotal, discount, and direct total", () => {
    expect(
      calculateBookingQuote({
        pricePerNight: 8500,
        nights: 3,
        discountPercent: 15,
        currency: "THB",
      }),
    ).toEqual({
      pricePerNight: 8500,
      nights: 3,
      subtotal: 25500,
      discountPercent: 15,
      discountAmount: 3825,
      directTotal: 21675,
      currency: "THB",
    });
  });

  it("clamps negative nights to zero", () => {
    expect(
      calculateBookingQuote({
        pricePerNight: 4500,
        nights: -2,
        discountPercent: 15,
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
        pricePerNight: 3333,
        nights: 1,
        discountPercent: 12.5,
        currency: "THB",
      }).discountAmount,
    ).toBe(417);
  });
});
