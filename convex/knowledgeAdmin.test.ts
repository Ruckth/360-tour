// @vitest-environment edge-runtime
// The legacy answer/question/curated authoring workflow is retired: every writer refuses (after
// auth), permanent deletes refuse, but unknown-question review, archival, and the read-only
// archive/list queries stay available.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";
const firstPage = (numItems = 50) => ({ numItems, cursor: null });

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", adminEmail));
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const t = convexTest(schema, modules);
  return { t, admin: t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" }) };
}

async function createSession(t: ReturnType<typeof convexTest>, channel: "web" | "line" = "web") {
  return await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      channel,
      visitorId: `${channel}-${Math.random()}`,
      currentPath: "/",
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    }),
  );
}


describe("unknown-question review stays available", () => {

  it("paginates and searches unknown questions by status", async () => {
    const { t, admin } = setup();
    const sessionId = await createSession(t);
    for (const question of ["Is there parking?", "Can I park a bus?", "Do you have a gym?"]) {
      await t.mutation(internal.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: question });
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
});

describe("grouped unknown questions", () => {

  it("bounds Ignore and Reopen across groups and rejects oversized Undo lists", async () => {
    const { t, admin } = setup();
    const keys = Array.from({ length: 100 }, (_, index) => `report-${index}`);
    await t.run(async (ctx) => {
      for (const key of keys) {
        for (let index = 0; index < 3; index += 1) {
          await ctx.db.insert("chatUnknownQuestions", {
            userQuestion: key, normalizedQuestion: key, status: "new", adminNotified: false,
            createdAt: index, updatedAt: index,
          });
        }
      }
    });
    const args = { normalizedQuestions: keys };
    const first = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, args);
    expect(first).toMatchObject({ ignored: 100, remaining: 100, hasMore: true, remainingIsLowerBound: true });
    expect(first.unknownQuestionIds).toHaveLength(100);
    await expect(admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, {
      unknownQuestionIds: [...first.unknownQuestionIds, first.unknownQuestionIds[0]],
    })).rejects.toThrow("Reopen 100 or fewer report IDs");
    // Validation does not partially apply an oversized Undo, even when the extra ID is a duplicate.
    const untouched = await t.run(async (ctx) => Promise.all(first.unknownQuestionIds.map(id => ctx.db.get(id))));
    expect(untouched.every(row => row?.status === "ignored")).toBe(true);

    const second = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, args);
    expect(second).toMatchObject({ ignored: 100, remaining: 100, hasMore: true, remainingIsLowerBound: false });
    const last = await admin.mutation(api.chatKnowledge.adminIgnoreUnknownGroups, args);
    expect(last).toMatchObject({ ignored: 100, remaining: 0, hasMore: false, remainingIsLowerBound: false });

    // Combining explicit Undo IDs with whole groups still shares one budget and never double-counts.
    const reopened = await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, {
      ...args, unknownQuestionIds: [first.unknownQuestionIds[0]],
    });
    expect(reopened).toEqual({ reopened: 100, remaining: 100, hasMore: true, remainingIsLowerBound: true });
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, args))
      .toEqual({ reopened: 100, remaining: 100, hasMore: true, remainingIsLowerBound: false });
    expect(await admin.mutation(api.chatKnowledge.adminReopenUnknownGroups, args))
      .toEqual({ reopened: 100, remaining: 0, hasMore: false, remainingIsLowerBound: false });
  });
});
