import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGING_REPLY_TIMEOUT_MS,
  recordLateMessagingResult,
  resolveMessagingReply,
  type IncomingMessage,
  type MessagingChannel,
  type MessagingClient,
} from "@/lib/chat/messaging-reply";

type ActionArgs = {
  channel?: string;
  userMessage?: string;
  siteUrl?: string;
  bookingFlow?: boolean;
};

const CHANNELS: MessagingChannel[] = ["line", "facebook", "instagram", "whatsapp"];

/**
 * A fake Convex client. `generate` controls what api.chatAi.generateReply resolves to;
 * `guardrail` makes generateReply answer with its deterministic policy reply (model
 * "guardrail"); `bookingActive` controls api.bookings.isChatBookingFlowActive.
 */
function makeClient(options: {
  guardrail?: string | null;
  generate?: (args: ActionArgs) => Promise<{ response?: string; model?: string; committed?: { tool: string } }>;
  bookingActive?: boolean;
}) {
  const query = vi.fn(async () => options.bookingActive ?? false);
  const action = vi.fn(async (_reference: unknown, rawArgs: unknown) => {
    const args = rawArgs as ActionArgs;
    if (options.guardrail) return { response: options.guardrail, model: "guardrail" };
    return options.generate
      ? await options.generate(args)
      : { response: "concierge reply", model: "openai/gpt-6-luna" };
  });
  const client: MessagingClient = { query, action };
  return { client, query, action };
}

function incoming(channel: MessagingChannel, overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channel,
    sessionId: "sess_1",
    siteUrl: "https://tour.helpgueststay.com",
    kind: "message",
    text: "Which villa has the best view?",
    ...overrides,
  };
}

/** Every Convex function the seam called; only the shared concierge path is allowed. */
function calledFunctions(action: ReturnType<typeof vi.fn>, query: ReturnType<typeof vi.fn>) {
  return [...action.mock.calls, ...query.mock.calls].map((call) =>
    getFunctionName(call[0] as FunctionReference<"action" | "query">),
  );
}
const ALLOWED_FUNCTIONS = ["chatAi:generateReply", "bookings:isChatBookingFlowActive"];

