import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBoundedMemoryCache } from "@/lib/server/villa-runtime-cache";

vi.mock("@tanstack/react-start/server", () => ({ getRequest: vi.fn(), setResponseHeader: vi.fn() }));
const { countVillaRead, faultableVillaCache, holdVillaRead, villaFaultConfig, villaFaultRequested } = await import("@/lib/server/villa-read-fault.fixture");

const token = "t".repeat(48);
const digest = createHash("sha256").update(token).digest("hex");

describe("villa outage fixture", () => {
  it("is inert outside a fully configured Preview", () => {
    expect(villaFaultConfig({ VERCEL_ENV: "production", VILLA_FAULT_TOKEN_SHA256: digest, VILLA_FAULT_RUN: "run-abcdef" })).toBeUndefined();
    expect(villaFaultConfig({ VERCEL_ENV: "preview", VILLA_FAULT_RUN: "run-abcdef" })).toBeUndefined();
    expect(villaFaultConfig({ VERCEL_ENV: "preview", VILLA_FAULT_TOKEN_SHA256: digest })).toBeUndefined();
    expect(villaFaultRequested(undefined, token)).toBe(false);
  });

  it("accepts only the deployment's token", () => {
    const config = villaFaultConfig({ VERCEL_ENV: "preview", VILLA_FAULT_TOKEN_SHA256: digest, VILLA_FAULT_RUN: "run-abcdef" });
    expect(villaFaultRequested(config, token)).toBe(true);
    expect(villaFaultRequested(config, "u".repeat(48))).toBe(false);
    expect(villaFaultRequested(config, null)).toBe(false);
  });

  it("performs the real read, then fails it after the hold", async () => {
    const read = vi.fn().mockResolvedValue({ villa: {} });
    const start = Date.now();
    await expect(holdVillaRead(read, 50)).rejects.toThrow("held");
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    expect(read).toHaveBeenCalledOnce();
  });

  it("counts detail reads apart from other villa reads", () => {
    const counts = { upstream: 0, held: 0, detail: 0, detailHeld: 0 };
    countVillaRead("catalog/publicProperties:getBySlug", true, counts);
    countVillaRead("catalog/publicProperties:getBySlug", false, counts);
    countVillaRead("catalog/publicProperties:list", true, counts);
    expect(counts).toEqual({ upstream: 3, held: 2, detail: 2, detailHeld: 1 });
  });

  it("namespaces keys and tags for the run", async () => {
    const shared = createBoundedMemoryCache();
    const fixture = faultableVillaCache(shared, "run-abcdef");
    await fixture.set("detail:a", { v: 1 }, { tags: ["villas:preview"] });
    await shared.set("detail:a", { v: 2 }, { tags: ["villas:preview"] });
    expect(await fixture.get("detail:a")).toEqual({ v: 1 });
    await shared.expireTag("villas:preview");
    expect(await fixture.get("detail:a")).toEqual({ v: 1 });
    await fixture.expireTag("villas:preview");
    expect(await fixture.get("detail:a")).toBeNull();
  });
});
