// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
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

describe("chatKnowledge approved exact matching", () => {
  it("reuses an approved question and clears stale unknown references when it is removed", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const answerId = await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Pets", answer: "Pets are welcome.", primaryQuestion: "Are pets allowed?",
      });
      const sessionId = await createWebSession(t);
      const firstUnknown = await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: "May I bring my dog?" });
      const secondUnknown = await t.run(async ctx => ctx.db.insert("chatUnknownQuestions", {
        sessionId, userQuestion: "MAY I BRING MY DOG", normalizedQuestion: "may i bring my dog",
        status: "new", adminNotified: false, createdAt: Date.now(), updatedAt: Date.now(),
      }));
      const first = await t.mutation(internal.chatKnowledge.resolveUnknownWithAnswer, { unknownQuestionId: firstUnknown, answerId, adminEmail });
      const second = await t.mutation(internal.chatKnowledge.resolveUnknownWithAnswer, { unknownQuestionId: secondUnknown, answerId, adminEmail });
      expect(second.questionId).toBe(first.questionId);
      expect((await t.run(async ctx => ctx.db.query("chatQuestions").withIndex("by_answerId", q => q.eq("answerId", answerId)).collect())).length).toBe(2);

      await admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
        answerId, title: "Pets", answer: "Pets are welcome.", status: "approved", primaryQuestion: "Are pets allowed?", questions: [],
      });
      expect(await t.run(ctx => ctx.db.get(first.questionId))).toBeNull();
      for (const id of [firstUnknown, secondUnknown]) {
        expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ resolvedAnswerId: answerId, status: "resolved" });
        expect((await t.run(ctx => ctx.db.get(id)))?.resolvedQuestionId).toBeUndefined();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("normalizes exact questions and prefers property-specific answers", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const propertyId = await createProperty(t, "pool-villa");

      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Global smoking policy",
        answer: "Smoking is allowed only in the designated outdoor area.",
        primaryQuestion: "Can I smoke on the balcony?",
        topicNames: ["house_rules"],
      });
      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        propertySlug: "pool-villa",
        title: "Pool villa smoking policy",
        answer: "At Pool Villa, smoking is only allowed beside the garden gate.",
        primaryQuestion: "Can I smoke on the balcony?",
        topicNames: ["house_rules"],
      });

      const propertySessionId = await createWebSession(t, {
        propertyId,
        propertySlug: "pool-villa",
      });
      const globalSessionId = await createWebSession(t);

      const propertyMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: propertySessionId,
        messageText: " CAN I smoke on the balcony?! ",
      });
      const globalMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: globalSessionId,
        messageText: "can i smoke on the balcony",
      });

      expect(propertyMatch).toMatchObject({
        source: "approved_exact",
        answer: "At Pool Villa, smoking is only allowed beside the garden gate.",
      });
      expect(globalMatch).toMatchObject({
        source: "approved_exact",
        answer: "Smoking is allowed only in the designated outdoor area.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("matches one approved answer across multiple property scopes", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const poolPropertyId = await createProperty(t, "pool-villa");
      const gardenPropertyId = await createProperty(t, "garden-suite");

      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Breakfast for selected villas",
        answer: "Breakfast is included for Pool Villa and Garden Suite bookings.",
        primaryQuestion: "Is breakfast included?",
        propertySlugs: ["pool-villa", "garden-suite"],
        topicNames: ["food"],
      });
      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Global breakfast",
        answer: "Breakfast depends on your package.",
        primaryQuestion: "Is breakfast included?",
        topicNames: ["food"],
      });

      const poolSessionId = await createWebSession(t, {
        propertyId: poolPropertyId,
        propertySlug: "pool-villa",
      });
      const gardenSessionId = await createWebSession(t, {
        propertyId: gardenPropertyId,
        propertySlug: "garden-suite",
      });
      const globalSessionId = await createWebSession(t);

      const poolMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: poolSessionId,
        messageText: "Is breakfast included?",
      });
      const gardenMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: gardenSessionId,
        messageText: "Is breakfast included?",
      });
      const globalMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: globalSessionId,
        messageText: "Is breakfast included?",
      });

      expect(poolMatch?.answer).toBe("Breakfast is included for Pool Villa and Garden Suite bookings.");
      expect(gardenMatch?.answer).toBe("Breakfast is included for Pool Villa and Garden Suite bookings.");
      expect(globalMatch?.answer).toBe("Breakfast depends on your package.");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets admins add custom property scopes but blocks deletion while linked", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);

      const createdScope = await admin.mutation(api.chatKnowledge.adminCreatePropertyScope, {
        slug: "Special Villa",
      });
      expect(createdScope).toMatchObject({
        slug: "special-villa",
        source: "custom",
        canDelete: true,
      });
      await admin.mutation(api.chatKnowledge.adminDeletePropertyScope, {
        slug: "special-villa",
      });

      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Special villa parking",
        answer: "Special Villa includes one private parking space.",
        primaryQuestion: "Is parking included?",
        propertySlugs: ["special-villa"],
      });
      const scopes = await admin.query(api.chatKnowledge.adminListPropertyScopes, {});
      const linkedScope = scopes.find((scope) => scope.slug === "special-villa");
      const customSessionId = await createWebSession(t, { propertySlug: "special-villa" });
      const customMatch = await t.query(api.chatKnowledge.resolveExact, {
        sessionId: customSessionId,
        messageText: "Is parking included?",
      });

      expect(linkedScope).toMatchObject({ canDelete: false });
      expect(customMatch?.answer).toBe("Special Villa includes one private parking space.");
      await expect(
        admin.mutation(api.chatKnowledge.adminDeletePropertyScope, {
          slug: "special-villa",
        }),
      ).rejects.toThrow(/linked to an answer/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("excludes draft and archived answers from exact replies", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const draftAnswerId = await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Draft pets policy",
        answer: "Pets are approved in this draft.",
        status: "draft",
        primaryQuestion: "Can I bring my dog?",
      });
      await admin.mutation(api.chatKnowledge.adminUpdateAnswer, {
        answerId: draftAnswerId,
        title: "Archived pets policy",
        answer: "Pets are approved in this archived answer.",
        status: "archived",
        topicNames: [],
      });
      const sessionId = await createWebSession(t);

      const match = await t.query(api.chatKnowledge.resolveExact, {
        sessionId,
        messageText: "Can I bring my dog?",
      });

      expect(match).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("chatKnowledge unknown-question loop", () => {
  it("records unknown questions and returns the safe fallback from chatAi.respond", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await createWebSession(t);

      const result = await t.action(api.chatAi.respond, {
        sessionId,
        userMessage: "Can I bring two cats?",
      });
      const unknownRows = await admin.query(api.chatKnowledge.adminListUnknownQuestions, {
        status: "new",
        paginationOpts: { numItems: 50, cursor: null },
      }).then((result) => result.page);

      expect(result).toMatchObject({
        model: "unknown_fallback",
        response: "I'm not fully sure about that yet. I'll ask the team and get back to you shortly.",
      });
      expect(unknownRows).toHaveLength(1);
      expect(unknownRows[0]).toMatchObject({
        userQuestion: "Can I bring two cats?",
        status: "new",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("creates suggested variants from an unknown question without auto-approving them", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await createWebSession(t);
      const unknownQuestionId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
        sessionId,
        userQuestion: "Can I check in at 1 AM?",
        detectedTopic: "check_in",
      });

      const created = await admin.action(api.chatKnowledge.adminCreateAnswerFromUnknown, {
        unknownQuestionId,
        title: "Late check-in",
        answer: "Late check-in may be possible by prior arrangement with the team.",
        topicNames: ["check_in"],
      });
      const answers = await admin.query(api.chatKnowledge.adminListAnswers, {
        status: "approved",
        paginationOpts: { numItems: 50, cursor: null },
      }).then((result) => result.page);
      const answer = answers.find((row) => row._id === created.answerId);

      expect(answer).toBeTruthy();
      expect(answer?.questions.some((question) => question.status === "approved")).toBe(true);
      const suggested = answer?.questions.filter((question) => question.status === "suggested") ?? [];
      expect(suggested.length).toBeGreaterThan(0);
      expect(suggested.every((question) => question.createdBy === "ai")).toBe(true);
      expect(suggested.every((question) => !question.isAiTrigger)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("links an unknown question to an existing answer for the next exact match", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const answerId = await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Pets policy",
        answer: "Pets are not allowed at this property.",
        primaryQuestion: "Are pets allowed?",
        topicNames: ["pets"],
      });
      const sessionId = await createWebSession(t);
      const unknownQuestionId = await t.mutation(api.chatKnowledge.recordUnknownQuestion, {
        sessionId,
        userQuestion: "Can I bring my dog?",
      });

      await admin.action(api.chatKnowledge.adminResolveUnknownWithAnswer, {
        unknownQuestionId,
        answerId,
        generateSimilar: false,
      });
      const match = await t.query(api.chatKnowledge.resolveExact, {
        sessionId,
        messageText: "Can I bring my dog?",
      });

      expect(match).toMatchObject({
        answer: "Pets are not allowed at this property.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("chatKnowledge admin authorization and guardrails", () => {
  it("requires admin identity for knowledge mutations", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);

      await expect(
        t.mutation(api.chatKnowledge.adminCreateAnswer, {
          title: "Parking",
          answer: "Parking is available.",
          primaryQuestion: "Do you have parking?",
        }),
      ).rejects.toThrow("Not authenticated");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the reality guardrail ahead of approved knowledge answers", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      await admin.mutation(api.chatKnowledge.adminCreateAnswer, {
        title: "Reality answer",
        answer: "Yes, this is a verified real-world resort.",
        primaryQuestion: "Is Auralis Cove a real luxury villa resort?",
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
