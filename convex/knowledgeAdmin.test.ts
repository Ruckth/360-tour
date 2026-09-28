// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";
const firstPage = (numItems = 50) => ({ numItems, cursor: null });

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", adminEmail));
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const t = convexTest(schema, modules);
  return { t, admin: t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" }) };
}

async function createSession(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: `web-${Math.random()}`,
      currentPath: "/",
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    }),
  );
}

async function createAnswer(
  admin: ReturnType<typeof setup>["admin"],
  args: { title: string; answer?: string; questions?: string[]; topicNames?: string[]; propertySlugs?: string[] },
) {
  return await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
    title: args.title,
    answer: args.answer ?? `${args.title} answer`,
    primaryQuestion: `What about ${args.title}?`,
    questions: args.questions,
    topicNames: args.topicNames,
    propertySlugs: args.propertySlugs,
  });
}

async function archive(admin: ReturnType<typeof setup>["admin"], answerId: Id<"chatAnswers">, title: string) {
  await admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
    answerId,
    title,
    answer: `${title} answer`,
    status: "archived",
  });
}

describe("unknown questions", () => {
  it("reopens ignored and resolved questions and clears the resolved links", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const answerId = await createAnswer(admin, { title: "Pets" });
    const ignoredId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: "Can I bring a parrot?",
    });
    const resolvedId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: "Can I bring my dog?",
    });
    await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, { unknownQuestionId: ignoredId });
    await admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, {
      unknownQuestionId: resolvedId,
      answerId,
      generateSimilar: false,
    });

    await expect(
      t.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: ignoredId }),
    ).rejects.toThrow();
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: ignoredId })).toEqual({
      reopened: true,
    });
    await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: resolvedId });
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId: resolvedId })).toEqual({
      reopened: false,
    });

    const [ignored, resolved] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(ignoredId), ctx.db.get(resolvedId)]),
    );
    expect(ignored?.status).toBe("new");
    expect(ignored?.ignoredAt).toBeUndefined();
    expect(resolved?.status).toBe("new");
    expect(resolved?.resolvedAnswerId).toBeUndefined();
    expect(resolved?.resolvedQuestionId).toBeUndefined();
    expect(resolved?.resolvedAt).toBeUndefined();
  });

  it("paginates and searches unknown questions by status", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    for (const question of ["Is there parking?", "Can I park a bus?", "Do you have a gym?"]) {
      await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: question });
    }

    const page = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "new",
      paginationOpts: firstPage(2),
    });
    expect(page.page).toHaveLength(2);
    expect(page.isDone).toBe(false);
    const rest = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "new",
      paginationOpts: { numItems: 2, cursor: page.continueCursor },
    });
    expect(rest.page.map((row) => row.userQuestion)).toEqual(["Is there parking?"]);

    const gym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "new",
      search: "gym",
      paginationOpts: firstPage(),
    });
    expect(gym.page.map((row) => row.userQuestion)).toEqual(["Do you have a gym?"]);
    expect(gym.page[0]?.sessionId).toBe(sessionId);

    await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, { unknownQuestionId: gym.page[0]!._id });
    const newGym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "new",
      search: "gym",
      paginationOpts: firstPage(),
    });
    expect(newGym.page).toEqual([]);
    const ignoredGym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
      status: "ignored",
      search: "gym",
      paginationOpts: firstPage(),
    });
    expect(ignoredGym.page).toHaveLength(1);
  });
});

