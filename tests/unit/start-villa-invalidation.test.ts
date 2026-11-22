import { expect, it, vi } from "vitest";
import { handleVillaInvalidation } from "@/start-app/villa-invalidation.server";

const secret = "isolated-test-villa-cache-signing-secret";

function request(body: string, authorization?: string, contentType = "application/json") {
  return new Request("https://preview.invalid/api/internal/villa-cache", {
    method: "POST",
    body,
    headers: { "content-type": contentType, ...(authorization && { authorization }) },
  });
}

it("requires configured server authentication before reading or expiring slugs", async () => {
  const expire = vi.fn<(slug: string) => Promise<{ status: "confirmed" | "unconfirmed" | "local" }>>().mockResolvedValue({ status: "confirmed" });
  const disabled = request("not-json", "Bearer " + secret);
  const unauthorized = request("not-json", "Bearer invalid");
  expect((await handleVillaInvalidation(disabled, undefined, expire)).status).toBe(404);
  expect((await handleVillaInvalidation(unauthorized, secret, expire)).status).toBe(401);
  expect(unauthorized.bodyUsed).toBe(false);
  expect(expire).not.toHaveBeenCalled();
});

it("expires only valid, unique slugs and never caches the response", async () => {
  const expire = vi.fn<(slug: string) => Promise<{ status: "confirmed" | "unconfirmed" | "local" }>>().mockResolvedValue({ status: "confirmed" });
  for (const body of ["not-json", '{"slugs":[]}', '{"slugs":["../admin"]}', '{"slugs":["a","b","c"]}']) {
    expect((await handleVillaInvalidation(request(body, "Bearer " + secret), secret, expire)).status).toBe(400);
  }
  expect((await handleVillaInvalidation(request("{}", "Bearer " + secret, "text/plain"), secret, expire)).status).toBe(415);
  expect(expire).not.toHaveBeenCalled();
  const response = await handleVillaInvalidation(request('{"slugs":["villa-old","villa-new"]}', "Bearer " + secret), secret, expire);
  expect(response.status).toBe(204);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(expire.mock.calls).toEqual([["villa-old"], ["villa-new"]]);
});

it("acknowledges only confirmed shared invalidation and labels process-only scope", async () => {
  const body = '{"slugs":["villa-old","villa-new"]}';
  const unconfirmed = vi.fn().mockResolvedValueOnce({ status: "confirmed" }).mockResolvedValueOnce({ status: "unconfirmed" });
  const failed = await handleVillaInvalidation(request(body, "Bearer " + secret), secret, unconfirmed);
  expect(failed.status).toBe(503);
  expect(failed.headers.get("Retry-After")).toBe("1");
  const local = await handleVillaInvalidation(request(body, "Bearer " + secret), secret, vi.fn().mockResolvedValue({ status: "local" }));
  expect(local.status).toBe(204);
  expect(local.headers.get("X-Villa-Cache-Scope")).toBe("process");
});
