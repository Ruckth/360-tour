import { afterEach, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import { resolveMessagingReply } from "@/lib/chat/messaging-reply";
afterEach(() => vi.useRealTimers());
const base = { sessionId: "test-session", siteUrl: "https://example.com" };
it.each(["line", "facebook", "instagram", "whatsapp"] as const)(
  "uses the shared context concierge for %s questions",
  async (channel) => {
    const client = {
      query: vi.fn().mockResolvedValue(false),
      action: vi
        .fn()
        .mockResolvedValue({
          response: "Verified reply.",
          model: "test-model",
        }),
    };
    const result = await resolveMessagingReply({
      ...base,
      client,
      channel,
      messageText: "See prices",
    });
    expect(result).toEqual({
      responseText: "Verified reply.",
      replyMode: "ai",
    });
    expect(client.action).toHaveBeenCalledExactlyOnceWith(
      api.chatAi.generateReply,
      expect.objectContaining({ userMessage: "See prices", channel }),
    );
    expect(client.query).toHaveBeenCalledExactlyOnceWith(
      api.bookings.isChatBookingFlowActive,
      { sessionId: base.sessionId },
    );
  },
);
it("forwards localized LINE menus to the same concierge", async () => {
  const client = {
    query: vi.fn().mockResolvedValue(false),
    action: vi
      .fn()
      .mockResolvedValue({ response: "확인된 답변", model: "test" }),
  };
  await resolveMessagingReply({
    ...base,
    client,
    channel: "line",
    eventType: "postback",
    postbackData: "intent=pricing&locale=ko",
  });
  expect(client.action).toHaveBeenCalledWith(
    api.chatAi.generateReply,
    expect.objectContaining({ locale: "ko", userMessage: "가격 보기" }),
  );
});
it("preserves an active booking conversation and unknown handling", async () => {
  const client = {
    query: vi.fn().mockResolvedValue(true),
    action: vi
      .fn()
      .mockResolvedValue({
        response: "Please contact the host.",
        model: "unknown_fallback",
      }),
  };
  const result = await resolveMessagingReply({
    ...base,
    client,
    channel: "facebook",
    messageText: "yes",
  });
  expect(client.action).toHaveBeenCalledWith(
    api.chatAi.generateReply,
    expect.objectContaining({ bookingFlow: true }),
  );
  expect(result.replyMode).toBe("unknown_fallback");
});
it("bounds both context queries and generation and rejects empty replies", async () => {
  vi.useFakeTimers();
  const client = { query: vi.fn(() => new Promise(() => {})), action: vi.fn() };
  const pending = resolveMessagingReply({
    ...base,
    client,
    channel: "instagram",
    messageText: "Hello",
  });
  await vi.advanceTimersByTimeAsync(25000);
  expect((await pending).replyMode).toBe("failed");
  expect(client.action).not.toHaveBeenCalled();
  const empty = await resolveMessagingReply({
    ...base,
    client: {
      query: vi.fn().mockResolvedValue(false),
      action: vi.fn().mockResolvedValue({ response: " ", model: "test" }),
    },
    channel: "whatsapp",
    messageText: "Hello",
  });
  expect(empty.replyMode).toBe("failed");
});