describe("answers", () => {
  it("deletes only archived answers and cascades questions, scopes, topics and unknown links", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const answerId = await createAnswer(admin, {
      title: "Pets",
      questions: ["Are dogs allowed?"],
      topicNames: ["pets", "house_rules"],
      propertySlugs: ["test-scope"],
    });
    await createAnswer(admin, { title: "Quiet hours", topicNames: ["house_rules"] });
    const unknownId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: "Can I bring my cat?",
    });
    await admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, {
      unknownQuestionId: unknownId,
      answerId,
      generateSimilar: false,
    });

    await expect(admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId })).rejects.toThrow(
      "Archive the answer",
    );
    await archive(admin, answerId, "Pets");
    expect(await admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId })).toEqual({
      deleted: true,
      reopenedUnknownQuestions: 1,
    });

    const state = await t.run(async (ctx) => ({
      answer: await ctx.db.get(answerId),
      questions: await ctx.db
        .query("chatQuestions")
        .withIndex("by_answerId", (q) => q.eq("answerId", answerId))
        .collect(),
      scopes: await ctx.db
        .query("chatAnswerPropertyScopes")
        .withIndex("by_answerId", (q) => q.eq("answerId", answerId))
        .collect(),
      links: await ctx.db
        .query("chatAnswerTopics")
        .withIndex("by_answerId", (q) => q.eq("answerId", answerId))
        .collect(),
      topics: (await ctx.db.query("chatTopics").collect()).map((topic) => topic.name),
      unknown: await ctx.db.get(unknownId),
    }));
    expect(state.answer).toBeNull();
    expect(state.questions).toEqual([]);
    expect(state.scopes).toEqual([]);
    expect(state.links).toEqual([]);
    expect(state.topics).toEqual(["house_rules"]);
    expect(state.unknown?.status).toBe("new");
    expect(state.unknown?.resolvedAnswerId).toBeUndefined();
  });

  it("paginates answers and searches titles and answer text", async () => {
    const { admin } = setup();
    await createAnswer(admin, { title: "Breakfast", answer: "Breakfast is served from 7am." });
    await createAnswer(admin, { title: "Pool hours", answer: "The pool closes at 9pm." });
    await createAnswer(admin, { title: "Checkout", answer: "Late checkout includes breakfast boxes." });

    const page = await admin.query(api.chatKnowledge.adminListAnswers, {
      status: "approved",
      paginationOpts: firstPage(2),
    });
    expect(page.page).toHaveLength(2);
    expect(page.isDone).toBe(false);

    const breakfast = await admin.query(api.chatKnowledge.adminListAnswers, {
      status: "approved",
      search: "breakfast",
      paginationOpts: firstPage(),
    });
    expect(breakfast.isDone).toBe(true);
    expect(breakfast.page.map((answer) => answer.title)).toEqual(["Breakfast", "Checkout"]);
    expect(breakfast.page[0]?.questions[0]?.questionText).toBe("What about Breakfast?");

    const archived = await admin.query(api.chatKnowledge.adminListAnswers, {
      status: "archived",
      search: "breakfast",
      paginationOpts: firstPage(),
    });
    expect(archived.page).toEqual([]);
  });

  it("lists approved answer options and distinct topic names", async () => {
    const { admin } = setup();
    await createAnswer(admin, { title: "Wifi", topicNames: ["internet"] });
    const draftId = await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
      title: "Draft",
      answer: "Draft answer",
      status: "draft",
      primaryQuestion: "Draft?",
      topicNames: ["Internet", "drafts"],
    });

    expect(await admin.query(api.chatKnowledge.adminListAnswerOptions, {})).toEqual([
      expect.objectContaining({ title: "Wifi" }),
    ]);
    expect(await admin.query(api.chatKnowledge.adminListTopics, {})).toEqual(["drafts", "internet"]);

    await admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
      answerId: draftId,
      title: "Draft",
      answer: "Draft answer",
      status: "draft",
      topicNames: [],
    });
    expect(await admin.query(api.chatKnowledge.adminListTopics, {})).toEqual(["internet"]);
  });
});

describe("question variants", () => {
  async function questionsFor(t: ReturnType<typeof setup>["t"], answerId: Id<"chatAnswers">) {
    return await t.run(async (ctx) =>
      ctx.db
        .query("chatQuestions")
        .withIndex("by_answerId", (q) => q.eq("answerId", answerId))
        .collect(),
    );
  }

  it("sets primary, restores rejected variants and deletes non-primary variants", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const answerId = await createAnswer(admin, { title: "Parking", questions: ["Where do I park?"] });
    let questions = await questionsFor(t, answerId);
    const primary = questions.find((question) => question.isPrimary)!;
    const variant = questions.find((question) => !question.isPrimary)!;

    await expect(admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId: primary._id })).rejects.toThrow(
      "Make another question primary",
    );

    await admin.mutation(api.chatKnowledge.adminApproveQuestion, {
      questionId: variant._id,
      isPrimary: true,
      isAiTrigger: true,
    });
    questions = await questionsFor(t, answerId);
    expect(questions.find((question) => question._id === variant._id)).toMatchObject({
      isPrimary: true,
      isAiTrigger: true,
    });
    expect(questions.find((question) => question._id === primary._id)).toMatchObject({
      isPrimary: false,
      isAiTrigger: false,
    });

    await admin.mutation(api.chatKnowledge.adminRejectQuestion, { questionId: primary._id });
    await admin.mutation(api.chatKnowledge.adminApproveQuestion, { questionId: primary._id });
    questions = await questionsFor(t, answerId);
    const restored = questions.find((question) => question._id === primary._id);
    expect(restored).toMatchObject({ status: "approved", isPrimary: false });
    expect(restored?.rejectedAt).toBeUndefined();

    const unknownId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: "Is parking free?",
    });
    const linked = await admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, {
      unknownQuestionId: unknownId,
      answerId,
      generateSimilar: false,
    });
    await admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId: linked.questionId });
    await admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId: primary._id });

    questions = await questionsFor(t, answerId);
    expect(questions.map((question) => question.questionText)).toEqual(["Where do I park?"]);
    const unknown = await t.run(async (ctx) => ctx.db.get(unknownId));
    expect(unknown).toMatchObject({ status: "resolved", resolvedAnswerId: answerId });
    expect(unknown?.resolvedQuestionId).toBeUndefined();
  });
});

