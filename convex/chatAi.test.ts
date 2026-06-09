// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { getResortRealityDisclosure } from "./chatAi";
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

  it("does not intercept ordinary villa questions", () => {
    expect(getResortRealityDisclosure("Which villa is best for 4 adults?")).toBeNull();
  });
});

describe("chatAi.respond question-bank matching", () => {
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

  it("falls through to the AI concierge when semantic confidence is low", async () => {
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

      expect(result).toMatchObject({
        response: "The host can help with late checkout.",
        model: "grok-4.3",
      });
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
      expect(result.model).toBe("fallback");
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
      const systemPrompt = requestBodies[0]?.messages?.[0]?.content ?? "";

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
