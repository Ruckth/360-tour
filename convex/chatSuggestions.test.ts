// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { normalizeSuggestedQuestion, supportedSuggestionLocales } from "./lib/chatSuggestions";
import { curatedQuestionSeeds } from "./seeds/curatedQuestions";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";

async function finishScheduledWork(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

function adminTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
}

function expectAllSupportedLocaleTranslations(translations?: Record<string, string>) {
  expect(Object.keys(translations ?? {}).sort()).toEqual([...supportedSuggestionLocales].sort());
  for (const locale of supportedSuggestionLocales) {
    expect(translations?.[locale]?.trim()).toBeTruthy();
  }
}

async function createLineSession(t: ReturnType<typeof convexTest>, propertySlug?: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "line",
      visitorId: `line-test-${Date.now()}-${Math.random()}`,
      ...(propertySlug ? { propertySlug } : {}),
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}

describe("chatSuggestions.nextForSession", () => {
  it("seeds the global dynamic curated question bank idempotently", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);

      await expect(
        t.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false }),
      ).rejects.toThrow("Not authenticated");

      const dryRun = await admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: true });
      expect(dryRun).toMatchObject({
        dryRun: true,
        totalSeeds: 10,
        created: 10,
        updated: 0,
        unchanged: 0,
      });
      await expect(admin.query(api.chatSuggestions.adminListCurated, { status: "active" })).resolves.toEqual([]);

      const seeded = await admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false });
      expect(seeded).toMatchObject({
        dryRun: false,
        totalSeeds: 10,
        created: 10,
        updated: 0,
        unchanged: 0,
      });

      const secondRun = await admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false });
      expect(secondRun).toMatchObject({
        dryRun: false,
        totalSeeds: 10,
        created: 0,
        updated: 0,
        unchanged: 10,
      });

      const rows = await admin.query(api.chatSuggestions.adminListCurated, {
        status: "active",
        limit: 100,
      });
      const seededRows = rows.filter((row) =>
        curatedQuestionSeeds.some((seed) => seed.question === row.question),
      );
      expect(seededRows).toHaveLength(10);
      for (const seed of curatedQuestionSeeds) {
        const row = seededRows.find((item) => item.question === seed.question);
        expect(row).toMatchObject({
          question: seed.question,
          normalizedQuestion: normalizeSuggestedQuestion(seed.question),
          answerMode: "dynamic",
          dynamicIntent: seed.dynamicIntent,
          topic: seed.topic,
          score: seed.score,
          status: "active",
          createdByAdminEmail: adminEmail,
          updatedByAdminEmail: adminEmail,
        });
        expect(row?.propertySlug).toBeUndefined();
        expect(row?.answer).toBeUndefined();
        expect(row?.answerTranslations).toBeUndefined();
        expect(row?.translations).toEqual(seed.translations);
        expectAllSupportedLocaleTranslations(row?.translations);
      }

      const editedId = await t.run(async ctx => {
        const row = (await ctx.db.query("curatedChatQuestions").first())!;
        await ctx.db.patch(row._id, { status: "archived", answer: "Admin answer", answerMode: "static", score: 1 });
        return row._id;
      });
      const afterEdit = await admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false });
      expect(afterEdit).toMatchObject({ created: 0, updated: 0, unchanged: 10 });
      expect(await t.run(ctx => ctx.db.get(editedId))).toMatchObject({ status: "archived", answer: "Admin answer", answerMode: "static", score: 1 });

    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets admins create, update, archive, restore, and delete curated questions", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);

      await expect(
        t.mutation(api.chatSuggestions.adminCreateCurated, {
          question: "Can I check availability?",
          topic: "availability",
          score: 150,
        }),
      ).rejects.toThrow("Not authenticated");

      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can I check availability?",
        translations: { th: "ตรวจสอบห้องว่างได้ไหม?" },
        topic: "availability",
        score: 150,
      });
      await expect(
        admin.mutation(api.chatSuggestions.adminCreateCurated, {
          question: "Is this place real?",
          answerMode: "static",
          topic: "villa_fit",
        }),
      ).rejects.toThrow("Answer is required");
      let rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "active" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        question: "Can I check availability?",
        score: 100,
        status: "active",
        createdByAdminEmail: adminEmail,
      });

      await admin.mutation(api.chatSuggestions.adminUpdateCurated, {
        questionId,
        question: "Can I check availability for my dates?",
        translations: { th: "ตรวจสอบห้องว่างสำหรับวันที่ของฉันได้ไหม?" },
        topic: "not-real",
        score: -12,
        propertySlug: "pool-villa",
      });
      rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "active" });
      expect(rows[0]).toMatchObject({
        question: "Can I check availability for my dates?",
        topic: "villa_fit",
        score: 0,
        propertySlug: "pool-villa",
      });

      await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId });
      rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "archived" });
      expect(rows[0]?.status).toBe("archived");

      await admin.mutation(api.chatSuggestions.adminRestoreCurated, { questionId });
      rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "active" });
      expect(rows[0]?.status).toBe("active");

      await expect(
        admin.mutation(api.chatSuggestions.adminDeleteArchivedCurated, { questionId }),
      ).rejects.toThrow("Archive the question");

      await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId });
      await admin.mutation(api.chatSuggestions.adminDeleteArchivedCurated, { questionId });
      rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "all" });
      expect(rows).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps curated answers resolved through exact matches, not public static chips", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Is this place real?",
        translations: { th: "ที่พักนี้มีอยู่จริงไหม?" },
        answer: "Yes. This is a real villa managed by our concierge team.",
        answerTranslations: {
          th: "ใช่ ที่พักนี้มีอยู่จริงและดูแลโดยทีมคอนเซียร์จของเรา",
        },
        answerMode: "static",
        topic: "villa_fit",
        score: 99,
      });
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "What is the direct booking price?",
        answerMode: "dynamic",
        dynamicIntent: "pricing",
        topic: "direct_booking",
        score: 98,
      });

      const now = 1_700_000_000_000;
      const sessionId = await t.run(async (ctx) => {
        return await ctx.db.insert("chatSessions", {
          channel: "web",
          visitorId: "visitor-static-answer",
          lastSeenAt: now,
          createdAt: now,
        });
      });

      const exactStatic = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "Is this place real?",
        locale: "th",
      });
      const exactDynamic = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "What is the direct booking price?",
        locale: "en",
      });
      const chips = await t.query(api.chatSuggestions.nextForSession, {
        sessionId,
        candidateSuggestionIds: ["availability", "totalPrice"],
        limit: 5,
      });

      expect(exactStatic).toMatchObject({
        question: "ที่พักนี้มีอยู่จริงไหม?",
        answer: "ใช่ ที่พักนี้มีอยู่จริงและดูแลโดยทีมคอนเซียร์จของเรา",
        answerMode: "static",
        source: "exact",
      });
      expect(exactDynamic).toMatchObject({
        question: "What is the direct booking price?",
        answerMode: "dynamic",
        dynamicIntent: "pricing",
        source: "exact",
      });
      expect(exactDynamic).not.toHaveProperty("answer");
      expect(chips).toEqual([
        { source: "static", suggestionId: "availability" },
        { source: "static", suggestionId: "totalPrice" },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("translates question bank drafts through the admin action", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questionTranslations: {
                    th: "ที่พักนี้มีอยู่จริงไหม?",
                    de: "Ist dieser Ort echt?",
                  },
                  answerTranslations: {
                    th: "ใช่ ที่พักนี้มีอยู่จริง",
                    de: "Ja. Diese Villa ist echt.",
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const translated = await admin.action(api.chatSuggestions.adminTranslateCuratedDraft, {
        question: "Is this place real?",
        answer: "Yes. This villa is real.",
        targetLocales: ["th", "de"],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://ai.example.test/v1/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
      expect(translated).toEqual({
        questionTranslations: {
          th: "ที่พักนี้มีอยู่จริงไหม?",
          de: "Ist dieser Ort echt?",
        },
        answerTranslations: {
          th: "ใช่ ที่พักนี้มีอยู่จริง",
          de: "Ja. Diese Villa ist echt.",
        },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("resolves exact LINE question-bank matches by canonical question and translation", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Do you include airport pickup?",
        translations: { th: "มีรถรับจากสนามบินไหม?" },
        answer: "Yes. Direct booking includes airport pickup.",
        answerTranslations: { th: "มีครับ การจองตรงรวมรถรับจากสนามบิน" },
        answerMode: "static",
        topic: "direct_booking",
        score: 88,
      });
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can I check live availability?",
        answerMode: "dynamic",
        dynamicIntent: "availability",
        topic: "availability",
        score: 80,
      });
      const sessionId = await createLineSession(t);

      const english = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "Do you include airport pickup?",
        locale: "en",
      });
      const thai = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "มีรถรับจากสนามบินไหม?",
        locale: "th",
      });
      const dynamic = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "Can I check live availability?",
      });

      expect(english).toMatchObject({
        source: "exact",
        suggestionId: questionId,
        answer: "Yes. Direct booking includes airport pickup.",
        answerMode: "static",
      });
      expect(thai).toMatchObject({
        question: "มีรถรับจากสนามบินไหม?",
        answer: "มีครับ การจองตรงรวมรถรับจากสนามบิน",
      });
      expect(dynamic).toMatchObject({
        answerMode: "dynamic",
        dynamicIntent: "availability",
      });
      expect(dynamic).not.toHaveProperty("answer");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("ignores archived LINE question-bank matches", async () => {
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
      const sessionId = await createLineSession(t);

      await expect(
        t.query(api.chatSuggestions.resolveCuratedExact, {
          sessionId,
          messageText: "Do you have breakfast?",
        }),
      ).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers property-scoped LINE question-bank matches over global matches", async () => {
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
      const propertyQuestionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Does this villa have a private pool?",
        answer: "The Pool Villa has a private infinity pool.",
        answerMode: "static",
        topic: "amenities",
        propertySlug: "pool-villa",
        score: 10,
      });
      const sessionId = await createLineSession(t, "pool-villa");

      const match = await t.query(api.chatSuggestions.resolveCuratedExact, {
        sessionId,
        messageText: "Does this villa have a private pool?",
      });

      expect(match).toMatchObject({
        suggestionId: propertyQuestionId,
        answer: "The Pool Villa has a private infinity pool.",
        propertySlug: "pool-villa",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts high-confidence semantic LINE question-bank matches", async () => {
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
      const sessionId = await createLineSession(t);

      const match = await t.action(api.chatSuggestions.resolveCuratedSemantic, {
        sessionId,
        messageText: "Is it okay to bring a toddler?",
      });

      expect(match).toMatchObject({
        source: "semantic",
        suggestionId: questionId,
        answer: "Children are welcome, as long as the villa guest limit is respected.",
        confidence: 0.93,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("rejects low-confidence semantic LINE question-bank matches", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
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
                      confidence: 0.5,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
      const sessionId = await createLineSession(t);

      await expect(
        t.action(api.chatSuggestions.resolveCuratedSemantic, {
          sessionId,
          messageText: "Can you help with late checkout?",
        }),
      ).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("returns ordered static suggestion keys for a session", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorId: "visitor-static-suggestions",
        lastSeenAt: now,
        createdAt: now,
      });
    });

    const selected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });

    expect(selected).toEqual([
      { source: "static", suggestionId: "availability" },
      { source: "static", suggestionId: "totalPrice" },
    ]);
  });

  it("tracks curated clicks per session without archiving the global question", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Can I check availability for my dates?",
        topic: "availability",
        score: 99,
      });
      const now = 1_700_000_000_000;
      const [firstSessionId, secondSessionId] = await t.run(async (ctx) => {
        const first = await ctx.db.insert("chatSessions", {
          channel: "web",
          visitorId: "visitor-one",
          lastSeenAt: now,
          createdAt: now,
        });
        const second = await ctx.db.insert("chatSessions", {
          channel: "web",
          visitorId: "visitor-two",
          lastSeenAt: now,
          createdAt: now,
        });
        return [first, second];
      });

      await t.mutation(api.chatSuggestions.markClicked, {
        sessionId: firstSessionId,
        suggestion: { source: "curated", suggestionId: questionId },
      });
      const rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "active" });
      const interactions = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatQuestionInteractions")
          .withIndex("by_session_and_question", (q) =>
            q.eq("sessionId", firstSessionId).eq("questionId", questionId),
          )
          .take(1);
      });

      expect(interactions[0]?.clickedAt).toBeTruthy();
      expect(rows[0]?.status).toBe("active");
      expect(secondSessionId).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not return static suggestion keys that were already shown", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorId: "visitor-static-repeat",
        lastSeenAt: now,
        createdAt: now,
      });
    });
    const firstSelected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });
    await t.mutation(api.chatSuggestions.markShown, {
      sessionId,
      suggestions: firstSelected,
    });
    const secondSelected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });

    expect(firstSelected.map((suggestion) => suggestion.suggestionId)).toEqual([
      "availability",
      "totalPrice",
    ]);
    expect(secondSelected.map((suggestion) => suggestion.suggestionId)).toEqual(["direct"]);
  });

  it("records static suggestion clicks and hides clicked keys", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorId: "visitor-static-click",
        lastSeenAt: now,
        createdAt: now,
      });
    });

    await t.mutation(api.chatSuggestions.markClicked, {
      sessionId,
      suggestion: { source: "static", suggestionId: "availability" },
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice"],
      limit: 2,
    });
    const interactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatStaticSuggestionInteractions")
        .withIndex("by_session_and_suggestionKey", (q) =>
          q.eq("sessionId", sessionId).eq("suggestionKey", "availability"),
        )
        .take(1);
    });

    expect(interactions[0]?.shownAt).toBeTruthy();
    expect(interactions[0]?.clickedAt).toBeTruthy();
    expect(selected).toEqual([{ source: "static", suggestionId: "totalPrice" }]);
  });

  it("returns no static suggestions after every candidate has been shown", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorId: "visitor-static-exhausted",
        lastSeenAt: now,
        createdAt: now,
      });
    });
    const candidates = ["availability", "totalPrice"];

    await t.mutation(api.chatSuggestions.markShown, {
      sessionId,
      suggestions: candidates.map((suggestionId) => ({ source: "static" as const, suggestionId })),
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: candidates,
      limit: 2,
    });

    expect(selected).toEqual([]);
  });

  it("does not generate ranked suggestions from public assistant messages", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const sessionId = await t.mutation(api.chat.createSession, {
        channel: "web",
        visitorId: "visitor-public-assistant",
      });
      const userMessageId = await t.mutation(api.chat.addMessage, {
        sessionId,
        role: "user",
        content: "What's included when booking direct?",
      });
      expect(userMessageId).toBeTruthy();

      await t.mutation(api.chat.addMessage, {
        sessionId,
        role: "assistant",
        content: "Direct booking includes host support and better pricing.",
      });
      await finishScheduledWork(t);

      const selected = await t.query(api.chatSuggestions.nextForSession, {
        sessionId,
        candidateSuggestionIds: ["availability", "totalPrice"],
        limit: 5,
      });
      expect(selected).toEqual([
        { source: "static", suggestionId: "availability" },
        { source: "static", suggestionId: "totalPrice" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not store generated suggestions from trusted internal assistant messages", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_API_KEY", "");
    try {
      const t = convexTest(schema, modules);
      const sessionId = await t.mutation(api.chat.createSession, {
        channel: "web",
        visitorId: "visitor-internal-assistant",
      });
      const userMessageId = await t.mutation(api.chat.addMessage, {
        sessionId,
        role: "user",
        content: "What's included when booking direct?",
      });

      await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId,
        content: "Direct booking includes host support and better pricing.",
        locale: "en",
        replyToMessageId: userMessageId,
      });
      await finishScheduledWork(t);

      const selected = await t.query(api.chatSuggestions.nextForSession, {
        sessionId,
        candidateSuggestionIds: ["availability", "totalPrice"],
        limit: 2,
      });
      const generatedRows = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatSuggestedQuestions")
          .withIndex("by_session_and_status", (q) => q.eq("sessionId", sessionId).eq("status", "active"))
          .take(10);
      });

      expect(selected).toEqual([
        { source: "static", suggestionId: "availability" },
        { source: "static", suggestionId: "totalPrice" },
      ]);
      expect(generatedRows).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });
});
