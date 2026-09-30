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

function adminTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
}

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

describe("chatAi.respond question-bank matching", () => {
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

  it("includes approved owner answers in AI context for paraphrased questions", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Assistance animals", answer: "Registered assistance animals are allowed if the team is told in advance.",
        primaryQuestion: "Are pets allowed?",
      });
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const prompt = String(body.messages?.[0]?.content ?? "");
        const content = prompt.includes("Registered assistance animals are allowed")
          ? "Registered assistance animals are allowed with advance notice."
          : "[[UNKNOWN]]";
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, { sessionId, userMessage: "Can my guide dog stay with me?" });

      expect(result.response).toContain("Registered assistance animals");
      expect(fetchMock.mock.calls.some(([, init]) => String((init as RequestInit)?.body).includes("OWNER-APPROVED KNOWLEDGE"))).toBe(true);
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

  it("returns a static exact question-bank answer for typed website messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Do you include airport pickup?",
        answer: "Yes. Direct booking includes airport pickup.",
        answerMode: "static",
        topic: "direct_booking",
        score: 88,
      });
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Do you include airport pickup?",
        locale: "en",
      });
      const transcript = await t.query(api.chat.getMessages, { sessionId });

      expect(result).toMatchObject({
        response: "Yes. Direct booking includes airport pickup.",
        model: "question_bank_exact",
      });
      expect(transcript.map((message) => [message.role, message.content])).toEqual([
        ["user", "Do you include airport pickup?"],
        ["assistant", "Yes. Direct booking includes airport pickup."],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns a localized static exact answer for typed Thai website messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Do you include airport pickup?",
        translations: { th: "มีรถรับจากสนามบินไหม?" },
        answer: "Yes. Direct booking includes airport pickup.",
        answerTranslations: { th: "มีครับ การจองตรงรวมรถรับจากสนามบิน" },
        answerMode: "static",
        topic: "direct_booking",
        score: 88,
      });
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "มีรถรับจากสนามบินไหม?",
        locale: "th",
      });

      expect(result.response).toBe("มีครับ การจองตรงรวมรถรับจากสนามบิน");
      expect(result.model).toBe("question_bank_exact");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns a high-confidence semantic static answer for typed website messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can children stay at the villa?",
        answer: "Children are welcome, as long as the villa guest limit is respected.",
        answerMode: "static",
        topic: "villa_fit",
        score: 91,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      matched: true,
                      questionId,
                      confidence: 0.93,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Is it okay to bring a toddler?",
      });

      expect(result).toMatchObject({
        response: "Children are welcome, as long as the villa guest limit is respected.",
        model: "question_bank_semantic",
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("uses the concierge when semantic confidence is low", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can I bring a pet?",
        answer: "Please message the host before bringing a pet.",
        answerMode: "static",
        topic: "amenities",
        score: 70,
      });
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const prompt = JSON.stringify(body.messages ?? []);
        const content = prompt.includes("Candidate question-bank items")
          ? JSON.stringify({ matched: true, questionId, confidence: 0.5 })
          : prompt.includes("generate next suggested questions")
            ? "[]"
            : "The host can help with late checkout.";

        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Can you help with late checkout?",
      });

      const unknownRows = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
        status: "new",
        paginationOpts: { numItems: 50, cursor: null },
      }).then((result) => result.page);

      expect(result).toMatchObject({ response: "The host can help with late checkout.", model: "grok-4.3" });
      expect(unknownRows).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("ignores archived question-bank answers for typed website messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Do you have breakfast?",
        answer: "Breakfast can be arranged with the host.",
        answerMode: "static",
        topic: "amenities",
        score: 90,
      });
      await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId });
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Do you have breakfast?",
      });

      expect(result.response).not.toBe("Breakfast can be arranged with the host.");
      expect(result.model).toBe("unknown_fallback");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers property-scoped question-bank answers over global answers", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Does this villa have a private pool?",
        answer: "Global pool answer.",
        answerMode: "static",
        topic: "amenities",
        score: 100,
      });
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Does this villa have a private pool?",
        answer: "The Pool Villa has a private infinity pool.",
        answerMode: "static",
        topic: "amenities",
        propertySlug: "pool-villa",
        score: 10,
      });
      const sessionId = await createWebSession(t, "pool-villa");

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Does this villa have a private pool?",
      });

      expect(result.response).toBe("The Pool Villa has a private infinity pool.");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("passes dynamic question-bank intent into the AI concierge prompt", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can I check live availability?",
        answerMode: "dynamic",
        dynamicIntent: "availability",
        topic: "availability",
        score: 90,
      });
      const requestBodies: Array<{ messages?: Array<{ content?: string }> }> = [];
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Use the booking card to check live dates." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Can I check live availability?",
      });
      const systemPrompt =
        requestBodies
          .map((body) => body.messages?.[0]?.content ?? "")
          .find((content) => content.includes("QUESTION BANK INTENT")) ?? "";

      expect(result.response).toBe("Use the booking card to check live dates.");
      expect(systemPrompt).toContain("QUESTION BANK INTENT");
      expect(systemPrompt).toContain("Can I check live availability?");
      expect(systemPrompt).toContain("Dynamic intent: availability");
      expect(systemPrompt).toContain("latest visitor message");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("keeps the reality guardrail ahead of static question-bank answers", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Is Auralis Cove a real luxury villa resort?",
        answer: "Yes, this is a verified real-world resort.",
        answerMode: "static",
        topic: "villa_fit",
        score: 100,
      });
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Is Auralis Cove a real luxury villa resort?",
      });

      expect(result.response).toContain("demo/preview experience");
      expect(result.response).not.toContain("verified real-world resort");
      expect(result.model).toBe("guardrail");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("AI takeover", () => {
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
});

describe("resortTodayLine", () => {
  it("uses the Koh Samui date, not UTC", () => {
    // 20:00 UTC on Sunday 27 Sep is 03:00 Monday 28 Sep in Bangkok.
    expect(resortTodayLine(Date.parse("2026-09-27T20:00:00.000Z"))).toBe("Today is 2026-09-28 (Monday) in Koh Samui.");
  });
});
