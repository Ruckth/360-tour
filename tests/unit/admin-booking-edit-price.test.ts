import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { bookingEditPrice, couponNote, type BookingEditQuote } from "@/components/admin/booking-edit-price";
import { errorText } from "@/lib/staff-bookings";

const current = { total: 720000, currency: "THB", promotionCode: "DCNT-F1-20" };
const quote = (overrides: Partial<BookingEditQuote> = {}): BookingEditQuote => ({
  subtotal: 1350000,
  discountAmount: 270000,
  total: 1080000,
  currency: "THB",
  promotion: { code: "DCNT-F1-20", couponVersion: 1, discount: 270000 },
  couponRemoved: false,
  repriced: true,
  ...overrides,
});

describe("edit booking price panel", () => {
  it("shows the server's coupon reprice, not a direct-rate estimate", () => {
    // The audit's case: extending the 7,200 coupon stay to three nights saves 10,800, not 11,475.
    expect(bookingEditPrice({ current, quote: { status: "ready", quote: quote() } })).toEqual({
      kind: "changed",
      total: 1080000,
      currency: "THB",
      difference: 360000,
      note: "Repriced with DCNT-F1-20 (v1)",
    });
  });

  it("says when the coupon no longer applies", () => {
    const result = bookingEditPrice({
      current,
      quote: { status: "ready", quote: quote({ promotion: null, couponRemoved: true, total: 1147500, discountAmount: 202500 }) },
    });
    expect(result).toMatchObject({ kind: "changed", total: 1147500, difference: 427500, note: "Coupon DCNT-F1-20 no longer applies — direct rate" });
  });

  it("keeps the price for guest-only edits the server doesn't reprice", () => {
    expect(bookingEditPrice({ current, quote: { status: "ready", quote: quote({ repriced: false, total: 960000 }) } })).toEqual({
      kind: "unchanged",
      total: 720000,
      currency: "THB",
    });
  });

  it("shows the coupon note even when a reprice lands on the same total", () => {
    expect(bookingEditPrice({ current, quote: { status: "ready", quote: quote({ total: 720000 }) } })).toMatchObject({ kind: "changed", difference: 0 });
  });

  it("drops the difference when the currency changes", () => {
    expect(bookingEditPrice({ current, quote: { status: "ready", quote: quote({ currency: "USD", total: 30000, promotion: null }) } })).toEqual({
      kind: "changed",
      total: 30000,
      currency: "USD",
      difference: null,
      note: null,
    });
  });

  it("passes loading, error and idle through", () => {
    expect(bookingEditPrice({ current, quote: { status: "loading" } })).toEqual({ kind: "loading" });
    expect(bookingEditPrice({ current, quote: { status: "idle" } })).toEqual({ kind: "idle" });
    expect(bookingEditPrice({ current, quote: { status: "error", message: "Those dates are taken" } })).toEqual({ kind: "error", message: "Those dates are taken" });
  });

  it("uses the custom price as typed, whatever the quote says", () => {
    expect(bookingEditPrice({ current, custom: 900000, quote: { status: "loading" } })).toEqual({
      kind: "changed",
      total: 900000,
      currency: "THB",
      difference: 180000,
      note: null,
    });
    expect(bookingEditPrice({ current, custom: null, quote: { status: "ready", quote: quote() } })).toEqual({ kind: "unchanged", total: 720000, currency: "THB" });
  });

  it("names the old code only when it's known", () => {
    expect(couponNote({ promotion: null, couponRemoved: true })).toBe("The coupon no longer applies — direct rate");
    expect(couponNote({ promotion: null, couponRemoved: false }, "DCNT-F1-20")).toBeNull();
  });
});

describe("admin error text", () => {
  it("reads a ConvexError's message, such as reopen's coupon_unavailable", () => {
    const message = "DCNT-F1-20 has no uses left, so this booking can't reopen at its coupon price. Raise the coupon's limit, or create a new booking.";
    expect(errorText(new ConvexError({ code: "coupon_unavailable", message }), "Could not save the change.")).toBe(message);
    expect(errorText(new ConvexError("Plain message"), "fallback")).toBe("Plain message");
  });

  it("still trims plain server errors", () => {
    expect(errorText(new Error("[CONVEX M(x)] Uncaught Error: Dates taken\n  at handler"), "fallback")).toBe("Dates taken");
    expect(errorText("nope", "fallback")).toBe("fallback");
  });
});
