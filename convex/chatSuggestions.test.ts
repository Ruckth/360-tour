// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { fixtureGuestToken, fixtureGuestTokenHash } from "./testing/fixtures.test-support";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeSuggestedQuestion } from "./lib/chatSuggestions";
import { curatedQuestionSeeds } from "./seeds/curatedQuestions";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";
const RETIRED = "Saved answers and Q&A are retired. Maintain Business facts instead.";

async function finishScheduledWork(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

function adminTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
}

async function createWebSession(t: ReturnType<typeof convexTest>, visitorId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      guestTokenHash: fixtureGuestTokenHash,
      visitorId,
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}

/** Insert a historical curated question + its variant rows, as if saved before retirement. */
async function seedHistoricalCurated(
  t: ReturnType<typeof convexTest>,
  args: {
    question: string;
    answer?: string;
    translations?: Record<string, string>;
    answerTranslations?: Record<string, string>;
    answerMode?: "static" | "dynamic";
    dynamicIntent?: "availability" | "pricing" | "property_details" | "booking_help" | "contact";
    topic?: string;
    score?: number;
    propertySlug?: string;
    status?: "active" | "archived";
  },
): Promise<Id<"curatedChatQuestions">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const translations = { en: args.question, ...(args.translations ?? {}) };
    const questionId = await ctx.db.insert("curatedChatQuestions", {
      question: args.question,
      normalizedQuestion: normalizeSuggestedQuestion(args.question),
      translations,
      ...(args.answer ? { answer: args.answer } : {}),
      ...(args.answerTranslations ? { answerTranslations: { en: args.answer ?? "", ...args.answerTranslations } } : {}),
      answerMode: args.answerMode ?? (args.answer ? "static" : "dynamic"),
      ...(args.dynamicIntent ? { dynamicIntent: args.dynamicIntent } : {}),
      propertySlug: args.propertySlug,
      topic: args.topic ?? "villa_fit",
      score: args.score ?? 50,
      status: args.status ?? "active",
      createdAt: now,
      updatedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    // Variant lookup rows for the question + each translation.
    for (const value of Object.values(translations)) {
      const normalizedVariant = normalizeSuggestedQuestion(value);
      if (!normalizedVariant) continue;
      await ctx.db.insert("curatedChatQuestionVariants", {
        questionId,
        normalizedVariant,
        propertySlug: args.propertySlug,
      });
    }
    return questionId;
  });
}

