// @vitest-environment edge-runtime
// The legacy answer/question/curated authoring workflow is retired: every writer refuses (after
// auth), permanent deletes refuse, but unknown-question review, archival, and the read-only
// archive/list queries stay available.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeSuggestedQuestion } from "./lib/chatSuggestions";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";
const RETIRED = "Saved answers and Q&A are retired. Maintain Business facts instead.";
const firstPage = (numItems = 50) => ({ numItems, cursor: null });

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", adminEmail));
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const t = convexTest(schema, modules);
  return { t, admin: t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" }) };
}

async function createSession(t: ReturnType<typeof convexTest>, channel: "web" | "line" = "web") {
  return await t.run(async (ctx) =>
    ctx.db.insert("chatSessions", {
      channel,
      visitorId: `${channel}-${Math.random()}`,
      currentPath: "/",
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    }),
  );
}

/** A historical approved saved answer + primary question (direct insert, pre-retirement data). */
async function seedHistoricalAnswer(
  t: ReturnType<typeof convexTest>,
  args: { title: string; answer?: string; question?: string; status?: "approved" | "archived" },
): Promise<Id<"chatAnswers">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const answerId = await ctx.db.insert("chatAnswers", {
      title: args.title,
      answer: args.answer ?? `${args.title} answer`,
      status: args.status ?? "approved",
      createdAt: now,
      updatedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    const question = args.question ?? `What about ${args.title}?`;
    await ctx.db.insert("chatQuestions", {
      answerId,
      questionText: question,
      normalizedQuestion: normalizeSuggestedQuestion(question),
      isPrimary: true,
      isAiTrigger: true,
      createdBy: "admin",
      status: "approved",
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    return answerId;
  });
}

/** A historical curated question + variant rows (direct insert). */
async function seedHistoricalCurated(
  t: ReturnType<typeof convexTest>,
  args: { question: string; answer?: string; answerMode?: "static" | "dynamic"; topic?: string; status?: "active" | "archived" },
): Promise<Id<"curatedChatQuestions">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const questionId = await ctx.db.insert("curatedChatQuestions", {
      question: args.question,
      normalizedQuestion: normalizeSuggestedQuestion(args.question),
      translations: { en: args.question },
      ...(args.answer ? { answer: args.answer } : {}),
      answerMode: args.answerMode ?? (args.answer ? "static" : "dynamic"),
      topic: args.topic ?? "amenities",
      score: 50,
      status: args.status ?? "active",
      createdAt: now,
      updatedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    await ctx.db.insert("curatedChatQuestionVariants", { questionId, normalizedVariant: normalizeSuggestedQuestion(args.question) });
    return questionId;
  });
}

