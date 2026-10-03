import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructed, authenticated, mutation, deliver } = vi.hoisted(() => ({
  constructed: vi.fn(),
  authenticated: vi.fn(),
  mutation: vi.fn(),
  deliver: vi.fn(),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) {
      constructed(url);
    }
    setAuth(token: string) {
      authenticated(token);
    }
    mutation = mutation;
  },
}));
vi.mock("@/lib/admin/reply-delivery", () => ({ deliverAdminReply: deliver }));
import { POST } from "@/app/api/admin/chat/reply/route";

function request() {
  return new Request("http://localhost/api/admin/chat/reply", {
    method: "POST",
    headers: { authorization: "Bearer test-admin-token", "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "test-session",
      requestId: "00000000-0000-4000-8000-000000000001",
      content: "A test reply",
    }),
  });
}

describe("admin reply endpoint configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", undefined);
    vi.stubEnv("PUBLIC_CONVEX_URL", undefined);
    mutation.mockResolvedValueOnce({ state: "new", channel: "web" }).mockResolvedValueOnce(null);
    deliver.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("delivers and completes a reply when only the legacy URL used by the app is configured", async () => {
    vi.stubEnv("PUBLIC_CONVEX_URL", "https://legacy.convex.cloud");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, channel: "web" });
    expect(constructed).toHaveBeenCalledWith("https://legacy.convex.cloud");
    expect(authenticated).toHaveBeenCalledWith("test-admin-token");
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ channel: "web", content: "A test reply" }));
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("prefers the current URL when both environment names exist", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://current.convex.cloud");
    vi.stubEnv("PUBLIC_CONVEX_URL", "https://legacy.convex.cloud");
    expect((await POST(request())).status).toBe(200);
    expect(constructed).toHaveBeenCalledWith("https://current.convex.cloud");
  });

  it("does not claim or deliver a reply when the backend is not configured", async () => {
    expect((await POST(request())).status).toBe(503);
    expect(mutation).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