describe("curated suggestions", () => {
  it("removes the question's chat interactions when an archived suggestion is deleted", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    const questionId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
      question: "Is breakfast included?",
      answer: "Breakfast is included.",
      answerMode: "static",
      topic: "amenities",
    });
    const keptId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
      question: "Can I see the tour?",
      topic: "tour",
    });
    await t.mutation(api.chatSuggestions.markClicked, {
      sessionId,
      suggestion: { source: "curated", suggestionId: questionId },
    });
    await t.mutation(api.chatSuggestions.markClicked, {
      sessionId,
      suggestion: { source: "curated", suggestionId: keptId },
    });

    await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId });
    await admin.mutation(api.chatSuggestions.adminDeleteArchivedCurated, { questionId });

    const interactions = await t.run(async (ctx) => ctx.db.query("chatQuestionInteractions").collect());
    expect(interactions.map((interaction) => interaction.questionId)).toEqual([keptId]);
  });
});

async function createChannelSession(t: ReturnType<typeof convexTest>, channel: "web" | "line") {
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

async function askUnknown(t: ReturnType<typeof convexTest>, channel: "web" | "line", userQuestion: string) {
  const sessionId = await createChannelSession(t, channel);
  return await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion });
}

describe("grouped unknown questions", () => {
  it("groups identical questions with count, channels and a lexical best-match answer", async () => {
    const { t, admin } = setup();
    const petsId = await createAnswer(admin, { title: "Pets", questions: ["Are dogs allowed?"] });
    await askUnknown(t, "web", "Can I bring my dog?");
    await askUnknown(t, "line", "can i bring my DOG");
    await askUnknown(t, "web", "Is there a gym?");

    await expect(t.query(api.chatKnowledge.adminListUnknownGroups, {})).rejects.toThrow();
    const { groups, truncated } = await admin.query(api.chatKnowledge.adminListUnknownGroups, { status: "new" });
    expect(truncated).toBe(false);
    expect(groups).toHaveLength(2);
    const [dog, gym] = groups;
    expect(dog.normalizedQuestion).toBe("can i bring my dog");
    expect(dog.count).toBe(2);
    expect(dog.counts).toEqual({ new: 2, resolved: 0, ignored: 0 });
    expect([...dog.channels].sort()).toEqual(["line", "web"]);
    expect(dog.suggestion).toMatchObject({ answerId: petsId, title: "Pets" });
    expect(gym.count).toBe(1);
    expect(gym.suggestion).toBeNull();
  });

  it("ignores, undoes and links whole groups in one call", async () => {
    const { t, admin } = setup();
    const petsId = await createAnswer(admin, { title: "Pets" });
    const dogIds = [
      await askUnknown(t, "web", "Can I bring my dog?"),
      await askUnknown(t, "line", "Can I bring my dog"),
    ];
    const gymId = await askUnknown(t, "web", "Is there a gym?");
    const keys = ["can i bring my dog", "is there a gym"];

    await expect(
      t.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, { normalizedQuestions: keys }),
    ).rejects.toThrow();
    const ignored = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, { normalizedQuestions: keys });
    expect(ignored.ignored).toBe(3);
    expect(new Set(ignored.unknownQuestionIds)).toEqual(new Set([...dogIds, gymId]));

    // Undo: reopen exactly the rows that were ignored.
    expect(
      await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, {
        unknownQuestionIds: ignored.unknownQuestionIds,
      }),
    ).toEqual({ reopened: 3 });

    const linked = await admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, {
      normalizedQuestions: keys,
      answerId: petsId,
    });
    expect(linked.linked).toBe(3);
    const rows = await t.run(async (ctx) => Promise.all([...dogIds, gymId].map((id) => ctx.db.get(id))));
    expect(rows.every((row) => row?.status === "resolved" && row.resolvedAnswerId === petsId)).toBe(true);
    const questions = await t.run(async (ctx) =>
      ctx.db
        .query("chatQuestions")
        .withIndex("by_answerId", (q) => q.eq("answerId", petsId))
        .collect(),
    );
    // The primary question plus one approved question per group, not per row.
    expect(questions.map((question) => question.normalizedQuestion).sort()).toEqual([
      "can i bring my dog",
      "is there a gym",
      "what about pets",
    ]);

    // Linking again finds no "new" rows; reopening by group brings its rows back.
    const relinked = await admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, {
      normalizedQuestions: keys,
      answerId: petsId,
    });
    expect(relinked.linked).toBe(0);
    expect(
      await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, { normalizedQuestions: ["can i bring my dog"] }),
    ).toEqual({ reopened: 2 });

    await archive(admin, petsId, "Pets");
    await expect(
      admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, { normalizedQuestions: keys, answerId: petsId }),
    ).rejects.toThrow("archived");
  });

  it("resolves identical new questions when an answer is created from one of them", async () => {
    const { t, admin } = setup();
    const firstId = await askUnknown(t, "web", "Do you have a sauna?");
    const secondId = await askUnknown(t, "line", "do you have a sauna");
    const otherId = await askUnknown(t, "web", "Is there a spa?");

    const created = await admin.action(api.chatKnowledge.adminCreateAnswerFromUnknown, {
      unknownQuestionId: firstId,
      title: "Sauna",
      answer: "Yes, there is a sauna.",
      generateSimilar: false,
    });

    const [first, second, other] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(firstId), ctx.db.get(secondId), ctx.db.get(otherId)]),
    );
    expect(first?.resolvedAnswerId).toBe(created.answerId);
    expect(second?.status).toBe("resolved");
    expect(second?.resolvedAnswerId).toBe(created.answerId);
    expect(other?.status).toBe("new");
  });
});