describe("curated question-bank writers refuse", () => {
  it("refuses create/update/restore/translate/delete and the seed path, after auth", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);

      // Unauthenticated callers get the auth error first.
      await expect(
        t.mutation(api.chatSuggestions.adminCreateCurated, { question: "Can I check availability?", topic: "availability", score: 90 }),
      ).rejects.toThrow("Not authenticated");
      await expect(
        t.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false }),
      ).rejects.toThrow("Not authenticated");

      // Authenticated admins get the retirement refusal.
      await expect(
        admin.mutation(api.chatSuggestions.adminCreateCurated, { question: "Can I check availability?", topic: "availability", score: 90 }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: true }),
      ).rejects.toThrow(RETIRED);

      const questionId = await seedHistoricalCurated(t, { question: "Historic", answer: "a", answerMode: "static", topic: "villa_fit", score: 50 });
      await expect(
        admin.mutation(api.chatSuggestions.adminUpdateCurated, { questionId, question: "Historic edited", topic: "villa_fit", score: 10 }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.action(api.chatSuggestions.adminTranslateCuratedDraft, { question: "Historic", answer: "a" }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.action(api.chatSuggestions.adminTranslateMissingCurated, {}),
      ).rejects.toThrow(RETIRED);

      // Archive is still allowed; restore and permanent delete refuse.
      await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId });
      expect(await t.run((ctx) => ctx.db.get(questionId))).toMatchObject({ status: "archived" });
      await expect(
        admin.mutation(api.chatSuggestions.adminRestoreCurated, { questionId }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.mutation(api.chatSuggestions.adminDeleteArchivedCurated, { questionId }),
      ).rejects.toThrow(RETIRED);
      // The archived row stays available for the read-only archive view.
      expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the internal translation workers no-op after retirement", async () => {
    const t = convexTest(schema, modules);
    const questionId = await seedHistoricalCurated(t, { question: "Historic", answer: "a", answerMode: "static" });
    // listCuratedMissingTranslations reports nothing to do once retired.
    expect(
      await t.query(internal.chatSuggestions.listCuratedMissingTranslations, { limit: 5, skipIds: [] }),
    ).toEqual({ total: 0, batch: [] });
    // applyCuratedTranslations refuses to write (queued-before-retirement guard).
    await expect(
      t.mutation(internal.chatSuggestions.applyCuratedTranslations, {
        questionId,
        questionTranslations: { th: "x" },
        answerTranslations: {},
        adminEmail,
      }),
    ).rejects.toThrow(RETIRED);
  });

  it("the seed path cannot recreate the curated bank even for an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await expect(admin.mutation(api.seed.seedCuratedQuestionBank, { dryRun: false })).rejects.toThrow(RETIRED);
      const rows = await admin.query(api.chatSuggestions.adminListCurated, { status: "all", limit: 100 });
      const seeded = rows.filter((row) => curatedQuestionSeeds.some((seed) => seed.question === row.question));
      expect(seeded).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("static suggestion chips remain live", () => {
  it("returns ordered static suggestion keys for a session", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-suggestions");
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });
    expect(selected).toEqual([
      { source: "static", suggestionId: "availability" },
      { source: "static", suggestionId: "totalPrice" },
    ]);
  });

  it("does not surface historical curated items through the public chips", async () => {
    const t = convexTest(schema, modules);
    await seedHistoricalCurated(t, { question: "Historic chip", answer: "x", answerMode: "static", score: 100 });
    const sessionId = await createWebSession(t, "visitor-static-answer");

    const chips = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice"],
      limit: 5,
    });
    expect(chips).toEqual([
      { source: "static", suggestionId: "availability" },
      { source: "static", suggestionId: "totalPrice" },
    ]);
  });

  it("does not return static suggestion keys that were already shown", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-repeat");
    const firstSelected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });
    await t.mutation(api.chatSuggestions.markShown, { guestToken: fixtureGuestToken, sessionId, suggestions: firstSelected });
    const secondSelected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });

    expect(firstSelected.map((s) => s.suggestionId)).toEqual(["availability", "totalPrice"]);
    expect(secondSelected.map((s) => s.suggestionId)).toEqual(["direct"]);
  });

  it("records static suggestion clicks and hides clicked keys", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-click");

    await t.mutation(api.chatSuggestions.markClicked, { guestToken: fixtureGuestToken,
      sessionId,
      suggestion: { source: "static", suggestionId: "availability" },
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice"],
      limit: 2,
    });
    const interactions = await t.run(async (ctx) =>
      ctx.db
        .query("chatStaticSuggestionInteractions")
        .withIndex("by_session_and_suggestionKey", (q) => q.eq("sessionId", sessionId).eq("suggestionKey", "availability"))
        .take(1),
    );

    expect(interactions[0]?.shownAt).toBeTruthy();
    expect(interactions[0]?.clickedAt).toBeTruthy();
    expect(selected).toEqual([{ source: "static", suggestionId: "totalPrice" }]);
  });

  it("returns no static suggestions after every candidate has been shown", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-exhausted");
    const candidates: Array<"availability" | "totalPrice"> = ["availability", "totalPrice"];

    await t.mutation(api.chatSuggestions.markShown, { guestToken: fixtureGuestToken,
      sessionId,
      suggestions: candidates.map((suggestionId) => ({ source: "static" as const, suggestionId })),
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: candidates,
      limit: 2,
    });

    expect(selected).toEqual([]);
  });

  it("still tracks a curated chip click on a historical item without reviving it", async () => {
    const t = convexTest(schema, modules);
    const questionId = await seedHistoricalCurated(t, { question: "Can I check availability for my dates?", topic: "availability", score: 99 });
    const sessionId = await createWebSession(t, "visitor-one");

    await t.mutation(api.chatSuggestions.markClicked, { guestToken: fixtureGuestToken,
      sessionId,
      suggestion: { source: "curated", suggestionId: questionId },
    });
    const interactions = await t.run(async (ctx) =>
      ctx.db
        .query("chatQuestionInteractions")
        .withIndex("by_session_and_question", (q) => q.eq("sessionId", sessionId).eq("questionId", questionId))
        .take(1),
    );
    expect(interactions[0]?.clickedAt).toBeTruthy();
    // The global question is untouched (still active, never archived by a click).
    expect(await t.run((ctx) => ctx.db.get(questionId))).toMatchObject({ status: "active" });
  });

  it("does not generate ranked suggestions from public assistant messages", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { sessionId, guestToken } = await t.mutation(api.chat.createSession, {
        channel: "web",
        visitorId: "visitor-public-assistant",
      });
      const userMessageId = await t.mutation(internal.chat.acceptGuestMessage, {
        sessionId,
        content: "What's included when booking direct?",
      });
      expect(userMessageId).toBeTruthy();

      await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId,
        content: "Direct booking includes host support and better pricing.",
      });
      await finishScheduledWork(t);

      const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken,
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
      const { sessionId, guestToken } = await t.mutation(api.chat.createSession, {
        channel: "web",
        visitorId: "visitor-internal-assistant",
      });
      const userMessageId = await t.mutation(internal.chat.acceptGuestMessage, {
        sessionId,
        content: "What's included when booking direct?",
      });

      await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId,
        content: "Direct booking includes host support and better pricing.",
        locale: "en",
        replyToMessageId: userMessageId,
      });
      await finishScheduledWork(t);

      const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken,
        sessionId,
        candidateSuggestionIds: ["availability", "totalPrice"],
        limit: 2,
      });
      const generatedRows = await t.run(async (ctx) =>
        ctx.db
          .query("chatSuggestedQuestions")
          .withIndex("by_session_and_status", (q) => q.eq("sessionId", sessionId).eq("status", "active"))
          .take(10),
      );

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

describe("retired queued curated deletion", () => {
  it("preserves historical interactions when a pre-retirement deletion job runs", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const questionId = await seedHistoricalCurated(t, { question: "Historical booking policy", answer: "Archived answer" });
      const sessionId = await createWebSession(t, "queued-delete-visitor");
      await t.mutation(api.chatSuggestions.markClicked, { guestToken: fixtureGuestToken, sessionId, suggestion: { source: "curated", suggestionId: questionId } });
      const before = await t.run((ctx) => ctx.db.query("chatQuestionInteractions").withIndex("by_questionId", (q) => q.eq("questionId", questionId)).collect());
      await t.run((ctx) => ctx.scheduler.runAfter(0, internal.chatSuggestions.deleteCuratedInteractions, { questionId }));
      await finishScheduledWork(t);
      const after = await t.run((ctx) => ctx.db.query("chatQuestionInteractions").withIndex("by_questionId", (q) => q.eq("questionId", questionId)).collect());
      expect(after).toEqual(before);
      expect(after).toHaveLength(1);
      expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