describe("resolveMessagingReply — cross-channel parity", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const channel of CHANNELS) {
    it(`[${channel}] ordinary text -> one generateReply call with the channel and no booking flag`, async () => {
      const { client, action, query } = makeClient({});
      const result = await resolveMessagingReply(client, incoming(channel));

      expect(result.replyMode).toBe("ai");
      expect(result.responseText).toBe("concierge reply");
      expect(result.timedOut).toBe(false);

      const generateCalls = action.mock.calls.filter((c) => (c[1] as ActionArgs).channel);
      expect(generateCalls).toHaveLength(1);
      expect(generateCalls[0]?.[1]).toEqual(
        expect.objectContaining({ channel, userMessage: "Which villa has the best view?" }),
      );
      expect((generateCalls[0]?.[1] as ActionArgs).bookingFlow).toBeUndefined();

      // Zero retired routing calls (resolveExact, resolveCuratedExact/Semantic, markClicked, guardrail action).
      const called = calledFunctions(action, query);
      expect(called).toContain("chatAi:generateReply");
      for (const name of called) expect(ALLOWED_FUNCTIONS).toContain(name);
    });

    it(`[${channel}] a booking-intent message sets bookingFlow true`, async () => {
      const { client, action } = makeClient({});
      const result = await resolveMessagingReply(client, incoming(channel, { text: "Can I book the pool villa?" }));
      expect(result.replyMode).toBe("ai");
      const generateCalls = action.mock.calls.filter((c) => (c[1] as ActionArgs).channel);
      expect((generateCalls[0]?.[1] as ActionArgs).bookingFlow).toBe(true);
    });

    it(`[${channel}] a guardrail reply from the concierge is delivered as guardrail in one action call`, async () => {
      const { client, action } = makeClient({ guardrail: "We present this as a demo experience." });
      const result = await resolveMessagingReply(client, incoming(channel));
      expect(result.replyMode).toBe("guardrail");
      expect(result.metrics.guardrail).toBe(true);
      expect(result.responseText).toContain("demo experience");
      // One action round trip: generateReply applies the policy reply before any model call.
      expect(action).toHaveBeenCalledTimes(1);
    });

    it(`[${channel}] generateReply throwing yields one failure path, no crash`, async () => {
      const { client } = makeClient({
        generate: async () => {
          throw new Error("provider down");
        },
      });
      const result = await resolveMessagingReply(client, incoming(channel));
      expect(result.replyMode).toBe("failed");
      expect(result.timedOut).toBe(false);
      expect(result.lateResult).toBeUndefined();
    });
  }

  it("line follow -> greeting with the quick-reply menu, no model call", async () => {
    const { client, action } = makeClient({});
    const result = await resolveMessagingReply(client, incoming("line", { kind: "follow", text: undefined }));
    expect(result.replyMode).toBe("follow");
    expect(result.quickReplyItems?.length).toBeGreaterThan(0);
    expect(action).not.toHaveBeenCalled();
  });

  it("line postback -> the guest's question text is sent to the concierge", async () => {
    const seen: ActionArgs[] = [];
    const { client } = makeClient({
      generate: async (args) => {
        seen.push(args);
        return { response: "Here are our villas…", model: "openai/gpt-6-luna" };
      },
    });
    const result = await resolveMessagingReply(client, incoming("line", {
      kind: "postback",
      text: undefined,
      postbackData: "intent=villa_details&locale=en",
    }));
    expect(result.replyMode).toBe("ai");
    expect(seen[0]?.userMessage).toBeTruthy();
    expect(seen[0]?.channel).toBe("line");
  });

  it("only LINE carries a quick-reply menu; other channels do not", async () => {
    for (const channel of CHANNELS) {
      const { client } = makeClient({});
      const result = await resolveMessagingReply(client, incoming(channel));
      if (channel === "line") expect(result.quickReplyItems).toBeDefined();
      else expect(result.quickReplyItems).toBeUndefined();
    }
  });

  describe("timeout and late results (fake timers)", () => {
    it("a slow generation times out: fallback is returned once and the late result is exposed, not delivered", async () => {
      vi.useFakeTimers();
      let resolveLate: (value: { response: string; model: string; committed?: { tool: string } }) => void = () => {};
      const latePromise = new Promise<{ response: string; model: string; committed?: { tool: string } }>((resolve) => {
        resolveLate = resolve;
      });
      const { client } = makeClient({ generate: () => latePromise });

      const resultPromise = resolveMessagingReply(client, incoming("whatsapp"));
      // Push past the shared outer timeout.
      await vi.advanceTimersByTimeAsync(MESSAGING_REPLY_TIMEOUT_MS + 10);
      const result = await resultPromise;

      expect(result.timedOut).toBe(true);
      expect(result.replyMode).toBe("failed");
      expect(result.lateResult).toBeDefined();

      // The late result resolving AFTER the fallback must not be delivered — only recorded.
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      resolveLate({ response: "the real answer", model: "openai/gpt-6-luna", committed: { tool: "confirm_booking" } });
      await recordLateMessagingResult(result.lateResult!, { eventKey: "evt_1", channel: "whatsapp" });

      const logged = infoSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("messaging_late_result");
      expect(logged).toContain("confirm_booking");
      // The guest-facing delivery was the fallback, never "the real answer".
      expect(result.responseText).not.toContain("the real answer");
    });

    it("the timeout fallback never claims failure of a committed write (it is a 'still checking' message)", async () => {
      vi.useFakeTimers();
      const { client } = makeClient({ generate: () => new Promise(() => {}) });
      const resultPromise = resolveMessagingReply(client, incoming("facebook"));
      await vi.advanceTimersByTimeAsync(MESSAGING_REPLY_TIMEOUT_MS + 10);
      const result = await resultPromise;
      // Localized timeout copy — not an error/"failed to book" claim surfaced to the guest.
      expect(result.responseText.toLowerCase()).not.toContain("error");
      expect(result.timedOut).toBe(true);
    });
  });

  it("a committed outcome from a non-timed-out reply is surfaced for the adapter", async () => {
    const { client } = makeClient({
      generate: async () => ({ response: "Booked!", model: "openai/gpt-6-luna", committed: { tool: "confirm_booking", reference: "CONF-1" } }),
    });
    const result = await resolveMessagingReply(client, incoming("line", { text: "yes confirm" }));
    expect(result.committed).toEqual({ tool: "confirm_booking", reference: "CONF-1" });
  });
});
