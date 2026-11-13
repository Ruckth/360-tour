import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { evaluateOffer, type CouponProblem, type CouponRules, type OfferResult } from "convex/shared/offers";
import { locales } from "@/i18n/routing";
import {
  bookedPriceView,
  bookingPromotion,
  couponCodeToSend,
  couponCoversWholeStay,
  couponFix,
  couponFromParam,
  couponPhase,
  couponProblemMessage,
  couponUnavailableError,
  couponVerdict,
  discountLines,
  guestErrorText,
  quotedTotalFromParam,
  stayPrice,
  summaryNote,
  type CouponFormatters,
  type CouponMessage,
} from "@/lib/booking/coupon";

type Messages = Record<string, unknown>;
const messages = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
const en = messages("en");

/** Renders a Coupon.* message with plain {placeholder} substitution, like next-intl does for these keys. */
function render(message: CouponMessage, catalog: Messages = en): string {
  const template = message.key.split(".").reduce<unknown>((value, part) => (value as Messages | undefined)?.[part], catalog.Coupon);
  if (typeof template !== "string") throw new Error(`Missing Coupon.${message.key}`);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(message.values?.[name] ?? `{${name}}`));
}

const format: CouponFormatters = {
  money: (amount) => `฿${(amount / 100).toLocaleString("en-US")}`,
  date: (iso) => `<${iso}>`,
  range: (from, to) => `<${from}..${to}>`,
};

// kit/data.md: DCNT-F1-20, 20% off accommodation, stay 1 Nov–20 Dec 2026, min 2 nights, max saving ฿3,000.
const F1: CouponRules = {
  code: "DCNT-F1-20",
  version: 1,
  status: "active",
  benefit: { kind: "percent", percent: 2000 },
  scope: "accommodation",
  bookFrom: "2026-11-01",
  bookTo: "2026-11-30",
  stayFrom: "2026-11-01",
  stayTo: "2026-12-20",
  minNights: 2,
  maxSaving: 300000,
  usageLimit: 500,
  discountBudget: 8000000,
  used: 35,
  discountGranted: 6645000,
};

function quote(pricePerNight: number, checkIn: string, checkOut: string, coupon: CouponRules = F1): OfferResult {
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000;
  return evaluateOffer({
    lines: [{ id: "accommodation", kind: "accommodation", propertySlug: "mossbell", checkIn, checkOut, nights, amount: pricePerNight * nights }],
    directDiscountPercent: 1500,
    today: "2026-11-07",
    coupon,
  });
}

describe("couponFromParam", () => {
  it("normalises the short-link code", () => {
    expect(couponFromParam("dcnt-f1-20 ")).toBe("DCNT-F1-20");
    expect(couponFromParam(" DCNT-F1-20")).toBe("DCNT-F1-20");
    expect(couponFromParam(["dcnt-l-10", "DCNT-F1-20"])).toBe("DCNT-L-10");
  });

  it("ignores missing or impossible values", () => {
    expect(couponFromParam(undefined)).toBe("");
    expect(couponFromParam(null)).toBe("");
    expect(couponFromParam("")).toBe("");
    expect(couponFromParam("ab")).toBe("");
    expect(couponFromParam("<script>")).toBe("");
    expect(couponFromParam("DCNT F1 20")).toBe("");
    expect(couponFromParam("X".repeat(33))).toBe("");
  });
});

describe("coupon verdicts", () => {
  it("applies the coupon when it beats the direct offer (Mossbell 2 nights)", () => {
    const result = quote(450000, "2026-11-12", "2026-11-14");
    expect(couponVerdict(result)).toEqual({ kind: "applied" });
    expect(result.total).toBe(720000);
  });

  it("keeps the direct price when it's better (Canopy 3 nights, capped)", () => {
    const result = quote(1200000, "2026-11-12", "2026-11-15");
    expect(couponVerdict(result)).toEqual({ kind: "worse" });
  });

  it("keeps stay-dependent problems so a date or villa change can fix them", () => {
    expect(couponVerdict(quote(850000, "2026-11-12", "2026-11-13"))).toEqual({
      kind: "not_used",
      problem: { code: "min_nights", minNights: 2, missingNights: 1 },
    });
    expect(couponVerdict(quote(450000, "2026-12-22", "2026-12-24")).kind).toBe("not_used");
    expect(couponVerdict({ couponStatus: "invalid", problem: { code: "wrong_property" } }).kind).toBe("not_used");
  });

  it("rejects codes no stay can use", () => {
    for (const code of ["not_found", "not_active", "sold_out", "budget_used", "nothing_eligible"] as const) {
      expect(couponVerdict({ couponStatus: "invalid", problem: { code } as CouponProblem }).kind).toBe("rejected");
    }
    expect(couponVerdict({ couponStatus: "invalid", problem: { code: "expired", endedOn: "2026-04-20" } }).kind).toBe("rejected");
    expect(couponVerdict({ couponStatus: "invalid" })).toEqual({ kind: "rejected", problem: { code: "not_found" } });
  });
});

