// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
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
const RETIRED = "Saved answers and Q&A are retired. Maintain Business facts instead.";

function adminTest(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
}

async function createProperty(t: ReturnType<typeof convexTest>, slug = "pool-villa") {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("properties", {
      slug,
      name: slug === "pool-villa" ? "Pool Villa" : "Garden Villa",
      tagline: "Private stay",
      description: "A private villa for testing.",
      pricePerNight: 8500,
      currency: "THB",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      area: 180,
      images: [],
      amenities: ["Private Pool", "WiFi"],
      tourRoomIds: [],
      directDiscountPercent: 15,
      status: "active",
    });
  });
}

async function createWebSession(
  t: ReturnType<typeof convexTest>,
  args: { propertyId?: string; propertySlug?: string } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      propertyId: args.propertyId as never,
      propertySlug: args.propertySlug,
      channel: "web",
      visitorId: `web-test-${Date.now()}-${Math.random()}`,
      currentPath: args.propertySlug ? `/rooms/${args.propertySlug}` : "/",
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}

/** Insert a historical approved answer + primary question directly, as if it predates retirement. */
async function seedHistoricalAnswer(
  t: ReturnType<typeof convexTest>,
  args: {
    title: string;
    answer: string;
    question: string;
    propertyId?: Id<"properties">;
    propertySlug?: string;
    status?: "approved" | "draft" | "archived";
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const answerId = await ctx.db.insert("chatAnswers", {
      propertyId: args.propertyId,
      title: args.title,
      answer: args.answer,
      status: args.status ?? "approved",
      createdAt: now,
      updatedAt: now,
      createdByAdminEmail: adminEmail,
      updatedByAdminEmail: adminEmail,
    });
    const questionId = await ctx.db.insert("chatQuestions", {
      propertyId: args.propertyId,
      answerId,
      questionText: args.question,
      normalizedQuestion: args.question.trim().toLowerCase().replace(/[\s?!.]+/g, " ").trim(),
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
    if (args.propertySlug) {
      await ctx.db.insert("chatAnswerPropertyScopes", {
        propertyId: args.propertyId,
        answerId,
        propertySlug: args.propertySlug,
        normalizedSlug: args.propertySlug,
        source: args.propertyId ? "property" : "custom",
        createdAt: now,
        updatedAt: now,
        createdByAdminEmail: adminEmail,
        updatedByAdminEmail: adminEmail,
      });
    }
    return { answerId, questionId };
  });
}

describe("legacy saved-answer readers are retired", () => {
  it("resolveExact never answers from historical approved rows", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await createProperty(t, "pool-villa");
    await seedHistoricalAnswer(t, {
      title: "Pool villa smoking policy",
      answer: "At Pool Villa, smoking is only allowed beside the garden gate.",
      question: "Can I smoke on the balcony?",
      propertyId,
      propertySlug: "pool-villa",
    });
    await seedHistoricalAnswer(t, {
      title: "Global smoking policy",
      answer: "Smoking is allowed only in the designated outdoor area.",
      question: "Can I smoke on the balcony?",
    });
    const propertySession = await createWebSession(t, { propertyId, propertySlug: "pool-villa" });
    const globalSession = await createWebSession(t);

    expect(
      await t.query(api.chatKnowledge.resolveExact, {
        sessionId: propertySession,
        messageText: " CAN I smoke on the balcony?! ",
      }),
    ).toBeNull();
    expect(
      await t.query(api.chatKnowledge.resolveExact, {
        sessionId: globalSession,
        messageText: "can i smoke on the balcony",
      }),
    ).toBeNull();
  });

  it("getApprovedContext returns no approved prose for the concierge prompt", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await createProperty(t, "pool-villa");
    await createProperty(t, "garden-villa");
    await seedHistoricalAnswer(t, { title: "General policy", answer: "Breakfast is available.", question: "Is breakfast available?" });
    await seedHistoricalAnswer(t, { title: "Pool feature", answer: "This villa has a private pool.", question: "Does it have a private pool?", propertyId, propertySlug: "pool-villa" });
    const sessionId = await createWebSession(t, { propertyId, propertySlug: "pool-villa" });

    const context = await t.query(internal.chatKnowledge.getApprovedContext, { sessionId });
    expect(context).toEqual([]);
  });

  it("ignores draft and archived historical rows too", async () => {
    const t = convexTest(schema, modules);
    await seedHistoricalAnswer(t, {
      title: "Archived pets policy",
      answer: "Pets are approved in this archived answer.",
      question: "Can I bring my dog?",
      status: "archived",
    });
    const sessionId = await createWebSession(t);
    expect(
      await t.query(api.chatKnowledge.resolveExact, { sessionId, messageText: "Can I bring my dog?" }),
    ).toBeNull();
  });
});

