import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaSignature } from "@/lib/meta/signature";

async function instagramWebhookRoute() {
  return await import("@/app/api/instagram/webhook/route");
}

describe("Instagram webhook route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the Meta challenge for a valid verify token", async () => {
    vi.stubEnv("INSTAGRAM_VERIFY_TOKEN", "verify-secret");
    const { GET } = await instagramWebhookRoute();

    const response = await GET(
      new Request(
        "https://tour.helpgueststay.com/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=hello",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("hello");
  });

  it("rejects an invalid verify token", async () => {
    vi.stubEnv("INSTAGRAM_VERIFY_TOKEN", "verify-secret");
    const { GET } = await instagramWebhookRoute();

    const response = await GET(
      new Request(
        "https://tour.helpgueststay.com/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=hello",
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid verification token",
    });
  });

  it("rejects unsupported webhook objects", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret");
    const { POST } = await instagramWebhookRoute();
    const body = JSON.stringify({ object: "page", entry: [] });

    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/instagram/webhook", {
        method: "POST",
        body,
        headers: {
          "x-hub-signature-256": createMetaSignature(body, "ig-secret"),
        },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Unsupported Instagram webhook object",
    });
  });
});
