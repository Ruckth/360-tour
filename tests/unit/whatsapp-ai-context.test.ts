import { describe, expect, it, vi } from "vitest";
import { resolveWhatsAppReply } from "@/lib/whatsapp/reply";

type ActionArgs = { channel?: string; userMessage?: string };

describe("WhatsApp answer routing", () => {
  it("sends an unmatched service question straight to the concierge, with no retired routing calls", async () => {
    // No approved/curated routing exists any more: a plain question goes guardrail -> concierge.
    const query = vi.fn(async () => null); // isChatBookingFlowActive -> not active
    const action = vi.fn(async (_reference: unknown, rawArgs: unknown) => {
      const args = rawArgs as ActionArgs;
      // The guardrail call carries no channel; the concierge call does.
      if (!args.channel) return null; // no guardrail hit
      return { response: "มีบริการ Traditional Thai Massage ราคา ฿1,500 ครับ", model: "openai/gpt-6-luna" };
    });
    const mutation = vi.fn(async () => null);

    const result = await resolveWhatsAppReply({
      client: { query, action, mutation },
      messageText: "มีบริการอะไรบ้าง",
      sessionId: "test-session",
      siteUrl: "https://tour.helpgueststay.com",
    });

    expect(result.responseText).toContain("Traditional Thai Massage");
    expect(result.replyMode).toBe("ai");
    expect(result.timedOut).toBe(false);

    // Exactly one concierge (generateReply) call, carrying the WhatsApp channel and the message.
    const generateCalls = action.mock.calls.filter((call) => (call[1] as ActionArgs).channel);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.[1]).toEqual(
      expect.objectContaining({ userMessage: "มีบริการอะไรบ้าง", channel: "whatsapp" }),
    );

    // No question-bank markClicked (or any) mutation is invoked.
    expect(mutation).not.toHaveBeenCalled();
  });
});
