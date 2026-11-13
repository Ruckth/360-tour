import { describe, expect, it } from "vitest";
import { calculateDirectQuote } from "convex/shared/pricing";

describe("calculateDirectQuote", () => {
  it("calculates subtotal, discount, and direct total", () => {
    expect(
      calculateDirectQuote({ pricePerNight: 850000, directDiscountPercent: 1500, currency: "THB" }, 3),
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
      calculateDirectQuote({ pricePerNight: 450000, directDiscountPercent: 1500, currency: "THB" }, -2),
    ).toMatchObject({
      nights: 0,
      subtotal: 0,
      discountAmount: 0,
      directTotal: 0,
    });
  });

  it("rounds fractional discount amounts", () => {
    expect(
      calculateDirectQuote({ pricePerNight: 333300, directDiscountPercent: 1250, currency: "THB" }, 1).discountAmount,
    ).toBe(41663);
  });
});
