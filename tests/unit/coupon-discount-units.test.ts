import { expect, it } from "vitest";
import { EMPTY_COUPON_FORM, couponRulesFrom, discountFromText, discountEcho } from "@/components/admin/marketing/coupon-form";

it("keeps human coupon text in baht and percent while rules use satang and basis points", () => {
  const percent = discountFromText("20%", "fixed");
  expect(percent).toEqual({ kind: "percent", value: "20" });
  expect(couponRulesFrom({ ...EMPTY_COUPON_FORM, ...percent }).benefit).toEqual({ kind: "percent", percent: 2000 });
  const fixed = discountFromText("฿500", "percent");
  expect(fixed).toEqual({ kind: "fixed", value: "500" });
  expect(couponRulesFrom({ ...EMPTY_COUPON_FORM, ...fixed }).benefit).toEqual({ kind: "fixed", amount: 50000 });
  expect(discountEcho({ ...EMPTY_COUPON_FORM, ...percent }, [{ slug: "villa", status: "active", pricePerNight: 850000 }])).toBe("20% = ฿1,700 a night");
});
