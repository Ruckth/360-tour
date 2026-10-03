import { describe, expect, it, vi } from "vitest";
import { resolveWhatsAppReply } from "@/lib/whatsapp/reply";

describe("WhatsApp answer routing", () => {
  it("sends the latest production service question to the concierge when no preset matches", async () => {
    const query = vi.fn(async () => false);
    const action = vi.fn(async () => ({ response: "มีบริการ Traditional Thai Massage ราคา ฿1,500 ครับ", model: "openai/gpt-6-luna" }));
    const mutation = vi.fn(async () => null);

    const result = await resolveWhatsAppReply({
      client: { query, action, mutation },
      messageText: "มีบริการอะไรบ้าง",
      sessionId: "test-session",
      siteUrl: "https://tour.helpgueststay.com",
    });

    expect(result.responseText).toContain("Traditional Thai Massage");
    expect(result.replyMode).toBe("ai");
    expect(action.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      userMessage: "มีบริการอะไรบ้าง", channel: "whatsapp",
    }));
    expect(mutation).not.toHaveBeenCalled();
  });
});
