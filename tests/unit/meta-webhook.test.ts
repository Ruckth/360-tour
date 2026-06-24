import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaSignature, verifyMetaSignature } from "@/lib/meta/signature";

function signedRequest(url: string, body: string, secret: string) {
  return new Request(url, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": createMetaSignature(body, secret),
    },
  });
}

async function facebookWebhookRoute() {
  return await import("@/app/api/facebook/webhook/route");
}

async function instagramWebhookRoute() {
  return await import("@/app/api/instagram/webhook/route");
}

async function whatsappWebhookRoute() {
  return await import("@/app/api/whatsapp/webhook/route");
}

describe("Meta webhook signature helpers", () => {
  it("verifies Meta HMAC signatures using the raw body", () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const signature = createMetaSignature(body, "app-secret");

    expect(verifyMetaSignature({ appSecret: "app-secret", body, signature })).toBe(true);
    expect(verifyMetaSignature({ appSecret: "app-secret", body: `${body}\n`, signature })).toBe(false);
  });

  it("rejects missing and malformed Meta signatures", () => {
    const body = JSON.stringify({ object: "page", entry: [] });

    expect(verifyMetaSignature({ appSecret: "app-secret", body, signature: undefined })).toBe(false);
    expect(verifyMetaSignature({ appSecret: "app-secret", body, signature: "sha1=bad" })).toBe(false);
    expect(verifyMetaSignature({ appSecret: "app-secret", body, signature: "sha256=not-hex" })).toBe(false);
  });
});

describe("Meta webhook POST verification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a Facebook app secret before parsing POST bodies", async () => {
    vi.stubEnv("FACEBOOK_ACCESS_TOKEN", "fb-token");
    const { POST } = await facebookWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/facebook/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "page", entry: [] }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "FACEBOOK_APP_SECRET or META_APP_SECRET is required",
    });
  });

  it("rejects invalid Facebook POST signatures", async () => {
    vi.stubEnv("FACEBOOK_ACCESS_TOKEN", "fb-token");
    vi.stubEnv("FACEBOOK_APP_SECRET", "fb-secret");
    const { POST } = await facebookWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/facebook/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "page", entry: [] }),
        headers: { "x-hub-signature-256": "sha256=bad" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a valid signed Facebook payload without events", async () => {
    vi.stubEnv("FACEBOOK_ACCESS_TOKEN", "fb-token");
    vi.stubEnv("FACEBOOK_APP_SECRET", "fb-secret");
    const { POST } = await facebookWebhookRoute();
    const body = JSON.stringify({ object: "page", entry: [] });
    const response = await POST(signedRequest("https://tour.helpgueststay.com/api/facebook/webhook", body, "fb-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 0 });
  });

  it("requires an Instagram app secret before parsing POST bodies", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    const { POST } = await instagramWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/instagram/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "instagram", entry: [] }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "INSTAGRAM_APP_SECRET or META_APP_SECRET is required",
    });
  });

  it("rejects invalid Instagram POST signatures", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret");
    const { POST } = await instagramWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/instagram/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "instagram", entry: [] }),
        headers: { "x-hub-signature-256": "sha256=bad" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a valid signed Instagram payload without events", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret");
    const { POST } = await instagramWebhookRoute();
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const response = await POST(signedRequest("https://tour.helpgueststay.com/api/instagram/webhook", body, "ig-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 0 });
  });

  it("requires a WhatsApp app secret before parsing POST bodies", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "wa-token");
    const { POST } = await whatsappWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "WHATSAPP_APP_SECRET or META_APP_SECRET is required",
    });
  });

  it("rejects invalid WhatsApp POST signatures", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "wa-token");
    vi.stubEnv("WHATSAPP_APP_SECRET", "wa-secret");
    const { POST } = await whatsappWebhookRoute();
    const response = await POST(
      new Request("https://tour.helpgueststay.com/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
        headers: { "x-hub-signature-256": "sha256=bad" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a valid signed WhatsApp payload without messages", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "wa-token");
    vi.stubEnv("WHATSAPP_APP_SECRET", "wa-secret");
    const { POST } = await whatsappWebhookRoute();
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const response = await POST(signedRequest("https://tour.helpgueststay.com/api/whatsapp/webhook", body, "wa-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 0, statuses: 0 });
  });
});
