import { describe, expect, it } from "vitest";
import type { CouponProblem } from "convex/lib/offers";
import { couponProblemMessage, couponProblemTitle } from "@/components/admin/marketing/coupon-problems";

describe("coupon problem copy", () => {
  it.each<[CouponProblem, string, string]>([
    [{ code: "not_found" }, "No coupon has this code", "Unknown code"],
    [{ code: "not_active" }, "This coupon isn’t live. Publish or resume it first", "Not live"],
    [{ code: "not_started", startsOn: "2026-11-15" }, "This offer starts on 15 Nov 2026", "Not started"],
    [{ code: "expired", endedOn: "2026-04-20" }, "This offer ended on 20 Apr 2026", "Expired"],
    [{ code: "sold_out" }, "This offer has been fully used", "Sold out"],
    [{ code: "budget_used" }, "This offer’s discount budget is used up", "Budget used"],
    [{ code: "wrong_property" }, "This code isn’t valid for this villa", "Not in scope"],
    [{ code: "stay_outside_dates", stayFrom: "2026-11-01", stayTo: "2026-12-20" }, "This offer is for stays 1 Nov–20 Dec 2026", "Outside the dates"],
    [{ code: "stay_outside_dates", stayTo: "2026-12-20" }, "This offer is for stays until 20 Dec 2026", "Outside the dates"],
    [{ code: "stay_outside_dates" }, "These dates aren’t covered by this offer", "Outside the dates"],
    // Tideglass 1 night with DCNT-F1-20 (kit/data.md).
    [{ code: "min_nights", minNights: 2, missingNights: 1 }, "Add 1 more night to use this offer", "Minimum nights"],
    [{ code: "min_nights", minNights: 3, missingNights: 2 }, "Add 2 more nights to use this offer", "Minimum nights"],
    // DCNT-SPA-500 needs ฿1,500 of spa services.
    [{ code: "min_subtotal", minEligibleSubtotal: 1500, eligibleSubtotal: 1200 }, "Spend ฿300 more to use this offer", "Minimum spend"],
    [{ code: "nothing_eligible" }, "Nothing in this quote is covered by this code", "Not in scope"],
  ])("explains %j", (problem, message, title) => {
    expect(couponProblemMessage(problem)).toBe(message);
    expect(couponProblemTitle(problem)).toBe(title);
  });

  it("writes sentence-case copy without a trailing full stop", () => {
    const problems: CouponProblem[] = [
      { code: "not_found" },
      { code: "sold_out" },
      { code: "min_nights", minNights: 2, missingNights: 1 },
      { code: "nothing_eligible" },
    ];
    for (const problem of problems) {
      const message = couponProblemMessage(problem);
      expect(message[0]).toBe(message[0].toUpperCase());
      expect(message.endsWith(".")).toBe(false);
    }
  });
});