describe("guest problem messages", () => {
  it.each<[CouponProblem, string]>([
    [{ code: "not_found" }, "We couldn't find that code. Check the letters and try again"],
    [{ code: "not_active" }, "This code isn't active right now"],
    [{ code: "not_started", startsOn: "2026-11-15" }, "This code starts on <2026-11-15>"],
    [{ code: "expired", endedOn: "2026-04-20" }, "This code ended on <2026-04-20>"],
    [{ code: "sold_out" }, "This code has been fully used"],
    [{ code: "budget_used" }, "This code has been fully used"],
    [{ code: "wrong_property" }, "This code isn't valid for this villa"],
    [{ code: "stay_outside_dates", stayFrom: "2026-11-01", stayTo: "2026-12-20" }, "This code is for stays <2026-11-01..2026-12-20>"],
    [{ code: "stay_outside_dates", stayFrom: "2026-11-01" }, "This code is for stays from <2026-11-01>"],
    [{ code: "stay_outside_dates", stayTo: "2026-12-20" }, "This code is for stays until <2026-12-20>"],
    [{ code: "stay_outside_dates" }, "This code doesn't cover these dates"],
    [{ code: "min_nights", minNights: 2, missingNights: 1 }, "Add 1 more night to use this code"],
    [{ code: "min_nights", minNights: 4, missingNights: 2 }, "Add 2 more nights to use this code"],
    [{ code: "min_subtotal", minEligibleSubtotal: 150000, eligibleSubtotal: 120000 }, "Spend ฿300 more to use this code"],
    [{ code: "nothing_eligible" }, "This code is for spa services, not villa stays"],
  ])("explains %j", (problem, text) => {
    expect(render(couponProblemMessage(problem, format))).toBe(text);
  });

  it("has every message in every locale", () => {
    const problems: CouponProblem[] = [
      { code: "not_found" },
      { code: "not_active" },
      { code: "not_started", startsOn: "2026-11-15" },
      { code: "expired", endedOn: "2026-04-20" },
      { code: "sold_out" },
      { code: "budget_used" },
      { code: "wrong_property" },
      { code: "stay_outside_dates", stayFrom: "a", stayTo: "b" },
      { code: "stay_outside_dates", stayFrom: "a" },
      { code: "stay_outside_dates", stayTo: "b" },
      { code: "stay_outside_dates" },
      { code: "min_nights", minNights: 2, missingNights: 1 },
      { code: "min_nights", minNights: 3, missingNights: 2 },
      { code: "min_subtotal", minEligibleSubtotal: 200, eligibleSubtotal: 100 },
      { code: "nothing_eligible" },
    ];
    for (const locale of locales) {
      const catalog = messages(locale);
      for (const problem of problems) {
        const text = render(couponProblemMessage(problem, format), catalog);
        expect(text, `${locale} ${problem.code}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("offers the fix the guest can make from the review step", () => {
    expect(couponFix({ code: "min_nights", minNights: 3, missingNights: 2 })).toEqual({ kind: "add_nights", nights: 2 });
    expect(couponFix({ code: "stay_outside_dates" })).toEqual({ kind: "change_dates" });
    expect(couponFix({ code: "wrong_property" })).toEqual({ kind: "change_villa" });
    expect(couponFix({ code: "sold_out" })).toBeNull();
  });
});

describe("price summary lines", () => {
  it("shows the coupon line instead of the direct line when the coupon wins", () => {
    const offer = quote(450000, "2026-11-12", "2026-11-14");
    const price = stayPrice({ subtotal: 900000, directDiscount: 135000, code: "DCNT-F1-20", offer });
    expect(price).toEqual({
      subtotal: 900000,
      discount: 180000,
      total: 720000,
      lines: [{ kind: "coupon", code: "DCNT-F1-20", amount: 180000 }],
      couponApplied: true,
    });
  });

  it("shows the direct line when the coupon doesn't win", () => {
    const offer = quote(1200000, "2026-11-12", "2026-11-15");
    const price = stayPrice({ subtotal: 3600000, directDiscount: 540000, code: "DCNT-F1-20", offer });
    expect(price.lines).toEqual([{ kind: "direct", amount: 540000 }]);
    expect(price.total).toBe(3060000);
    expect(price.couponApplied).toBe(false);
  });

  it("ignores a preview for another stay, so a stale answer never sets the total", () => {
    const twoNights = quote(450000, "2026-11-12", "2026-11-14");
    const price = stayPrice({ subtotal: 1350000, directDiscount: 202500, code: "DCNT-F1-20", offer: twoNights });
    expect(price.total).toBe(1147500);
    expect(price.lines).toEqual([{ kind: "direct", amount: 202500 }]);
  });

  it("has no discount line without any discount", () => {
    expect(stayPrice({ subtotal: 420000, directDiscount: 0 }).lines).toEqual([]);
  });

  it("keeps the direct part of a stacked discount as its own line", () => {
    expect(discountLines(185000, { code: "DCNT-SPA-500", amount: 50000 })).toEqual([
      { kind: "coupon", code: "DCNT-SPA-500", amount: 50000 },
      { kind: "direct", amount: 135000 },
    ]);
    expect(discountLines(1800, { code: "DCNT-F1-20", amount: 180000 })).toEqual([{ kind: "coupon", code: "DCNT-F1-20", amount: 180000 }]);
    expect(discountLines(135000, null)).toEqual([{ kind: "direct", amount: 135000 }]);
  });
});

describe("coupon phase", () => {
  const applied = quote(450000, "2026-11-12", "2026-11-14");
  const minNights = quote(850000, "2026-11-12", "2026-11-13");

  it("follows the preview", () => {
    expect(couponPhase(null, { status: "ready", result: applied })).toEqual({ kind: "none" });
    expect(couponPhase("DCNT-F1-20", { status: "idle" })).toEqual({ kind: "pending" });
    expect(couponPhase("DCNT-F1-20", { status: "checking" })).toEqual({ kind: "checking" });
    expect(couponPhase("DCNT-F1-20", { status: "error" })).toEqual({ kind: "error" });
    expect(couponPhase("DCNT-F1-20", { status: "ready", result: applied }).kind).toBe("applied");
    expect(couponPhase("DCNT-F1-20", { status: "ready", result: minNights })).toMatchObject({ kind: "not_used", problem: { code: "min_nights" } });
    expect(couponPhase("DNCT-F1-20", { status: "ready", result: { ...applied, couponStatus: "invalid", applied: "direct", problem: { code: "not_found" } } })).toEqual({
      kind: "rejected",
      problem: { code: "not_found" },
    });
  });

  it("sends the code to bookings.create only when the preview applied it", () => {
    expect(couponCodeToSend("DCNT-F1-20", { kind: "applied", result: applied })).toBe("DCNT-F1-20");
    expect(couponCodeToSend("DCNT-F1-20", { kind: "worse", result: applied })).toBeUndefined();
    expect(couponCodeToSend("DCNT-F1-20", { kind: "checking" })).toBeUndefined();
    expect(couponCodeToSend("DCNT-F1-20", { kind: "error" })).toBeUndefined();
    expect(couponCodeToSend(null, { kind: "none" })).toBeUndefined();
  });

  it("notes a code that isn't saving anything under the summary", () => {
    const problemText = (problem: CouponProblem) => render(couponProblemMessage(problem, format));
    const note = (phase: Parameters<typeof summaryNote>[1]) => {
      const message = summaryNote("DCNT-F1-20", phase, problemText);
      return message ? render(message) : null;
    };
    expect(note({ kind: "not_used", result: minNights, problem: { code: "min_nights", minNights: 2, missingNights: 1 } })).toBe(
      "DCNT-F1-20 not used · Add 1 more night to use this code",
    );
    expect(note({ kind: "worse", result: applied })).toBe("DCNT-F1-20 not used · your direct rate is already better");
    expect(note({ kind: "pending" })).toBe("DCNT-F1-20 · choose dates to see your price");
    expect(note({ kind: "applied", result: applied })).toBeNull();
    expect(note({ kind: "rejected", problem: { code: "sold_out" } })).toBeNull();
  });
});

describe("booking records and errors", () => {
  it("reads a promotion only when its shape is right", () => {
    expect(bookingPromotion({ promotion: { couponId: "c1", couponVersion: 1, code: "DCNT-F1-20", discount: 180000, redemptionId: "r1" } })).toEqual({
      couponId: "c1",
      couponVersion: 1,
      code: "DCNT-F1-20",
      discount: 180000,
      redemptionId: "r1",
    });
    expect(bookingPromotion({ promotion: { code: "DCNT-F1-20", discount: 180000 } })).toEqual({ code: "DCNT-F1-20", discount: 180000 });
    expect(bookingPromotion({ total: 720000 })).toBeNull();
    expect(bookingPromotion({ promotion: null })).toBeNull();
    expect(bookingPromotion({ promotion: { code: "", discount: 100 } })).toBeNull();
    expect(bookingPromotion(null)).toBeNull();
  });

  it("recognises coupon_unavailable from bookings.create", () => {
    const error = new ConvexError({ code: "coupon_unavailable", message: "This offer has been fully used.", problem: { code: "sold_out" } });
    expect(couponUnavailableError(error)).toEqual({ message: "This offer has been fully used.", problem: { code: "sold_out" } });
    expect(couponUnavailableError(new ConvexError({ code: "coupon_unavailable", message: "Gone" }))).toEqual({ message: "Gone" });
    expect(couponUnavailableError(new ConvexError({ code: "dates_unavailable", message: "Taken" }))).toBeNull();
    expect(couponUnavailableError(new Error("coupon_unavailable"))).toBeNull();
  });

  it("shows a ConvexError's message, then an Error's, then the translated fallback", () => {
    expect(guestErrorText(new ConvexError({ code: "x", message: "Dates taken" }), "Fallback")).toBe("Dates taken");
    expect(guestErrorText(new Error("Network down"), "Fallback")).toBe("Network down");
    expect(guestErrorText("nope", "Fallback")).toBe("Fallback");
  });

  it("reads the quoted total from the pay URL", () => {
    expect(quotedTotalFromParam("7200")).toBe(7200);
    expect(quotedTotalFromParam("")).toBeNull();
    expect(quotedTotalFromParam("72e2")).toBeNull();
    expect(quotedTotalFromParam(null)).toBeNull();
  });
});

describe("booked price view", () => {
  const promotion = { code: "DCNT-F1-20", couponVersion: 1, discount: 180000 };

  it("shows the coupon line and the saving for a coupon-priced booking", () => {
    expect(bookedPriceView({ discountAmount: 180000, promotion })).toEqual({
      lines: [{ kind: "coupon", code: "DCNT-F1-20", amount: 180000 }],
      totalLabel: "total",
      saving: { code: "DCNT-F1-20", amount: 180000 },
    });
  });

  it("shows the direct discount and no saving without a coupon", () => {
    expect(bookedPriceView({ discountAmount: 135000 })).toEqual({ lines: [{ kind: "direct", amount: 135000 }], totalLabel: "total", saving: null });
  });

  it("shows only the stay price and agreed price for a custom price, even with a stale promotion", () => {
    // The audit's case: custom total 9,000 on a stay first booked at 7,200 with the coupon.
    expect(bookedPriceView({ discountAmount: 135000, customPrice: true, promotion })).toEqual({ lines: [], totalLabel: "agreedPrice", saving: null });
    expect(bookedPriceView({ discountAmount: 135000, customPrice: true })).toEqual({ lines: [], totalLabel: "agreedPrice", saving: null });
  });
});

describe("zero-total coupon refusal", () => {
  it("recognises the whole-stay refusal from bookings.create", () => {
    const err = new ConvexError({
      code: "coupon_unavailable",
      message: "This code covers the whole stay, so it can't be booked online. Please contact us.",
      problem: { code: "nothing_eligible" },
    });
    expect(couponCoversWholeStay(couponUnavailableError(err))).toBe(true);
    expect(couponCoversWholeStay(couponUnavailableError(new ConvexError({ code: "coupon_unavailable", problem: { code: "sold_out" } })))).toBe(false);
    expect(couponCoversWholeStay(couponUnavailableError(new Error("boom")))).toBe(false);
  });
});
