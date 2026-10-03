// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("never revives saved answers via matching, restoration, authoring, seeding or queued generation", async () => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("AI_API_KEY", "test-key");
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const sessionId = await t.mutation(api.chat.createSession, {
    channel: "web",
  });
  const { answerId, questionId, curatedId, unknownId } = await t.run(
    async (ctx) => {
      const answerId = await ctx.db.insert("chatAnswers", {
        title: "Retired breakfast",
        answer: "Breakfast costs ฿450.",
        status: "approved",
        createdAt: 1,
        updatedAt: 1,
        createdByAdminEmail: "admin@example.com",
        updatedByAdminEmail: "admin@example.com",
      });
      const questionId = await ctx.db.insert("chatQuestions", {
        answerId,
        questionText: "Breakfast?",
        normalizedQuestion: "breakfast",
        isPrimary: true,
        isAiTrigger: true,
        createdBy: "admin",
        status: "approved",
        createdAt: 1,
        updatedAt: 1,
      });
      const curatedId = await ctx.db.insert("curatedChatQuestions", {
        question: "Breakfast?",
        normalizedQuestion: "breakfast",
        answer: "Old fixture.",
        answerMode: "static",
        topic: "policy",
        score: 100,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
        createdByAdminEmail: "admin@example.com",
        updatedByAdminEmail: "admin@example.com",
      });
      const unknownId = await ctx.db.insert("chatUnknownQuestions", {
        sessionId,
        userQuestion: "Breakfast?",
        normalizedQuestion: "breakfast",
        status: "new",
        adminNotified: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { answerId, questionId, curatedId, unknownId };
    },
  );
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await t.query(api.chatKnowledge.resolveExact, {
      sessionId,
      messageText: "Breakfast?",
    }),
  ).toBeNull();
  expect(
    await t.query(internal.chatKnowledge.getApprovedContext, { sessionId }),
  ).toEqual([]);
  expect(
    await t.query(api.chatSuggestions.resolveCuratedExact, {
      sessionId,
      messageText: "Breakfast?",
    }),
  ).toBeNull();
  expect(
    await t.action(api.chatSuggestions.resolveCuratedSemantic, {
      sessionId,
      messageText: "Breakfast?",
    }),
  ).toBeNull();
  await expect(
    admin.mutation(api.chatKnowledge.adminCreateAnswer, {
      title: "No",
      answer: "No",
    }),
  ).rejects.toThrow("retired");
  await expect(
    admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
      answerId,
      title: "No",
      answer: "No",
      status: "approved",
    }),
  ).rejects.toThrow("retired");
  await expect(
    admin.mutation(api.chatKnowledge.adminApproveQuestion, { questionId }),
  ).rejects.toThrow("retired");
  await expect(
    admin.mutation(api.seed.seedCuratedQuestionBank, {}),
  ).rejects.toThrow("retired");
  await expect(
    admin.mutation(api.chatSuggestions.adminCreateCurated, {
      question: "Breakfast?",
      topic: "policy",
      score: 1,
    }),
  ).rejects.toThrow("retired");
  await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, {
    answerIds: [answerId],
    status: "archived",
  });
  await expect(
    admin.mutation(api.chatKnowledge.adminSetAnswersStatus, {
      answerIds: [answerId],
      status: "approved",
    }),
  ).rejects.toThrow("retired");
  await admin.mutation(api.chatSuggestions.adminSetCuratedStatus, {
    questionIds: [curatedId],
    status: "archived",
  });
  await expect(
    admin.mutation(api.chatSuggestions.adminRestoreCurated, {
      questionId: curatedId,
    }),
  ).rejects.toThrow("retired");
  await expect(
    admin.mutation(api.chatSuggestions.adminSetCuratedStatus, {
      questionIds: [curatedId],
      status: "active",
    }),
  ).rejects.toThrow("retired");
  expect(
    await t.mutation(internal.chatKnowledge.storeSuggestedQuestions, {
      answerId,
      questions: ["Free airport pickup?"],
      adminEmail: "admin@example.com",
    }),
  ).toEqual({ insertedQuestionIds: [] });
  await t.action(internal.chatKnowledge.generateSuggestedVariants, {
    answerId,
    linkQuestionId: questionId,
    linkUnknownQuestionId: unknownId,
    adminEmail: "admin@example.com",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.query("chatQuestions").take(10)),
  ).toHaveLength(1);
});
