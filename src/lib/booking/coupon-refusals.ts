import { COUPON_REFUSAL_PROBLEMS, type CouponRefusalProblem, type CouponRefusalSurface } from "convex/lib/marketingReport";
import { normalizeCouponCode } from "convex/lib/offers";

export type RefusalNote = { code: string; problem: CouponRefusalProblem; surface: CouponRefusalSurface };
const isProblem = (value: unknown): value is CouponRefusalProblem => typeof value === "string" && COUPON_REFUSAL_PROBLEMS.some(problem => problem === value);

/** Diagnostic requests must never change, delay or fail a booking/payment action. */
export function createCouponRefusalReporter(send: (note: RefusalNote) => Promise<unknown>) {
  const seen = new Set<string>();
  return (scope: string, code: string, problem: unknown, surface: CouponRefusalSurface) => {
    const normalized = normalizeCouponCode(code);
    if (!normalized || !isProblem(problem)) return;
    const key = JSON.stringify([scope, normalized, problem, surface]);
    if (seen.has(key)) return;
    seen.add(key);
    try { void send({ code: normalized, problem, surface }).catch(() => {}); } catch { /* Diagnostics are best effort. */ }
  };
}

/** Engine refusals and settle-time saving changes share this reporting shape. */
export function couponRefusalDetails(error: unknown): { problem: CouponRefusalProblem; couponCode?: string } | null {
  const data = error && typeof error === "object" && "data" in error ? error.data : null;
  if (!data || typeof data !== "object" || !("code" in data)) return null;
  const problem = data.code === "coupon_changed" ? "coupon_changed" : data.code === "coupon_unavailable" && "problem" in data && data.problem && typeof data.problem === "object" && "code" in data.problem ? data.problem.code : null;
  return isProblem(problem) ? { problem, ...("couponCode" in data && typeof data.couponCode === "string" ? { couponCode: data.couponCode } : {}) } : null;
}
