// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCouponRefusalReporter, couponRefusalDetails } from "@/lib/booking/coupon-refusals";
import { useCouponPreview } from "@/components/booking/useCouponPreview";
import type { OfferResult } from "convex/shared/offers";

let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("deduplicates normalized code/problem per page or order and swallows synchronous and asynchronous failures", async () => {
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  const report = createCouponRefusalReporter(send);
  expect(() => report("order1", " spa100 ", "sold_out", "pos")).not.toThrow();
  report("order1", "SPA100", "sold_out", "pos");
  report("order1", "SPA100", "expired", "pos");
  report("order2", "SPA100", "sold_out", "pos");
  report("order2", "SPA100", "other_error", "pos");
  report("order2", "", "not_found", "pos");
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledWith({ code: "SPA100", problem: "sold_out", surface: "pos" });
  expect(() => createCouponRefusalReporter(() => { throw new Error("unavailable"); })("page", "SPA", "expired", "booking")).not.toThrow();
});

it("extracts known engine and settlement refusals without reporting unrelated failures", () => {
  expect(couponRefusalDetails(new ConvexError({ code: "coupon_unavailable", problem: { code: "sold_out" }, couponCode: "SPA100" }))).toEqual({ problem: "sold_out", couponCode: "SPA100" });
  expect(couponRefusalDetails(new ConvexError({ code: "coupon_changed" }))).toEqual({ problem: "coupon_changed" });
  expect(couponRefusalDetails(new Error("network"))).toBeNull();
  expect(couponRefusalDetails(new ConvexError({ code: "coupon_unavailable", problem: { code: "unknown" } }))).toBeNull();
});

it.each(["invalid", "coupon_worse"] as const)("reports the guest's %s preview once while retries stay usable", async couponStatus => {
  const result: OfferResult = { applied: "direct", couponStatus, ...(couponStatus === "invalid" ? { problem: { code: "sold_out" as const } } : {}), subtotal: 100000, discount: 10000, directDiscount: 10000, couponDiscount: 5000, capped: false, total: 90000, allocation: [] };
  const mutation = vi.fn().mockRejectedValue(new Error("diagnostics offline"));
  const client = { query: vi.fn().mockResolvedValue(result), mutation } as unknown as ConvexReactClient;
  let latest: ReturnType<typeof useCouponPreview>;
  function Preview() { latest = useCouponPreview(client, "SPA100", { propertySlug: "villa", checkIn: "2026-11-15", checkOut: "2026-11-16" }); return null; }
  await act(async () => root.render(createElement(Preview)));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(latest!.preview).toEqual({ status: "ready", result });
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[0][1]).toEqual({ code: "SPA100", problem: couponStatus === "invalid" ? "sold_out" : "coupon_worse", surface: "booking" });
  await act(async () => latest!.retry());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(latest!.preview.status).toBe("ready");
  expect(mutation).toHaveBeenCalledTimes(1);
  // A refusal that only shows when the booking is made goes through the same count: new reasons once, known ones not again.
  latest!.reportRefusal("SPA100", "budget_used");
  latest!.reportRefusal("SPA100", "budget_used");
  latest!.reportRefusal("SPA100", couponStatus === "invalid" ? "sold_out" : "coupon_worse");
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(mutation.mock.calls[1][1]).toEqual({ code: "SPA100", problem: "budget_used", surface: "booking" });
});