describe("the admin authoring workflow is retired", () => {
  it("refuses saved-answer writers after enforcing auth", async () => {
    const { t, admin } = setup();
    const answerId = await seedHistoricalAnswer(t, { title: "Pets" });
    const questionId = await t.run((ctx) =>
      ctx.db.query("chatQuestions").withIndex("by_answerId", (q) => q.eq("answerId", answerId)).first(),
    ).then((q) => q!._id);

    // Unauthenticated callers get the auth error first.
    await expect(
      t.mutation(api.chatKnowledge.adminCreateAnswer, { title: "X", answer: "x", primaryQuestion: "x?" }),
    ).rejects.toThrow("Not authenticated");

    // Authenticated admins get the retirement refusal.
    await expect(admin.mutation(api.chatKnowledge.adminCreateAnswer, { title: "X", answer: "x", primaryQuestion: "x?" })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminUpdateAnswer, { answerId, title: "Pets", answer: "a", status: "approved", topicNames: [] })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminApproveQuestion, { questionId, isPrimary: true })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, { normalizedQuestions: ["x"], answerId })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminApproveQuestions, { questionIds: [questionId] })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminUnreviewQuestions, { questionIds: [questionId] })).rejects.toThrow(RETIRED);
    await expect(admin.action(api.chatKnowledge.adminGenerateSimilarQuestions, { answerId })).rejects.toThrow(RETIRED);
  });

  it("refuses permanent deletes but allows archival", async () => {
    const { t, admin } = setup();
    const answerId = await seedHistoricalAnswer(t, { title: "Pets" });
    const questionId = await t.run((ctx) =>
      ctx.db.query("chatQuestions").withIndex("by_answerId", (q) => q.eq("answerId", answerId)).first(),
    ).then((q) => q!._id);

    // Archive stays allowed via the bulk status mutation.
    await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, { answerIds: [answerId], status: "archived" });
    expect(await t.run((ctx) => ctx.db.get(answerId))).toMatchObject({ status: "archived" });

    // Permanent deletes of read-only archives refuse; the rows survive.
    await expect(admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId })).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId })).rejects.toThrow(RETIRED);
    expect(await t.run((ctx) => ctx.db.get(answerId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
  });

  it("refuses creating or resolving answers from an unknown question", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const unknownId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Do you have a sauna?" });
    const answerId = await seedHistoricalAnswer(t, { title: "Sauna" });

    await expect(
      admin.action(api.chatKnowledge.adminCreateAnswerFromUnknown, { unknownQuestionId: unknownId, title: "Sauna", answer: "Yes." }),
    ).rejects.toThrow(RETIRED);
    await expect(
      admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, { unknownQuestionId: unknownId, answerId, generateSimilar: false }),
    ).rejects.toThrow(RETIRED);
    // The unknown question stays new and unresolved.
    expect(await t.run((ctx) => ctx.db.get(unknownId))).toMatchObject({ status: "new" });
  });

  it("refuses curated writers but allows archival", async () => {
    const { t, admin } = setup();
    const questionId = await seedHistoricalCurated(t, { question: "Is breakfast included?", answer: "Yes.", answerMode: "static" });

    await expect(
      t.mutation(api.chatSuggestions.adminCreateCurated, { question: "Can I see the tour?", topic: "tour" }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      admin.mutation(api.chatSuggestions.adminCreateCurated, { question: "Can I see the tour?", topic: "tour" }),
    ).rejects.toThrow(RETIRED);
    await expect(
      admin.mutation(api.chatSuggestions.adminUpdateCurated, { questionId, question: "Edited", topic: "amenities", score: 1 }),
    ).rejects.toThrow(RETIRED);
    await expect(admin.mutation(api.chatSuggestions.adminRestoreCurated, { questionId })).rejects.toThrow(RETIRED);
    await expect(admin.action(api.chatSuggestions.adminTranslateMissingCurated, {})).rejects.toThrow(RETIRED);

    // Archive-only bulk status stays allowed; restore is refused.
    const archived = await admin.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: [questionId], status: "archived" });
    expect(archived.changedIds).toEqual([questionId]);
    await expect(
      admin.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: [questionId], status: "active" }),
    ).rejects.toThrow(RETIRED);
    // Permanent delete of an archived curated row refuses.
    await expect(admin.mutation(api.chatSuggestions.adminDeleteArchivedCurated, { questionId })).rejects.toThrow(RETIRED);
    expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
  });
});

