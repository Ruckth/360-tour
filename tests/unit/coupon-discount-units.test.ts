import { expect, it } from "vitest";
import { EMPTY_COUPON_FORM, couponRulesFrom, couponFormErrors, discountFromText, discountEcho } from "@/components/admin/marketing/coupon-form";

it("keeps human coupon text in baht and percent while rules use satang and basis points", () => {
  const percent = discountFromText("20%", "fixed");
  expect(percent).toEqual({ kind: "percent", value: "20" });
  expect(couponRulesFrom({ ...EMPTY_COUPON_FORM, ...percent }).benefit).toEqual({ kind: "percent", percent: 2000 });
  const fixed = discountFromText("฿500", "percent");
  expect(fixed).toEqual({ kind: "fixed", value: "500" });
  expect(couponRulesFrom({ ...EMPTY_COUPON_FORM, ...fixed }).benefit).toEqual({ kind: "fixed", amount: 50000 });
  expect(discountEcho({ ...EMPTY_COUPON_FORM, ...percent }, [{ slug: "villa", status: "active", pricePerNight: 850000 }])).toBe("20% = ฿1,700 a night");
});


it('keeps coupon whole-baht validation and formatted amounts when using the money parser', () => {
  const form = { ...EMPTY_COUPON_FORM, code: 'SAVE', kind: 'fixed' as const, value: '1,500', budget: '2,000', minSubtotal: '฿3,000' };
  expect(couponFormErrors(form, { takenCodes: [] })).toEqual({});
  expect(couponRulesFrom(form)).toMatchObject({ benefit: { kind: 'fixed', amount: 150000 }, discountBudget: 200000, minEligibleSubtotal: 300000 });
  expect(couponFormErrors({ ...form, value: '9007199254740990', budget: '9007199254740990' }, { takenCodes: [] })).toMatchObject({ value: 'Use a whole number', budget: 'Use a whole number' });
  expect(couponFormErrors({ ...form, value: '1.005', budget: '2.345', minSubtotal: '3.456', maxSaving: '4.567', kind: 'percent' }, { takenCodes: [] })).toMatchObject({
    value: 'Use a whole number', budget: 'Use a whole number', minSubtotal: 'Use a whole number', maxSaving: 'Use a whole number',
  });
});
