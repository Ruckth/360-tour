import { normalizeCouponCode, type CouponProblem, type OfferResult } from "convex/lib/offers";

// Pure coupon logic for the guest booking funnel: reading ?coupon=, sorting a preview into
// what the guest sees, the message keys (Coupon.* in messages/*.json) and the price lines.
// No React and no next-intl, so it's unit-tested; components translate the keys.

/** Same shape saveCoupon accepts: 3 to 32 letters, numbers or hyphens. */
const CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;

/**
 * The code from a `?coupon=` query param, normalised ("dcnt-f1-20 " → "DCNT-F1-20"),
 * or "" when it's missing or can't be a code. Only the first value counts.
 */
export function couponFromParam(raw: string | readonly string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";
  const code = normalizeCouponCode(value);
  return CODE_PATTERN.test(code) ? code : "";
}

/**
 * Problems a different villa or stay can't fix. The funnel treats them as a rejected entry:
 * the code isn't kept, and the guest sees why under the input.
 */
const REJECTING: ReadonlySet<CouponProblem["code"]> = new Set([
  "not_found",
  "not_active",
  "not_started",
  "expired",
  "sold_out",
  "budget_used",
  // On a villa booking only a services coupon has nothing to discount.
  "nothing_eligible",
]);

export type CouponVerdict =
  /** The coupon beats the direct offer and is sent with the booking. */
  | { kind: "applied" }
  /** Valid, but the direct offer saves more; the guest keeps the direct price. */
  | { kind: "worse" }
  /** Valid code that doesn't fit this villa or these dates; kept so a change can fix it. */
  | { kind: "not_used"; problem: CouponProblem }
  /** Can't be used for any stay right now. */
  | { kind: "rejected"; problem: CouponProblem };

export function couponVerdict(result: Pick<OfferResult, "couponStatus" | "problem">): CouponVerdict {
  if (result.couponStatus === "applied") return { kind: "applied" };
  if (result.couponStatus === "coupon_worse") return { kind: "worse" };
  const problem: CouponProblem = result.problem ?? { code: "not_found" };
  return REJECTING.has(problem.code) ? { kind: "rejected", problem } : { kind: "not_used", problem };
}

export type CouponFormatters = {
  money: (amount: number) => string;
  /** YYYY-MM-DD → a short local date. */
  date: (iso: string) => string;
  /** Inclusive YYYY-MM-DD range → a short local range. */
  range: (from: string, to: string) => string;
};

/** A key under the `Coupon` namespace and its values. */
export type CouponMessage = { key: string; values?: Record<string, string | number> };

/** One short guest-facing sentence (no full stop) for why the code didn't apply. */
export function couponProblemMessage(problem: CouponProblem, format: CouponFormatters): CouponMessage {
  switch (problem.code) {
    case "not_found":
      return { key: "problem.notFound" };
    case "not_active":
      return { key: "problem.notActive" };
    case "not_started":
      return { key: "problem.notStarted", values: { date: format.date(problem.startsOn) } };
    case "expired":
      return { key: "problem.expired", values: { date: format.date(problem.endedOn) } };
    case "sold_out":
      return { key: "problem.soldOut" };
    case "budget_used":
      return { key: "problem.budgetUsed" };
    case "wrong_property":
      return { key: "problem.wrongProperty" };
    case "stay_outside_dates":
      if (problem.stayFrom && problem.stayTo) return { key: "problem.stayBetween", values: { range: format.range(problem.stayFrom, problem.stayTo) } };
      if (problem.stayFrom) return { key: "problem.stayFrom", values: { date: format.date(problem.stayFrom) } };
      if (problem.stayTo) return { key: "problem.stayUntil", values: { date: format.date(problem.stayTo) } };
      return { key: "problem.stayOutside" };
    case "min_nights": {
      const count = Math.max(1, problem.missingNights);
      return count === 1 ? { key: "problem.minNightsOne" } : { key: "problem.minNightsOther", values: { count } };
    }
    case "min_subtotal":
      return { key: "problem.minSubtotal", values: { amount: format.money(Math.max(0, problem.minEligibleSubtotal - problem.eligibleSubtotal)) } };
    case "nothing_eligible":
      return { key: "problem.nothingEligible" };
  }
}

/** What the guest can do about a problem from the review step, if anything. */
export type CouponFix = { kind: "add_nights"; nights: number } | { kind: "change_dates" } | { kind: "change_villa" } | null;

export function couponFix(problem: CouponProblem): CouponFix {
  if (problem.code === "min_nights") return { kind: "add_nights", nights: Math.max(1, problem.missingNights) };
  if (problem.code === "stay_outside_dates") return { kind: "change_dates" };
  if (problem.code === "wrong_property") return { kind: "change_villa" };
  return null;
}

export type PriceLine = { kind: "coupon"; code: string; amount: number } | { kind: "direct"; amount: number };

/**
 * The discount lines under the stay price. A coupon line replaces the direct-discount line;
 * any discount beyond the coupon (a services coupon stacked on the direct offer) stays a direct line.
 */
export function discountLines(discount: number, coupon?: { code: string; amount: number } | null): PriceLine[] {
  if (!coupon || coupon.amount <= 0) return discount > 0 ? [{ kind: "direct", amount: discount }] : [];
  const rest = discount - coupon.amount;
  return [{ kind: "coupon", code: coupon.code, amount: coupon.amount }, ...(rest > 0 ? [{ kind: "direct" as const, amount: rest }] : [])];
}

