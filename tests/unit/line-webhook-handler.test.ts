import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLineSignature } from "@/lib/line/signature";

const backend = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  claimed: new Set<string>(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    async call(reference: unknown, args: Record<string, unknown>) {
      const name = getFunctionName(reference as FunctionReference<"query">);
      backend.calls.push({ name, args });
      if (name === "line:claimEvent") {
        const eventKey = String(args.eventKey);
        const duplicate = backend.claimed.has(eventKey);
        backend.claimed.add(eventKey);
        return { eventId: "evt_1", sessionId: "sess_1", duplicate, status: duplicate ? "completed" : "processing" };
      }
      if (name === "chat:isAiPaused" || name === "bookings:isChatBookingFlowActive") return false;
      if (name === "line:recordInboundEvent") return { recorded: true, duplicate: false, userMessageId: "msg_1" };
      if (name === "chatAi:generateReply") return { response: "Here is the host's policy.", model: "openai/test-model", outcome: "answered" };
      return null;
    }
    query(reference: unknown, args: Record<string, unknown>) { return this.call(reference, args); }
    mutation(reference: unknown, args: Record<string, unknown>) { return this.call(reference, args); }
    action(reference: unknown, args: Record<string, unknown>) { return this.call(reference, args); }
  },
}));

beforeEach(() => {
  backend.calls.length = 0;
  backend.claimed.clear();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://handler-test.invalid");
  vi.stubEnv("LINE_CHANNEL_SECRET", "handler-secret");
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "private-access-token");
  vi.stubEnv("CONVEX_SERVER_SECRET", "private-server-secret");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LINE handler turn correlation", () => {
  it("carries one turn through generation and all delivery stages, then suppresses redelivery", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    const replies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/bot/profile/")) return new Response(JSON.stringify({ displayName: "Private Guest Name" }));
      if (url.includes("/v2/bot/message/reply")) replies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }));
    const { POST } = await import("@/app/api/line/webhook/route");
    const body = JSON.stringify({ events: [{
      type: "message", webhookEventId: "private-event-id", replyToken: "private-reply-token",
      source: { type: "user", userId: "private-user-id" },
      message: { id: "private-message-id", type: "text", text: "Can my pet stay? Email me at guest@example.com" },
    }] });
    const request = () => new Request("https://tour.example/api/line/webhook", {
      method: "POST", body,
      headers: { "x-line-signature": createLineSignature(body, "handler-secret") },
    });

    expect((await POST(request())).status).toBe(200);
    const generated = backend.calls.filter(call => call.name === "chatAi:generateReply");
    expect(generated).toHaveLength(1);
    expect(generated[0].args.replyToMessageId).toBe("msg_1");
    const turnId = generated[0].args.turnId;
    expect(turnId).toEqual(expect.any(String));
    const stages = logs.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(stages.map(stage => stage.outcome)).toEqual(["claim_completed", "generation_completed", "delivery_completed"]);
    for (const [index, stage] of stages.entries()) {
      expect(stage).toMatchObject({ event: "concierge_turn", channel: "line", turnId });
      expect(Object.keys(stage.stages)).toEqual(["claim", "generation", "delivery"].slice(0, index + 1));
      expect(Object.values(stage.stages).every(ms => typeof ms === "number" && ms >= 0)).toBe(true);
    }
    expect(replies).toHaveLength(1);
    expect(backend.calls.filter(call => call.name === "line:completeEvent")).toHaveLength(1);
    expect(backend.calls.find(call => call.name === "line:completeEvent")?.args.outcome).toBe("answered");

    expect((await POST(request())).status).toBe(200);
    expect(replies).toHaveLength(1);
    expect(backend.calls.filter(call => call.name === "chatAi:generateReply")).toHaveLength(1);
    expect(backend.calls.filter(call => call.name === "line:completeEvent")).toHaveLength(1);
    expect(JSON.parse(String(logs.mock.calls.at(-1)?.[0])).outcome).toBe("claim_completed");
    const logText = logs.mock.calls.map(([line]) => String(line)).join("\n");
    for (const privateValue of ["Private Guest Name", "private-", "guest@example.com", "Can my pet stay?"]) {
      expect(logText).not.toContain(privateValue);
    }
  });
});
