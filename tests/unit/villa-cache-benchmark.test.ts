import { expect, it } from "vitest";
import { villaBenchmarkNamespace, villaBenchmarkResponse } from "@/lib/server/villa-cache-benchmark";

it("requires a valid namespace, exact opt-in and Preview environment", () => {
  const enabled = { VERCEL_ENV: "preview", VILLA_BENCH_NAMESPACE: "1" };
  expect(villaBenchmarkNamespace("a-000001", enabled)).toBe("a-000001");
  expect(villaBenchmarkNamespace("a".repeat(48), enabled)).toHaveLength(48);
  for (const malformed of [null, "", "a".repeat(7), "a".repeat(49), "A-000001", "a_000001", "a-000001, a-000002"]) {
    expect(villaBenchmarkNamespace(malformed, enabled)).toBeUndefined();
  }
  for (const env of [{ VERCEL_ENV: "production", VILLA_BENCH_NAMESPACE: "1" }, { VERCEL_ENV: "preview" }, {}]) {
    expect(villaBenchmarkNamespace("a-000001", env)).toBeUndefined();
  }
});

// The Start room route sends these exact headers (tests/unit/start-room-route.test.ts).
it("marks a namespaced benchmark response private and labels its cache state", () => {
  expect(villaBenchmarkResponse("test-cache-11", "miss")).toEqual({
    "x-villa-cache-namespace": "test-cache-11",
    "x-villa-cache": "miss",
    "Cache-Control": "private, no-store",
  });
});
