import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { evaluateOffer, type QuoteLine } from "convex/lib/offers";
import { EMPTY_COUPON_FORM, couponFormErrors, couponFormFrom, couponFormKey, couponRulesFrom, type CouponForm } from "@/components/admin/marketing/coupon-form";
import { countLabel, directOfferApplied, marketingErrorText, qrDirectPercent } from "@/components/admin/marketing/marketing-format";

const form = (patch: Partial<CouponForm>): CouponForm => ({ ...EMPTY_COUPON_FORM, code: "SPA-10", value: "10", ...patch });

describe("coupon editor dirty check", () => {
  it("ignores formatting, villa order and surrounding spaces", () => {
    const saved = form({ maxSaving: "3,000", allVillas: false, villas: ["alpha", "beta"], terms: "Book direct" });
    const typed = form({ maxSaving: "3000", allVillas: false, villas: ["beta", "alpha"], terms: "Book direct ", code: "spa-10" });
    expect(couponFormKey(typed)).toBe(couponFormKey(saved));
  });

  it("matches the form rebuilt from what was just saved", () => {
    const typed = form({ maxSaving: "3000", budget: "80000", allVillas: false, villas: ["beta", "alpha"], terms: " Stay 2 nights " });
    const rebuilt = couponFormFrom({ code: "SPA-10", rules: couponRulesFrom(typed) });
    expect(rebuilt.maxSaving).toBe("3,000");
    expect(rebuilt.villas).toEqual(["alpha", "beta"]);
    expect(couponFormKey(rebuilt)).toBe(couponFormKey(typed));
  });

  it("still counts real edits and unparsable text", () => {
    const base = form({});
    expect(couponFormKey(form({ value: "15" }))).not.toBe(couponFormKey(base));
    expect(couponFormKey(form({ campaignId: "c1" }))).not.toBe(couponFormKey(base));
    expect(couponFormKey(form({ budget: "abc" }))).not.toBe(couponFormKey(base));
  });
});

describe("coupon form validation", () => {
  it("needs at least 3 characters, like saveCoupon", () => {
    expect(couponFormErrors(form({ code: "AB" }), { takenCodes: [] }).code).toBe("Use at least 3 characters");
    expect(couponFormErrors(form({ code: "ABC" }), { takenCodes: [] }).code).toBeUndefined();
    expect(couponFormErrors(form({ code: "A".repeat(33) }), { takenCodes: [] }).code).toBe("Keep it to 32 characters");
  });

  it("rejects 0 in the optional limits instead of letting the backend refuse it", () => {
    const errors = couponFormErrors(form({ maxSaving: "0", minNights: "0", minSubtotal: "0", usageLimit: "0", budget: "0" }), { takenCodes: [] });
    expect(errors).toMatchObject({
      maxSaving: "Leave empty for no limit",
      minNights: "Leave empty for no minimum",
      minSubtotal: "Leave empty for no minimum",
      usageLimit: "Leave empty for no limit",
      budget: "Leave empty for no limit",
    });
  });

  it("accepts positive whole numbers only", () => {
    expect(couponFormErrors(form({ budget: "1,500" }), { takenCodes: [] }).budget).toBeUndefined();
    expect(couponFormErrors(form({ budget: "12.5" }), { takenCodes: [] }).budget).toBe("Use a whole number");
    expect(couponFormErrors(form({ budget: "99999999999999999999" }), { takenCodes: [] }).budget).toBe("Use a whole number");
  });
});

describe("test quote direct-offer row", () => {
  const stay: QuoteLine = { id: "accommodation", kind: "accommodation", propertySlug: "a", checkIn: "2026-12-01", checkOut: "2026-12-03", nights: 2, amount: 9000 };
  const spa: QuoteLine = { id: "service-0", kind: "service", label: "Massage", amount: 2000 };
  const coupon = (scope: "services" | "accommodation", percent: number) =>
    ({ code: "X", version: 1, status: "active", benefit: { kind: "percent", percent }, scope, used: 0, discountGranted: 0 }) as const;

  it("is applied when a services coupon stacks on it", () => {
    const result = evaluateOffer({ lines: [stay, spa], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("services", 20) });
    expect(result.applied).toBe("coupon");
    expect(directOfferApplied(result)).toBe(true);
  });

  it("is not applied when an accommodation coupon replaces it", () => {
    const result = evaluateOffer({ lines: [stay], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("accommodation", 20) });
    expect(directOfferApplied(result)).toBe(false);
  });

  it("is applied when it wins on its own", () => {
    const result = evaluateOffer({ lines: [stay], directDiscountPercent: 15, today: "2026-11-08", coupon: coupon("accommodation", 10) });
    expect(directOfferApplied(result)).toBe(true);
  });
});

describe("marketingErrorText", () => {
  it("shows the ConvexError message", () => {
    expect(marketingErrorText(new ConvexError({ code: "villa_not_public", message: "Publish the villa first" }), "fallback")).toBe("Publish the villa first");
  });

  it("falls back to the dev message, then the fallback", () => {
    expect(marketingErrorText(new Error("[CONVEX M(marketing:saveLink)] Uncaught Error: Slug taken\n  at handler"), "fallback")).toBe("Slug taken");
    expect(marketingErrorText("nope", "fallback")).toBe("fallback");
  });
});

describe("qrDirectPercent", () => {
  const villas = [
    { slug: "a", status: "active", directDiscountPercent: 10 },
    { slug: "b", status: "active", directDiscountPercent: 20 },
    { slug: "c", status: "draft", directDiscountPercent: 5 },
  ] as const;

  it("uses the destination villa's own percent", () => {
    expect(qrDirectPercent({ kind: "villa", propertySlug: "a" }, villas)).toBe(10);
    expect(qrDirectPercent({ kind: "booking", propertySlug: "b" }, villas)).toBe(20);
  });

  it("promises only what every public villa gives elsewhere", () => {
    expect(qrDirectPercent({ kind: "home" }, villas)).toBe(10);
    expect(qrDirectPercent({ kind: "booking" }, villas)).toBe(10);
  });

  it("promises nothing for a villa guests can't book", () => {
    expect(qrDirectPercent({ kind: "villa", propertySlug: "c" }, villas)).toBe(0);
    expect(qrDirectPercent({ kind: "home" }, [])).toBe(0);
  });
});

describe("countLabel", () => {
  it("marks capped counts as lower bounds", () => {
    expect(countLabel(500, true)).toBe("500+");
    expect(countLabel(1234)).toBe("1,234");
  });
});