describe("unknown-question review stays available", () => {
  it("reopens ignored and resolved questions and clears the resolved links", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const answerId = await seedHistoricalAnswer(t, { title: "Pets" });
    const ignoredId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Can I bring a parrot?" });
    const resolvedId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Can I bring my dog?" });
    await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, { unknownQuestionId: ignoredId });
    // A historical resolution to a saved answer, written directly.
    await t.run((ctx) =>
      ctx.db.patch(resolvedId, { status: "resolved", resolvedAnswerId: answerId, resolvedAt: Date.now(), updatedAt: Date.now() }),
    );

    await expect(t.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: ignoredId })).rejects.toThrow();
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: ignoredId })).toEqual({ reopened: true });
    await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: resolvedId });
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: resolvedId })).toEqual({ reopened: false });

    const [ignored, resolved] = await t.run(async (ctx) => Promise.all([ctx.db.get(ignoredId), ctx.db.get(resolvedId)]));
    expect(ignored?.status).toBe("new");
    expect(ignored?.ignoredAt).toBeUndefined();
    expect(resolved?.status).toBe("new");
    expect(resolved?.resolvedAnswerId).toBeUndefined();
    expect(resolved?.resolvedQuestionId).toBeUndefined();
    expect(resolved?.resolvedFactId).toBeUndefined();
    expect(resolved?.resolvedSource).toBeUndefined();
  });

  it("paginates and searches unknown questions by status", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    for (const question of ["Is there parking?", "Can I park a bus?", "Do you have a gym?"]) {
      await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: question });
    }

    const page = await admin.query(api.chatKnowledge.adminListUnknownQuestions, { status: "new", paginationOpts: firstPage(2) });
    expect(page.page).toHaveLength(2);
    expect(page.isDone).toBe(false);
    const rest = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "new",
      paginationOpts: { numItems: 2, cursor: page.continueCursor },
    });
    expect(rest.page.map((row) => row.userQuestion)).toEqual(["Is there parking?"]);

    const gym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, { status: "new", search: "gym", paginationOpts: firstPage() });
    expect(gym.page.map((row) => row.userQuestion)).toEqual(["Do you have a gym?"]);
    expect(gym.page[0]?.sessionId).toBe(sessionId);

    await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, { unknownQuestionId: gym.page[0]!._id });
    const newGym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, { status: "new", search: "gym", paginationOpts: firstPage() });
    expect(newGym.page).toEqual([]);
    const ignoredGym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, { status: "ignored", search: "gym", paginationOpts: firstPage() });
    expect(ignoredGym.page).toHaveLength(1);
  });

  it("exposes resolvedFactTitle, resolvedSource and resolvedAnswerTitle on list rows", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const answerId = await seedHistoricalAnswer(t, { title: "Pets" });
    const factId = await t.run((ctx) =>
      ctx.db.insert("businessFacts", {
        title: "Breakfast fact", body: "Breakfast is at 7am.", searchText: "breakfast", source: "owner",
        status: "approved", revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
        createdByAdminEmail: adminEmail, updatedByAdminEmail: adminEmail,
      }),
    );
    const byAnswer = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Pets?" });
    const byFact = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Breakfast time?" });
    const bySource = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Check-in time?" });
    await t.run(async (ctx) => {
      await ctx.db.patch(byAnswer, { status: "resolved", resolvedAnswerId: answerId, resolvedAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(byFact, { status: "resolved", resolvedFactId: factId, resolvedAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(bySource, { status: "resolved", resolvedSource: "settings", resolvedAt: Date.now(), updatedAt: Date.now() });
    });

    const page = await admin.query(api.chatKnowledge.adminListUnknownQuestions, { status: "resolved", paginationOpts: firstPage() });
    const byId = new Map(page.page.map((row) => [row._id, row]));
    expect(byId.get(byAnswer)?.resolvedAnswerTitle).toBe("Pets");
    expect(byId.get(byFact)?.resolvedFactTitle).toBe("Breakfast fact");
    expect(byId.get(bySource)?.resolvedSource).toBe("settings");
  });
});

describe("grouped unknown questions", () => {
  async function askUnknown(t: ReturnType<typeof convexTest>, channel: "web" | "line", userQuestion: string) {
    const sessionId = await createSession(t, channel);
    return await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion });
  }

  it("groups identical questions with count and channels, and the retired answer-suggester returns nothing", async () => {
    const { t, admin } = setup();
    await askUnknown(t, "web", "Can I bring my dog?");
    await askUnknown(t, "line", "can i bring my DOG");
    await askUnknown(t, "web", "Is there a gym?");

    await expect(t.query(api.chatKnowledge.adminListUnknownGroups, {})).rejects.toThrow();
    const { groups, truncated } = await admin.query(api.chatKnowledge.adminListUnknownGroups, { status: "new" });
    expect(truncated).toBe(false);
    expect(groups).toHaveLength(2);
    const dog = groups.find((group) => group.normalizedQuestion === "can i bring my dog")!;
    expect(dog.count).toBe(2);
    expect(dog.counts).toEqual({ new: 2, resolved: 0, ignored: 0 });
    expect([...dog.channels].sort()).toEqual(["line", "web"]);

    // The lexical answer-suggester is retired and surfaces no legacy answers.
    const suggestions = await admin.query(api.chatKnowledge.adminSuggestAnswersForUnknownGroups, {
      groups: groups.map((group) => ({ normalizedQuestion: group.normalizedQuestion, userQuestion: group.latest.userQuestion })),
    });
    expect(suggestions).toEqual({});
  });

  it("ignores and reopens whole groups in one call (linking is retired)", async () => {
    const { t, admin } = setup();
    const dogIds = [
      await askUnknown(t, "web", "Can I bring my dog?"),
      await askUnknown(t, "line", "Can I bring my dog"),
    ];
    const gymId = await askUnknown(t, "web", "Is there a gym?");
    const keys = ["can i bring my dog", "is there a gym"];

    await expect(t.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, { normalizedQuestions: keys })).rejects.toThrow();
    const ignored = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, { normalizedQuestions: keys });
    expect(ignored.ignored).toBe(3);
    expect(new Set(ignored.unknownQuestionIds)).toEqual(new Set([...dogIds, gymId]));

    expect(
      await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, { unknownQuestionIds: ignored.unknownQuestionIds }),
    ).toEqual({ reopened: 3, remaining: 0 });

    // Linking a group to a historical answer is a retired write.
    const answerId = await seedHistoricalAnswer(t, { title: "Pets" });
    await expect(
      admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, { normalizedQuestions: keys, answerId }),
    ).rejects.toThrow(RETIRED);
  });
});

