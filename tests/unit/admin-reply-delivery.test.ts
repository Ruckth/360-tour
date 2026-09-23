import { describe, expect, it, vi } from "vitest";
import { deliverAdminReply } from "@/lib/admin/reply-delivery";

describe("admin reply delivery", () => {
  it("sends a LINE push message to the session recipient", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await deliverAdminReply(
      {
        channel: "line",
        recipient: "Uline123",
        content: "Hello from admin",
        requestId: "ad7d4fca-4b09-4286-a125-f3e60b03ce06",
      },
      { LINE_CHANNEL_ACCESS_TOKEN: "test-token" },
      send,
    );

    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(options?.headers).toMatchObject({
      authorization: "Bearer test-token",
      "x-line-retry-key": "ad7d4fca-4b09-4286-a125-f3e60b03ce06",
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      to: "Uline123",
      messages: [{ type: "text", text: "Hello from admin" }],
    });
  });

  it("does not call a channel API for web replies", async () => {
    const send = vi.fn<typeof fetch>();
    await deliverAdminReply(
      { channel: "web", recipient: null, content: "Hello", requestId: "reply" },
      {},
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("surfaces a rejected provider reply", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 403 }));
    await expect(
      deliverAdminReply(
        { channel: "line", recipient: "Uline123", content: "Hello", requestId: "reply" },
        { LINE_CHANNEL_ACCESS_TOKEN: "test-token" },
        send,
      ),
    ).rejects.toThrow("line rejected the reply (403)");
  });
});
