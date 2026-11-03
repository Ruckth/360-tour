import type { ReplyCard } from 'convex/lib/replyCards';
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLineSignature } from "@/lib/line/signature";

const backend = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  claimed: new Set<string>(),
  card: undefined as ReplyCard | undefined,
  response: "Here is the host's policy.",
  paused: false,
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
      if (name === "chat:isAiPaused") return backend.paused;
      if (name === "bookings:isChatBookingFlowActive") return false;
      if (name === "line:recordInboundEvent") return { recorded: true, duplicate: false, userMessageId: "msg_1" };
      if (name === "line:beginDelivery") return { started: true };
      if (name === "chatAi:generateReply") return { response: backend.response, card: backend.card, model: "openai/test-model", outcome: "answered" };
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
  backend.card = undefined;
  backend.response = "Here is the host's policy.";
  backend.paused = false;
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


describe("LINE rich replies", () => {
  async function post() {
    const body = JSON.stringify({ events: [{ type: "message", webhookEventId: "rich-event", replyToken: "reply-token",
      source: { type: "user", userId: "guest-id" }, message: { id: "message-id", type: "text", text: "Show villas" } }] });
    const { POST } = await import("@/app/api/line/webhook/route");
    return POST(new Request("https://tour.example/api/line/webhook", { method: "POST", body,
      headers: { "x-line-signature": createLineSignature(body, "handler-secret") } }));
  }
  const url = "https://tour.example/booking/pay?proposal=exact.signed.proposal";
  function setup(send: (index: number) => Promise<Response>) {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MESSAGING_RICH_CARDS", "line");
    backend.card = { kind: "booking", items: [{ title: "Pool villa", lines: ["Not booked yet", "THB 9,000"], actions: [{ type: "uri", label: "Confirm & pay", url }] }] };
    const payloads: Array<{ messages: Array<Record<string, unknown>> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (target: string, init?: RequestInit) => {
      if (target.includes("/profile/")) return new Response("{}");
      payloads.push(JSON.parse(String(init?.body)));
      return send(payloads.length);
    }));
    return payloads;
  }
  it("sends text and Flex together using one reserved reply token", async () => {
    const sent = setup(async () => new Response("{}"));
    await post();
    expect(sent).toHaveLength(1);
    expect(sent[0].messages.map(message => message.type)).toEqual(["text", "flex"]);
    expect(JSON.stringify(sent[0])).toContain(url);
    expect(backend.calls.filter(call => call.name === "line:beginDelivery")).toHaveLength(1);
    await post();
    expect(sent).toHaveLength(1);
  });
  it("retains the exact signed URL on validation fallback even when AI prose is oversized", async () => {
    const sent = setup(async index => new Response("{}", { status: index === 1 ? 400 : 200 }));
    backend.response = "Long introduction. ".repeat(400);
    await post();
    expect(sent).toHaveLength(2);
    expect(sent[1].messages).toHaveLength(1);
    expect(sent[1].messages[0].text).toContain(url);
    expect(String(sent[1].messages[0].text).length).toBeLessThanOrEqual(5000);
  });
  it.each(["network", "server"])("never retries an ambiguous %s failure", async mode => {
    const sent = setup(async () => {
      if (mode === "network") throw new Error("Connection reset");
      return new Response("{}", { status: 500 });
    });
    await post();
    expect(sent).toHaveLength(1);
    expect(backend.calls.some(call => call.name === "line:markEventFailed")).toBe(true);
  });
  it("keeps text-only behavior when the feature is disabled", async () => {
    const sent = setup(async () => new Response("{}"));
    vi.stubEnv("MESSAGING_RICH_CARDS", "");
    await post();
    expect(sent[0].messages.map(message => message.type)).toEqual(["text"]);
  });
  it("does not send cards after staff takeover", async () => {
    const sent = setup(async () => new Response("{}"));
    backend.paused = true;
    await post();
    expect(sent).toHaveLength(0);
    expect(backend.calls.some(call => call.name === "line:beginDelivery")).toBe(false);
  });
});
