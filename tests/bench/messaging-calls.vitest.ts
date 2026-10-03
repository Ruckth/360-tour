// Messaging webhook call-count benchmark (local, synthetic). Checkout-agnostic: it only drives the
// LINE route's POST handler, so the same file runs against a clean baseline checkout for comparison.
//
//   pnpm exec vitest run -c vitest.bench.config.ts
//   BENCH_OUT=/tmp/messaging.json pnpm exec vitest run -c vitest.bench.config.ts
//
// No network: ConvexHttpClient is replaced by an in-memory fake and global fetch is stubbed for the
// LINE profile/reply endpoints. Each fake Convex call sleeps a fixed synthetic latency so the
// measured claim->delivery time reflects the number of sequential round trips, not real service
// latency. The semantic question-bank matcher (removed by the retirement) costs one model request.
import { writeFileSync } from "node:fs";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLineSignature } from "@/lib/line/signature";

const RTT_MS = 25; // one Convex query/mutation/action round trip
const MODEL_MS = 400; // one model-backed action (concierge reply or semantic matcher)
const MODEL_ACTIONS = new Set(["chatAi:generateReply", "chatSuggestions:resolveCuratedSemantic"]);

type Call = { name: string; at: number };
const calls: Call[] = [];
let startedAt = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function respond(name: string) {
  switch (name) {
    case "line:claimEvent":
      return { eventId: "evt_1", sessionId: "sess_1", duplicate: false, status: "processing" };
    case "chat:isAiPaused":
    case "bookings:isChatBookingFlowActive":
      return false;
    case "properties:list":
      return [];
    case "chatAi:generateReply":
      return { response: "Here is what I found.", model: "openai/gpt-6-luna" };
    default:
      return null; // resolveExact, resolveCuratedExact/Semantic, getGuardrailReply, writes
  }
}

vi.mock("convex/browser", () => {
  class ConvexHttpClient {
    constructor(public url: string) {}
    private async call(reference: unknown) {
      const name = getFunctionName(reference as FunctionReference<"query">);
      calls.push({ name, at: Date.now() - startedAt });
      await sleep(MODEL_ACTIONS.has(name) ? MODEL_MS : RTT_MS);
      return respond(name);
    }
    query(reference: unknown) { return this.call(reference); }
    mutation(reference: unknown) { return this.call(reference); }
    action(reference: unknown) { return this.call(reference); }
  }
  return { ConvexHttpClient };
});

const SECRET = "bench-secret";
const scenarios = [
  { name: "typed policy question", event: { type: "message", message: { id: "m1", type: "text", text: "Do you allow pets?" } } },
  { name: "typed booking request", event: { type: "message", message: { id: "m2", type: "text", text: "Can I book the pool villa for 2 nights?" } } },
  { name: "menu postback (prices)", event: { type: "postback", postback: { data: "intent=pricing&locale=en" } } },
];

type Result = { scenario: string; convexCalls: number; modelRequests: number; deliveredAtMs: number; replies: number; functions: string[] };
const results: Result[] = [];

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://bench.invalid");
  vi.stubEnv("LINE_CHANNEL_SECRET", SECRET);
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "bench-token");
  vi.stubEnv("CONVEX_SERVER_SECRET", "bench-server-secret");
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  console.table(results.map(({ functions, ...row }) => ({ ...row, functions: functions.join(" > ") })));
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${JSON.stringify({ rttMs: RTT_MS, modelMs: MODEL_MS, results }, null, 2)}\n`);
});

describe("LINE webhook round trips per event", () => {
  for (const [index, scenario] of scenarios.entries()) {
    it(scenario.name, async () => {
      calls.length = 0;
      const replies: number[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.includes("/v2/bot/profile/")) return new Response(JSON.stringify({ displayName: "Guest" }));
        if (url.includes("/v2/bot/message/reply")) replies.push(Date.now() - startedAt);
        return new Response("{}", { status: 200 });
      }));
      const { POST } = await import("@/app/api/line/webhook/route");
      const body = JSON.stringify({
        events: [{ ...scenario.event, webhookEventId: `bench-${index}`, timestamp: Date.now(), replyToken: "rt", source: { type: "user", userId: "Ubench" } }],
      });
      startedAt = Date.now();
      const response = await POST(new Request("https://tour.example/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": createLineSignature(body, SECRET) },
        body,
      }));
      expect(response.status).toBe(200);
      expect(replies).toHaveLength(1);
      results.push({
        scenario: scenario.name,
        convexCalls: calls.length,
        modelRequests: calls.filter((call) => MODEL_ACTIONS.has(call.name)).length,
        deliveredAtMs: replies[0],
        replies: replies.length,
        functions: calls.map((call) => call.name),
      });
    });
  }
});