describe("pending variants queue", () => {
  it("lists suggested variants across live answers and approves or rejects them in bulk", async () => {
    const { t, admin } = setup();
    const poolId = await createAnswer(admin, { title: "Pool" });
    const wifiId = await createAnswer(admin, { title: "Wifi" });
    const oldId = await createAnswer(admin, { title: "Old" });
    const suggestions: Array<[Id<"chatAnswers">, string[]]> = [
      [poolId, ["Is the pool heated?", "When does the pool open?"]],
      [wifiId, ["Is wifi free?"]],
      [oldId, ["Old question?"]],
    ];
    for (const [answerId, questions] of suggestions) {
      await t.mutation(internal.chatKnowledge.storeSuggestedQuestions, { answerId, questions, adminEmail });
    }
    await archive(admin, oldId, "Old");

    await expect(t.query(api.chatKnowledge.adminListPendingVariants, {})).rejects.toThrow();
    const { variants } = await admin.query(api.chatKnowledge.adminListPendingVariants, {});
    expect(variants.map((variant) => variant.answerTitle).sort()).toEqual(["Pool", "Pool", "Wifi"]);

    const [first, ...rest] = variants;
    expect(await admin.mutation(api.chatKnowledge.adminApproveQuestions, { questionIds: [first._id] })).toEqual({
      approved: 1,
    });
    expect(
      await admin.mutation(api.chatKnowledge.adminRejectQuestions, { questionIds: rest.map((variant) => variant._id) }),
    ).toEqual({ rejected: 2 });
    expect((await admin.query(api.chatKnowledge.adminListPendingVariants, {})).variants).toEqual([]);

    // Undo puts them back in the queue.
    const restIds = rest.map((variant) => variant._id);
    expect(await admin.mutation(api.chatKnowledge.adminUnreviewQuestions, { questionIds: restIds })).toEqual({ reset: 2 });
    expect((await admin.query(api.chatKnowledge.adminListPendingVariants, {})).variants).toHaveLength(2);
    expect(await t.run(async (ctx) => ctx.db.get(first._id))).toMatchObject({ status: "approved", isPrimary: false });
  });
});