describe("read-only archive/list queries stay available", () => {
  it("lists historical answers, options and topics for the archive view", async () => {
    const { t, admin } = setup();
    await seedHistoricalAnswer(t, { title: "Breakfast", answer: "Breakfast is served from 7am." });
    await seedHistoricalAnswer(t, { title: "Pool hours", answer: "The pool closes at 9pm." });

    const page = await admin.query(api.chatKnowledge.adminListAnswers, { status: "approved", paginationOpts: firstPage(2) });
    expect(page.page.map((answer) => answer.title).sort()).toContain("Breakfast");

    const breakfast = await admin.query(api.chatKnowledge.adminListAnswers, { status: "approved", search: "breakfast", paginationOpts: firstPage() });
    expect(breakfast.page.map((answer) => answer.title)).toContain("Breakfast");

    // The option/topic pickers remain readable (used by the archive view).
    expect(await admin.query(api.chatKnowledge.adminListAnswerOptions, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Breakfast" })]),
    );

    // Non-admins cannot read the archive.
    await expect(t.query(api.chatKnowledge.adminListAnswers, { paginationOpts: firstPage() })).rejects.toThrow("Not authenticated");
  });

  it("lists pending variants from historical rows (read-only queue)", async () => {
    const { t, admin } = setup();
    const poolId = await seedHistoricalAnswer(t, { title: "Pool" });
    await t.run((ctx) =>
      ctx.db.insert("chatQuestions", {
        answerId: poolId, questionText: "Is the pool heated?", normalizedQuestion: "is the pool heated",
        isPrimary: false, isAiTrigger: false, createdBy: "ai", status: "suggested", createdAt: 1, updatedAt: 1,
      }),
    );
    await expect(t.query(api.chatKnowledge.adminListPendingVariants, {})).rejects.toThrow();
    const { variants } = await admin.query(api.chatKnowledge.adminListPendingVariants, {});
    expect(variants.map((variant) => variant.answerTitle)).toEqual(["Pool"]);
  });

  it("lists and archives curated rows (read-only + archival only)", async () => {
    const { t, admin } = setup();
    const ids = [
      await seedHistoricalCurated(t, { question: "Is breakfast included?", topic: "amenities" }),
      await seedHistoricalCurated(t, { question: "Can I see the tour?", topic: "tour" }),
    ];
    await expect(t.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: ids, status: "archived" })).rejects.toThrow();
    const archived = await admin.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: ids, status: "archived" });
    expect(new Set(archived.changedIds)).toEqual(new Set(ids));
    expect(await admin.query(api.chatSuggestions.adminListCurated, { status: "active" })).toEqual([]);
  });
});

describe("internal workers no-op after retirement", () => {
  it("storeSuggestedQuestions and the translation worker refuse/no-op", async () => {
    const { t } = setup();
    const answerId = await seedHistoricalAnswer(t, { title: "Pool" });
    const curatedId = await seedHistoricalCurated(t, { question: "Is breakfast included?", answer: "Yes.", answerMode: "static" });

    // Variant generation worker no-ops.
    expect(
      await t.mutation(internal.chatKnowledge.storeSuggestedQuestions, { answerId, questions: ["Is the pool heated?"], adminEmail }),
    ).toEqual({ insertedQuestionIds: [] });

    // Translation discovery reports nothing; applying translations refuses.
    expect(await t.query(internal.chatSuggestions.listCuratedMissingTranslations, { limit: 5, skipIds: [] })).toEqual({ total: 0, batch: [] });
    await expect(
      t.mutation(internal.chatSuggestions.applyCuratedTranslations, {
        questionId: curatedId,
        questionTranslations: { th: "x" },
        answerTranslations: {},
        adminEmail,
      }),
    ).rejects.toThrow(RETIRED);
  });
});
