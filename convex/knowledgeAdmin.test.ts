// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
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
