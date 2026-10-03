// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { getResortRealityDisclosure, resortTodayLine } from "./chatAi";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";
const adminTest = (t: ReturnType<typeof convexTest>) => t.withIdentity({ email: adminEmail, tokenIdentifier: "admin" });

describe("concierge model routing", () => {
  it.each([
    { message: "Which villa is best for 4 adults?", model: "openai/gpt-6-luna", endpoint: "/chat/completions" },
    { message: "Compare a 3-night stay for 4 adults under THB 25000 with massage options and recommend the best plan.", model: "openai/gpt-6.1-sol", endpoint: "/responses" },
  ])("selects $model for $message", async ({ message, model, endpoint }) => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    vi.stubEnv("AI_SIMPLE_MODEL", "");
    vi.stubEnv("AI_COMPLEX_MODEL", "");
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(endpoint === "/responses"
      ? { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The host can help with your villa choices." }] }] }
      : { choices: [{ message: { content: "The host can help with your villa choices." } }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const t = convexTest(schema, modules);
      const sessionId = await createWebSession(t);
      const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: message });
      expect(result.model).toBe(model);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://ai.example.test/v1${endpoint}`);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

async function createWebSession(t: ReturnType<typeof convexTest>, propertySlug?: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: `web-test-${Date.now()}-${Math.random()}`,
      ...(propertySlug ? { propertySlug } : {}),
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}

describe("chat AI guardrails", () => {
  it("does not claim real-world verification for English reality questions", () => {
    const reply = getResortRealityDisclosure(
      "Is Auralis Cove a real luxury villa resort?",
      "https://tour.helpgueststay.com/api/line/webhook",
    );

    expect(reply).toContain("demo/preview experience");
    expect(reply).toContain("should not claim it is a real-world verified resort");
    expect(reply).not.toContain("is a real luxury villa resort");
    expect(reply).not.toContain("/api/line/webhook");
  });

  it("does not claim real-world verification for Thai reality questions", () => {
    const reply = getResortRealityDisclosure("ที่พักนี้มีอยู่จริงไหม");

    expect(reply).toContain("เดโม/พรีวิว");
    expect(reply).toContain("ไม่ควรยืนยันว่าเป็นรีสอร์ตจริง");
  });

  it.each([
    {
      locale: "zh-CN",
      message: "Auralis Cove Retreat 是真的吗？",
      expected: "演示/预览",
    },
    {
      locale: "ja",
      message: "Auralis Cove Retreat は本当にあるリゾートですか？",
      expected: "デモ/プレビュー",
    },
    {
      locale: "ko",
      message: "Auralis Cove Retreat는 진짜 리조트인가요?",
      expected: "데모/미리보기",
    },
    {
      locale: "fr",
      message: "Auralis Cove Retreat est-il un vrai resort ?",
      expected: "démonstration/aperçu",
    },
    {
      locale: "de",
      message: "Ist Auralis Cove Retreat ein echtes Resort?",
      expected: "Demo-/Vorschau",
    },
    {
      locale: "es",
      message: "¿Es real Auralis Cove Retreat?",
      expected: "demo/vista previa",
    },
    {
      locale: "ru",
      message: "Auralis Cove Retreat настоящий курорт?",
      expected: "демо/предпросмотр",
    },
    {
      locale: "it",
      message: "Auralis Cove Retreat è un resort reale?",
      expected: "demo/anteprima",
    },
    {
      locale: "hi",
      message: "क्या Auralis Cove Retreat असली resort है?",
      expected: "demo/preview",
    },
  ])("does not claim real-world verification for $locale reality questions", ({ message, expected }) => {
    const reply = getResortRealityDisclosure(message);

    expect(reply).toContain(expected);
    expect(reply).toContain("Auralis Cove Retreat");
  });

  it("does not intercept ordinary villa questions", () => {
    expect(getResortRealityDisclosure("Which villa is best for 4 adults?")).toBeNull();
    expect(getResortRealityDisclosure("Can I book the Pool Villa tomorrow?")).toBeNull();
    // "Is there / can I…?" endings are ordinary questions, not reality checks.
    expect(getResortRealityDisclosure("마사지 예약할 수 있나요?")).toBeNull();
    expect(getResortRealityDisclosure("プールはありますか？")).toBeNull();
    expect(getResortRealityDisclosure("このリゾートにプールはありますか？")).toBeNull();
    expect(getResortRealityDisclosure("이 리조트에 마사지 서비스가 있나요?")).toBeNull();
  });

  it("catches Korean and Japanese questions about whether this resort exists", () => {
    expect(getResortRealityDisclosure("이 리조트가 있나요?")).toContain("데모/미리보기");
    expect(getResortRealityDisclosure("Auralis Cove Retreat はありますか？")).toContain("デモ/プレビュー");
  });
});

it("answers the latest production service question using live services when no curated question matches", async () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("services", {
          slug: "thai-massage", name: "Traditional Thai Massage", description: "Thai massage",
          category: "Wellness", durationMin: 60, bufferMin: 15, price: 1500,
          currency: "THB", staffIds: [], status: "active", createdAt: Date.now(), updatedAt: Date.now(),
        });
      });
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const messages = JSON.parse(String(init?.body ?? "{}")).messages ?? [];
        if (JSON.stringify(messages).includes("Candidate question-bank items")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: '{"matched":false}' } }] }), { status: 200 });
        }
        const toolResult = messages.find((message: { role: string }) => message.role === "tool");
        const message = toolResult
          ? { content: "มีบริการ Traditional Thai Massage ราคา ฿1,500 ครับ" }
          : { content: null, tool_calls: [{ id: "service-list", type: "function", function: { name: "list_services", arguments: "{}" } }] };
        return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, { sessionId, userMessage: "มีบริการอะไรบ้าง", locale: "th" });

      expect(result.response).toContain("Traditional Thai Massage");
      expect(result.response).toContain("฿1,500");
      expect(fetchMock.mock.calls.some(([, init]) => String((init as RequestInit)?.body).includes("list_services"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

it("records a question when the concierge has no supporting facts", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "[[UNKNOWN]]" } }],
      }), { status: 200 })));
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, { sessionId, userMessage: "Is helicopter transfer included?" });
      const unknownRows = await adminTest(t).query(api.chatKnowledge.adminListUnknownQuestions, {
        status: "new", paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.model).toBe("unknown_fallback");
      expect(unknownRows.page[0]?.userQuestion).toBe("Is helicopter transfer included?");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

it("records the guest message but skips the AI reply while staff has paused the AI", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const sessionId = await createWebSession(t);
      await adminTest(t).mutation(api.adminChat.setAiPaused, { sessionId, paused: true });

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Is Auralis Cove a real luxury villa resort?",
      });
      const transcript = await t.query(api.chat.getMessages, { sessionId });

      expect(result).toMatchObject({ model: "ai_paused", aiPaused: true, response: "" });
      expect(transcript.map((message) => [message.role, message.content])).toEqual([
        ["user", "Is Auralis Cove a real luxury villa resort?"],
      ]);
      await expect(
        t.action(api.chatAi.generateReply, { sessionId, userMessage: "Hello?", channel: "whatsapp" }),
      ).rejects.toThrow(/paused/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

it("uses the Koh Samui date, not UTC", () => {
    // 20:00 UTC on Sunday 27 Sep is 03:00 Monday 28 Sep in Bangkok.
    expect(resortTodayLine(Date.parse("2026-09-27T20:00:00.000Z"))).toBe("Today is 2026-09-28 (Monday) in Koh Samui.");
  });
