import type { CouponProblem } from "convex/lib/offers";
import { formatDay, formatRange, thb } from "./format-basics";

/**
 * Why a coupon didn't apply, as one plain sentence (no full stop) that staff can read out
 * and guests can act on, e.g. "Add 1 more night to use this offer".
 */
export function couponProblemMessage(problem: CouponProblem): string {
  switch (problem.code) {
    case "not_found":
      return "No coupon has this code";
    case "not_active":
      return "This coupon isn’t live. Publish or resume it first";
    case "not_started":
      return `This offer starts on ${formatDay(problem.startsOn)}`;
    case "expired":
      return `This offer ended on ${formatDay(problem.endedOn)}`;
    case "sold_out":
      return "This offer has been fully used";
    case "budget_used":
      return "This offer’s discount budget is used up";
    case "wrong_property":
      return "This code isn’t valid for this villa";
    case "stay_outside_dates":
      return problem.stayFrom || problem.stayTo
        ? `This offer is for stays ${formatRange(problem.stayFrom, problem.stayTo)}`
        : "These dates aren’t covered by this offer";
    case "min_nights": {
      const n = Math.max(1, problem.missingNights);
      return `Add ${n} more ${n === 1 ? "night" : "nights"} to use this offer`;
    }
    case "min_subtotal":
      return `Spend ${thb(Math.max(0, problem.minEligibleSubtotal - problem.eligibleSubtotal))} more to use this offer`;
    case "nothing_eligible":
      return "Nothing in this quote is covered by this code";
  }
}

/** A short label for the same problem, for badges and test logs. */
export function couponProblemTitle(problem: CouponProblem): string {
  switch (problem.code) {
    case "not_found":
      return "Unknown code";
    case "not_active":
      return "Not live";
    case "not_started":
      return "Not started";
    case "expired":
      return "Expired";
    case "sold_out":
      return "Sold out";
    case "budget_used":
      return "Budget used";
    case "wrong_property":
      return "Not in scope";
    case "stay_outside_dates":
      return "Outside the dates";
    case "min_nights":
      return "Minimum nights";
    case "min_subtotal":
      return "Minimum spend";
    case "nothing_eligible":
      return "Not in scope";
  }
}
