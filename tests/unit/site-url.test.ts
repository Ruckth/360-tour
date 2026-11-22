import { afterEach, expect, it, vi } from "vitest";
import { siteUrl } from "@/lib/site-url";

afterEach(() => vi.unstubAllEnvs());

it("builds public links at the origin when a deployment URL has a webhook path", () => {
  vi.stubEnv("SITE_URL", "https://preview.example.test/api/line/webhook?source=setup");
  expect(siteUrl()).toBe("https://preview.example.test");
});

it("preserves the local server port and rejects non-web URLs", () => {
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:4123/");
  expect(siteUrl()).toBe("http://localhost:4123");
  vi.stubEnv("SITE_URL", "file:///tmp/example");
  expect(() => siteUrl()).toThrow("HTTP or HTTPS");
});
