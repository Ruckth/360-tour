// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  return {
    t,
    admin: t.withIdentity({
      email: adminEmail,
      tokenIdentifier: "admin-token",
    }),
  };
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
  args: {
    title: string;
    answer?: string;
    questions?: string[];
    topicNames?: string[];
    propertySlugs?: string[];
  },
) {
  return await admin.run(async (ctx) => {
    const now = Date.now();
    const answerId = await ctx.db.insert("chatAnswers", {
      title: args.title,
      answer: args.answer ?? args.title + " answer",
      status: "approved",
      createdAt: now,
      updatedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    for (const [i, questionText] of [
      "What about " + args.title + "?",
      ...(args.questions ?? []),
    ].entries())
      await ctx.db.insert("chatQuestions", {
        answerId,
        questionText,
        normalizedQuestion: questionText.toLowerCase().replace(/[?]/g, ""),
        isPrimary: i === 0,
        isAiTrigger: i === 0,
        createdBy: "admin",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      });
    for (const slug of args.propertySlugs ?? [])
      await ctx.db.insert("chatAnswerPropertyScopes", {
        answerId,
        propertySlug: slug,
        normalizedSlug: slug,
        source: "custom",
        createdAt: now,
        updatedAt: now,
        createdByAdminEmail: adminEmail,
        updatedByAdminEmail: adminEmail,
      });
    for (const name of args.topicNames ?? []) {
      const topic = await ctx.db
        .query("chatTopics")
        .withIndex("by_normalizedName", (q) =>
          q.eq("normalizedName", name.toLowerCase()),
        )
        .first();
      const topicId = topic
        ? topic._id
        : await ctx.db.insert("chatTopics", {
            name,
            normalizedName: name.toLowerCase(),
            description: "",
            createdAt: now,
            updatedAt: now,
          });
      await ctx.db.insert("chatAnswerTopics", {
        answerId,
        topicId,
        createdAt: now,
      });
    }
    return answerId;
  });
}

async function archive(
  admin: ReturnType<typeof setup>["admin"],
  answerId: Id<"chatAnswers">,
  title: string,
) {
  void title;
  await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, {
    answerIds: [answerId],
    status: "archived",
  });
}

it("reads archived-compatible variants and deletes a large answer cascade before its parent", async () => {
  vi.useFakeTimers();
  try {
    const { t, admin } = setup();
    const answerId = await createAnswer(admin, { title: "Large answer" });
    await t.run(async (ctx) => {
      const questionId = await ctx.db.insert("chatQuestions", {
        answerId,
        questionText: "Another phrasing",
        normalizedQuestion: "another phrasing",
        isPrimary: false,
        isAiTrigger: false,
        createdBy: "admin",
        status: "approved",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("chatQuestions", {
          answerId,
          questionText: `Variant ${i}`,
          normalizedQuestion: `variant ${i}`,
          isPrimary: false,
          isAiTrigger: false,
          createdBy: "admin",
          status: "approved",
          createdAt: i + 2,
          updatedAt: i + 2,
        });
        await ctx.db.insert("chatUnknownQuestions", {
          userQuestion: `Unknown ${i}`,
          normalizedQuestion: `unknown ${i}`,
          status: "resolved",
          adminNotified: false,
          resolvedAnswerId: answerId,
          resolvedQuestionId: questionId,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    // The list row is a preview (primary included); the edit dialog loads every variant.
    const list = await admin.query(api.chatKnowledge.adminListAnswers, {
      paginationOpts: firstPage(),
    });
    const row = list.page.find((answer) => answer._id === answerId)!;
    expect(row.questions).toHaveLength(10);
    expect(row.questions.some((question) => question.isPrimary)).toBe(true);
    expect(row.questionsTruncated.approved).toBe(true);
    const detail = (await admin.query(api.chatKnowledge.adminGetAnswerDetail, {
      answerId,
    }))!;
    expect(detail.questions).toHaveLength(122);
    await archive(admin, answerId, "Large answer");
    await admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId });
    expect(await t.run((ctx) => ctx.db.get(answerId))).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(answerId))).toBeNull();
    const unknowns = await t.run((ctx) =>
      ctx.db.query("chatUnknownQuestions").take(200),
    );
    expect(unknowns).toHaveLength(120);
    expect(
      unknowns.every(
        (row) =>
          row.status === "new" &&
          !row.resolvedAnswerId &&
          !row.resolvedQuestionId,
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("deletes a question only after unlinking every unknown that points at it", async () => {
  vi.useFakeTimers();
  try {
    const { t, admin } = setup();
    const answerId = await createAnswer(admin, { title: "Parking" });
    const questionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("chatQuestions", {
        answerId,
        questionText: "Is parking free?",
        normalizedQuestion: "is parking free",
        isPrimary: false,
        isAiTrigger: false,
        createdBy: "admin",
        status: "approved",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let i = 0; i < 120; i++)
        await ctx.db.insert("chatUnknownQuestions", {
          userQuestion: "Is parking free?",
          normalizedQuestion: "is parking free",
          status: "resolved",
          adminNotified: false,
          resolvedAnswerId: answerId,
          resolvedQuestionId: id,
          createdAt: i,
          updatedAt: i,
        });
      return id;
    });
    await admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId });
    expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(questionId))).toBeNull();
    const unknowns = await t.run((ctx) =>
      ctx.db.query("chatUnknownQuestions").take(200),
    );
    expect(unknowns).toHaveLength(120);
    expect(
      unknowns.every(
        (row) =>
          row.status === "resolved" &&
          row.resolvedAnswerId === answerId &&
          !row.resolvedQuestionId,
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

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
  await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, {
    unknownQuestionId: ignoredId,
  });
  await t.run((ctx) =>
    ctx.db.patch(resolvedId, {
      status: "resolved",
      resolvedAnswerId: answerId,
      resolvedAt: Date.now(),
    }),
  );

  await expect(
    t.mutation(api.chatKnowledge.adminReopenUnknown, {
      unknownQuestionId: ignoredId,
    }),
  ).rejects.toThrow();
  expect(
    await admin.mutation(api.chatKnowledge.adminReopenUnknown, {
      unknownQuestionId: ignoredId,
    }),
  ).toEqual({
    reopened: true,
  });
  await admin.mutation(api.chatKnowledge.adminReopenUnknown, {
    unknownQuestionId: resolvedId,
  });
  expect(
    await admin.mutation(api.chatKnowledge.adminReopenUnknown, {
      unknownQuestionId: resolvedId,
    }),
  ).toEqual({
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
  for (const question of [
    "Is there parking?",
    "Can I park a bus?",
    "Do you have a gym?",
  ]) {
    await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: question,
    });
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
  expect(rest.page.map((row) => row.userQuestion)).toEqual([
    "Is there parking?",
  ]);

  const gym = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
    status: "new",
    search: "gym",
    paginationOpts: firstPage(),
  });
  expect(gym.page.map((row) => row.userQuestion)).toEqual([
    "Do you have a gym?",
  ]);
  expect(gym.page[0]?.sessionId).toBe(sessionId);

  await admin.mutation(api.chatKnowledge.adminIgnoreUnknown, {
    unknownQuestionId: gym.page[0]!._id,
  });
  const newGym = await admin.query(
    api.chatKnowledge.adminListUnknownQuestions,
    {
      status: "new",
      search: "gym",
      paginationOpts: firstPage(),
    },
  );
  expect(newGym.page).toEqual([]);
  const ignoredGym = await admin.query(
    api.chatKnowledge.adminListUnknownQuestions,
    {
      status: "ignored",
      search: "gym",
      paginationOpts: firstPage(),
    },
  );
  expect(ignoredGym.page).toHaveLength(1);
});

it("deletes only archived answers and cascades questions, scopes, topics and unknown links", async () => {
  const { t, admin } = setup();
  const sessionId = await createSession(t);
  const answerId = await createAnswer(admin, {
    title: "Pets",
    questions: ["Are dogs allowed?"],
    topicNames: ["pets", "house_rules"],
    propertySlugs: ["test-scope"],
  });
  await createAnswer(admin, {
    title: "Quiet hours",
    topicNames: ["house_rules"],
  });
  const unknownId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
    sessionId,
    userQuestion: "Can I bring my cat?",
  });
  await t.run((ctx) =>
    ctx.db.patch(unknownId, {
      status: "resolved",
      resolvedAnswerId: answerId,
      resolvedAt: Date.now(),
    }),
  );

  await expect(
    admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId }),
  ).rejects.toThrow("Archive the answer");
  await archive(admin, answerId, "Pets");
  expect(
    await admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId }),
  ).toEqual({
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
    topics: (await ctx.db.query("chatTopics").collect()).map(
      (topic) => topic.name,
    ),
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
  await createAnswer(admin, {
    title: "Breakfast",
    answer: "Breakfast is served from 7am.",
  });
  await createAnswer(admin, {
    title: "Pool hours",
    answer: "The pool closes at 9pm.",
  });
  await createAnswer(admin, {
    title: "Checkout",
    answer: "Late checkout includes breakfast boxes.",
  });

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
  expect(breakfast.page.map((answer) => answer.title)).toEqual([
    "Breakfast",
    "Checkout",
  ]);
  expect(breakfast.page[0]?.questions[0]?.questionText).toBe(
    "What about Breakfast?",
  );

  const archived = await admin.query(api.chatKnowledge.adminListAnswers, {
    status: "archived",
    search: "breakfast",
    paginationOpts: firstPage(),
  });
  expect(archived.page).toEqual([]);
});