describe("legacy saved-answer writers refuse", () => {
  it("requires admin identity BEFORE the retirement error", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      // Unauthenticated callers get the auth error, not the retirement error.
      await expect(
        t.mutation(api.chatKnowledge.adminCreateAnswer, {
          title: "Parking",
          answer: "Parking is available.",
          primaryQuestion: "Do you have parking?",
        }),
      ).rejects.toThrow("Not authenticated");
      // Authenticated admins get the retirement refusal.
      await expect(
        adminTest(t).mutation(api.chatKnowledge.adminCreateAnswer, {
          title: "Parking",
          answer: "Parking is available.",
          primaryQuestion: "Do you have parking?",
        }),
      ).rejects.toThrow(RETIRED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses create, update, link, approve, variant generation and property-scope creation", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const propertyId = await createProperty(t, "pool-villa");
      const { answerId, questionId } = await seedHistoricalAnswer(t, {
        title: "Pets",
        answer: "Pets are welcome.",
        question: "Are pets allowed?",
        propertyId,
      });
      const sessionId = await createWebSession(t);
      const unknownQuestionId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
        sessionId,
        userQuestion: "May I bring my dog?",
      });

      await expect(
        admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
          answerId,
          title: "Pets",
          answer: "Pets are welcome.",
          status: "approved",
          primaryQuestion: "Are pets allowed?",
          topicNames: [],
        }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.action(api.chatKnowledge.adminCreateAnswerFromUnknown, {
          unknownQuestionId,
          title: "Late check-in",
          answer: "Late check-in may be possible.",
        }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, { unknownQuestionId, answerId, generateSimilar: false }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.action(api.chatKnowledge.adminGenerateSimilarQuestions, { answerId }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.mutation(api.chatKnowledge.adminApproveQuestion, { questionId, isPrimary: true }),
      ).rejects.toThrow(RETIRED);
      await expect(
        admin.mutation(api.chatKnowledge.adminCreatePropertyScope, { slug: "Special Villa" }),
      ).rejects.toThrow(RETIRED);

      // The internal worker no-ops rather than throwing (it may have been queued before retirement).
      const stored = await t.mutation(internal.chatKnowledge.storeSuggestedQuestions, {
        answerId,
        questions: ["Any dogs allowed?"],
        adminEmail,
      });
      expect(stored).toEqual({ insertedQuestionIds: [] });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses permanent deletes of legacy read-only archives", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const { answerId, questionId } = await seedHistoricalAnswer(t, {
        title: "Archived",
        answer: "Archived answer.",
        question: "Old question?",
        status: "archived",
      });

      await expect(admin.mutation(api.chatKnowledge.adminDeleteAnswer, { answerId })).rejects.toThrow(RETIRED);
      await expect(admin.mutation(api.chatKnowledge.adminDeleteQuestion, { questionId })).rejects.toThrow(RETIRED);
      // Rows remain for the archive view.
      expect(await t.run((ctx) => ctx.db.get(answerId))).not.toBeNull();
      expect(await t.run((ctx) => ctx.db.get(questionId))).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still archives answers in bulk (archival stays allowed), but refuses restore", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const { answerId } = await seedHistoricalAnswer(t, { title: "A", answer: "a", question: "a?" });
      const result = await admin.mutation(api.chatKnowledge.adminSetAnswersStatus, {
        answerIds: [answerId],
        status: "archived",
      });
      expect(result.changed).toHaveLength(1);
      expect(await t.run((ctx) => ctx.db.get(answerId))).toMatchObject({ status: "archived" });
      // Restoring back to approved is a retired write.
      await expect(
        admin.mutation(api.chatKnowledge.adminSetAnswersStatus, { answerIds: [answerId], status: "approved" }),
      ).rejects.toThrow(RETIRED);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("read-only legacy archive queries stay available", () => {
  it("lists historical answers for the archive view", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await seedHistoricalAnswer(t, { title: "General policy", answer: "Breakfast is available.", question: "Is breakfast available?" });

      const page = await admin
        .query(api.chatKnowledge.adminListAnswers, { paginationOpts: { numItems: 50, cursor: null } })
        .then((result) => result.page);
      expect(page.map((row) => row.title)).toContain("General policy");

      // Non-admins cannot read the archive.
      await expect(
        t.query(api.chatKnowledge.adminListAnswers, { paginationOpts: { numItems: 50, cursor: null } }),
      ).rejects.toThrow("Not authenticated");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("unknown-question loop is preserved", () => {
  it("records unknown questions and returns the safe fallback from chatAi.respond", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_API_BASE_URL", "https://ai.example.test/v1");
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await createWebSession(t);
      // The concierge found no supporting facts and returned the unknown sentinel.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "[[UNKNOWN]]" } }] }), { status: 200 }),
        ),
      );

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Can I bring two cats?",
      });
      const unknownRows = await admin
        .query(api.chatKnowledge.adminListUnknownQuestions, {
          status: "new",
          paginationOpts: { numItems: 50, cursor: null },
        })
        .then((result) => result.page);

      expect(result).toMatchObject({
        model: "unknown_fallback",
        response: "I do not have verified information about that yet. Please contact the host here for help.",
      });
      expect(unknownRows).toHaveLength(1);
      expect(unknownRows[0]).toMatchObject({ userQuestion: "Can I bring two cats?", status: "new" });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("ignores and reopens unknown-question groups without recreating saved answers", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await createWebSession(t);
      await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "Can I bring my dog?" });

      const normalized = "can i bring my dog";
      const ignored = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, { normalizedQuestions: [normalized] });
      expect(ignored.ignored).toBe(1);
      const reopened = await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, { normalizedQuestions: [normalized] });
      expect(reopened.reopened).toBe(1);

      // Linking a group to an answer is a retired write.
      const { answerId } = await seedHistoricalAnswer(t, { title: "Pets", answer: "Pets are welcome.", question: "Are pets allowed?" });
      await expect(
        admin.mutation(api.chatKnowledge.adminLinkUnknownGroups, { normalizedQuestions: [normalized], answerId }),
      ).rejects.toThrow(RETIRED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reopen clears a historical answer resolution link", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await createWebSession(t);
      const unknownQuestionId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
        sessionId,
        userQuestion: "Historic resolved question?",
      });
      // A historical resolution that pointed at a saved answer.
      const { answerId } = await seedHistoricalAnswer(t, { title: "X", answer: "x", question: "x?" });
      await t.run((ctx) =>
        ctx.db.patch(unknownQuestionId, {
          status: "resolved",
          resolvedAnswerId: answerId,
          resolvedAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );

      await admin.mutation(api.chatKnowledge.adminReopenUnknown, { unknownQuestionId });
      const row = await t.run((ctx) => ctx.db.get(unknownQuestionId));
      expect(row).toMatchObject({ status: "new" });
      expect(row?.resolvedAnswerId).toBeUndefined();
      expect(row?.resolvedFactId).toBeUndefined();
      expect(row?.resolvedSource).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("reality guardrail stays ahead of any historical answer", () => {
  it("keeps the reality guardrail ahead of historical approved rows", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      await seedHistoricalAnswer(t, {
        title: "Reality answer",
        answer: "Yes, this is a verified real-world resort.",
        question: "Is Auralis Cove a real luxury villa resort?",
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