describe("bulk answer and suggestion status", () => {
  it("archives answers in bulk and undoes back to each previous status", async () => {
    const { t, admin } = setup();
    const approvedId = await createAnswer(admin, { title: "Parking" });
    const draftId = await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
      title: "Draft",
      answer: "Draft answer",
      status: "draft",
      primaryQuestion: "Draft?",
    });

    await expect(
      t.mutation(api.chatKnowledge.adminSetAnswersStatus, { answerIds: [approvedId], status: "archived" }),
    ).rejects.toThrow();
    const { changed } = await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, {
      answerIds: [approvedId, draftId],
      status: "archived",
    });
    expect(changed).toEqual([
      { answerId: approvedId, previousStatus: "approved" },
      { answerId: draftId, previousStatus: "draft" },
    ]);
    for (const { answerId, previousStatus } of changed) {
      await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, { answerIds: [answerId], status: previousStatus });
    }
    const [approved, draft] = await t.run(async (ctx) => Promise.all([ctx.db.get(approvedId), ctx.db.get(draftId)]));
    expect(approved?.status).toBe("approved");
    expect(approved?.archivedAt).toBeUndefined();
    expect(draft?.status).toBe("draft");
  });

  it("archives and restores curated suggestions in bulk", async () => {
    const { t, admin } = setup();
    const ids = [
      await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: "Is breakfast included?", topic: "amenities" }),
      await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: "Can I see the tour?", topic: "tour" }),
    ];
    await expect(
      t.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: ids, status: "archived" }),
    ).rejects.toThrow();
    const archived = await admin.mutation(api.chatSuggestions.adminSetCuratedStatus, {
      questionIds: ids,
      status: "archived",
    });
    expect(archived.changedIds).toEqual(ids);
    expect(await admin.query(api.chatSuggestions.adminListCurated, { status: "active" })).toEqual([]);
    await admin.mutation(api.chatSuggestions.adminSetCuratedStatus, { questionIds: ids, status: "active" });
    expect(await admin.query(api.chatSuggestions.adminListCurated, { status: "archived" })).toEqual([]);
  });

  it("translates only missing languages in bounded batches", async () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    const allLocales = ["th", "zh-CN", "ja", "ko", "fr", "de", "es", "ru", "it", "hi"];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const prompt = String(JSON.parse(String(init.body)).messages[1].content);
      const locales = prompt.match(/Target locales: (.*)/)?.[1].split(", ") ?? [];
      const translate = (prefix: string) => Object.fromEntries(locales.map((locale) => [locale, `${prefix} ${locale}`]));
      const content = JSON.stringify({ questionTranslations: translate("Q"), answerTranslations: translate("A") });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { t, admin } = setup();
      const handWritten = { th: "มีอาหารเช้าไหม" };
      const staticId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Is breakfast included?",
        answer: "Yes.",
        answerMode: "static",
        translations: handWritten,
        topic: "amenities",
      });
      const liveId = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Is it free?",
        topic: "availability",
      });
      await admin.mutation(api.chatSuggestions.adminCreateCurated, {
        question: "Complete?",
        topic: "tour",
        translations: Object.fromEntries(allLocales.map((locale) => [locale, `done ${locale}`])),
      });

      await expect(t.action(api.chatSuggestions.adminTranslateMissingCurated, {})).rejects.toThrow();
      const first = await admin.action(api.chatSuggestions.adminTranslateMissingCurated, { batchSize: 1 });
      expect(first).toMatchObject({ translated: 1, failed: 0, remaining: 1 });
      const second = await admin.action(api.chatSuggestions.adminTranslateMissingCurated, {
        batchSize: 1,
        skipIds: first.processedIds,
      });
      expect(second).toMatchObject({ translated: 1, remaining: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [staticRow, liveRow] = await t.run(async (ctx) => Promise.all([ctx.db.get(staticId), ctx.db.get(liveId)]));
      expect(staticRow?.translations?.th).toBe(handWritten.th);
      expect(staticRow?.translations?.de).toBe("Q de");
      expect(staticRow?.answerTranslations?.th).toBe("A th");
      expect(Object.keys(liveRow?.translations ?? {})).toHaveLength(allLocales.length + 1);
      expect(liveRow?.answerTranslations).toBeUndefined();
      expect((await admin.action(api.chatSuggestions.adminTranslateMissingCurated, {})).remaining).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