export type StayPrice = { subtotal: number; discount: number; total: number; lines: PriceLine[]; couponApplied: boolean };

/**
 * The price the funnel shows. With an applied coupon it's the preview's own numbers (the same
 * engine prices the booking); otherwise the direct quote. A preview for another stay (its
 * subtotal differs) is ignored, so a stale answer never sets the total.
 */
export function stayPrice({
  subtotal,
  directDiscount,
  code,
  offer,
}: {
  subtotal: number;
  directDiscount: number;
  code?: string | null;
  offer?: OfferResult | null;
}): StayPrice {
  if (code && offer && offer.couponStatus === "applied" && offer.applied === "coupon" && offer.subtotal === subtotal) {
    return {
      subtotal: offer.subtotal,
      discount: offer.discount,
      total: offer.total,
      lines: discountLines(offer.discount, { code, amount: offer.couponDiscount }),
      couponApplied: true,
    };
  }
  return { subtotal, discount: directDiscount, total: subtotal - directDiscount, lines: discountLines(directDiscount), couponApplied: false };
}

/** The coupon stored on a booking, as the public and admin booking queries may return it. */
export type BookingPromotion = {
  couponId?: string;
  couponVersion?: number;
  code: string;
  discount: number;
  redemptionId?: string;
};

/** Reads `promotion` off a booking row without trusting its shape (older queries don't return it). */
export function bookingPromotion(booking: unknown): BookingPromotion | null {
  if (!booking || typeof booking !== "object" || !("promotion" in booking)) return null;
  const promotion = (booking as { promotion?: unknown }).promotion;
  if (!promotion || typeof promotion !== "object") return null;
  const { code, discount, couponId, couponVersion, redemptionId } = promotion as Record<string, unknown>;
  if (typeof code !== "string" || !code || typeof discount !== "number" || !Number.isFinite(discount)) return null;
  return {
    code,
    discount,
    ...(typeof couponId === "string" && { couponId }),
    ...(typeof couponVersion === "number" && { couponVersion }),
    ...(typeof redemptionId === "string" && { redemptionId }),
  };
}

export type CouponUnavailable = { message?: string; problem?: CouponProblem };

/**
 * The message to show a guest for a failed Convex call: a ConvexError's `data.message`, then a
 * plain Error's message, then the translated `fallback`.
 */
export function guestErrorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const message = (error as { data?: { message?: unknown } }).data?.message;
    if (typeof message === "string" && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isProblem(value: unknown): value is CouponProblem {
  return Boolean(value) && typeof value === "object" && typeof (value as { code?: unknown }).code === "string";
}

/** The `coupon_unavailable` ConvexError from bookings.create, or null for any other error. */
export function couponUnavailableError(error: unknown): CouponUnavailable | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || (data as { code?: unknown }).code !== "coupon_unavailable") return null;
  const { message, problem } = data as { message?: unknown; problem?: unknown };
  return {
    ...(typeof message === "string" && message && { message }),
    ...(isProblem(problem) ? { problem } : {}),
  };
}

/** The extra query param the funnel adds to the pay page so it can flag a total that moved. */
export function quotedTotalFromParam(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Where the attached code stands, as the review step and the price summary show it. */
export type CouponPhase =
  | { kind: "none" }
  /** No villa and dates to price it on yet (or no live inventory). */
  | { kind: "pending" }
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "applied"; result: OfferResult }
  | { kind: "worse"; result: OfferResult }
  | { kind: "not_used"; result: OfferResult; problem: CouponProblem }
  | { kind: "rejected"; problem: CouponProblem };

export type PreviewState = { status: "idle" } | { status: "checking" } | { status: "error" } | { status: "ready"; result: OfferResult };

export function couponPhase(code: string | null, preview: PreviewState): CouponPhase {
  if (!code) return { kind: "none" };
  if (preview.status === "idle") return { kind: "pending" };
  if (preview.status === "checking") return { kind: "checking" };
  if (preview.status === "error") return { kind: "error" };
  const verdict = couponVerdict(preview.result);
  if (verdict.kind === "rejected") return verdict;
  if (verdict.kind === "not_used") return { kind: "not_used", result: preview.result, problem: verdict.problem };
  return { kind: verdict.kind, result: preview.result };
}

/** Only a code the live preview applied goes to bookings.create; anything else books at the direct price. */
export function couponCodeToSend(code: string | null, phase: CouponPhase): string | undefined {
  return code && phase.kind === "applied" ? code : undefined;
}

/** The summary's one-line note about a code that isn't saving anything, or null. */
export function summaryNote(code: string | null, phase: CouponPhase, problemText: (problem: CouponProblem) => string): CouponMessage | null {
  if (!code) return null;
  switch (phase.kind) {
    case "pending":
      return { key: "summaryPending", values: { code } };
    case "checking":
      return { key: "summaryChecking", values: { code } };
    case "worse":
      return { key: "summaryWorse", values: { code } };
    case "not_used":
      return { key: "summaryNotUsed", values: { code, reason: problemText(phase.problem) } };
    default:
      return null;
  }
}
