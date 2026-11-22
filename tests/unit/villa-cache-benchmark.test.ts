import { once } from "node:events";
import { createServer, ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { installNextVillaBenchmarkHook, recordNextVillaBenchmark } from "@/lib/server/next-villa-benchmark";
import {
  VILLA_BENCH_REQUEST_ID_HEADER,
  VILLA_BENCH_REQUEST_HEADER,
  VILLA_CACHE_HEADER,
  VILLA_CACHE_NAMESPACE_HEADER,
  villaBenchmarkNamespace,
} from "@/lib/server/villa-cache-benchmark";

afterEach(() => vi.unstubAllEnvs());

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

it("writes an actual Node response header pair for the matching request only", async () => {
  vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  const original = ServerResponse.prototype.writeHead;
  installNextVillaBenchmarkHook();
  expect(ServerResponse.prototype.writeHead).toBe(original);
  vi.stubEnv("VERCEL_ENV", "preview");
  installNextVillaBenchmarkHook();
  const origin = createServer((request, response) => {
    if (request.url === "/measured") recordNextVillaBenchmark("run-1", "test-cache-11", "miss");
    if (request.url === "/wrong-namespace") recordNextVillaBenchmark("run-1", "test-cache-22", "hit");
    response.setHeader("Content-Type", "text/html");
    response.end("<h1>Villa</h1>");
  });
  try {
    origin.listen(0, "127.0.0.1");
    await once(origin, "listening");
    const address = origin.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test socket");
    const url = `http://127.0.0.1:${address.port}`;
    const headers = {
      [VILLA_BENCH_REQUEST_HEADER]: "test-cache-11",
      [VILLA_BENCH_REQUEST_ID_HEADER]: "run-1",
    };
    for (const [path, observed] of [
      ["/measured", "miss"], ["/measured", "miss"], ["/ordinary", null], ["/wrong-namespace", null],
    ] as const) {
      const response = await fetch(url + path, { headers });
      expect(response.headers.get(VILLA_CACHE_HEADER)).toBe(observed);
      expect(response.headers.get(VILLA_CACHE_NAMESPACE_HEADER)).toBe(observed ? "test-cache-11" : null);
      expect(response.headers.get("cache-control")).toBe(observed ? "private, no-store" : null);
      expect(await response.text()).toBe("<h1>Villa</h1>");
    }
  } finally {
    ServerResponse.prototype.writeHead = original;
    await new Promise<void>((resolve, reject) => {
      origin.close((error) => error ? reject(error) : resolve());
      origin.closeAllConnections();
    });
  }
});
