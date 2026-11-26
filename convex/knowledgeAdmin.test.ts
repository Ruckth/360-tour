// @vitest-environment edge-runtime
// The legacy answer/question/curated authoring workflow is retired: every writer refuses (after
// auth), permanent deletes refuse, but unknown-question review, archival, and the read-only
// archive/list queries stay available.

import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";

async function setup() {
  const t = convexTest(schema, modules);
  return { t, admin: await asTestOwner(t, { emailVerified: true, email: adminEmail, tokenIdentifier: "admin-token" }) };
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

  it("groups and searches unknown questions by status", async () => {
    const { t, admin } = await setup();
    const sessionId = await createSession(t);
    for (const question of ["Is there parking?", "Can I park a bus?", "Do you have a gym?", "Do you have a gym?"]) {
      // Distinct sessions preserve separate reports in the same normalized group.
      await t.mutation(internal.concierge.knowledge.recordUnknownQuestion, { sessionId: question.includes("gym") ? await createSession(t) : sessionId, userQuestion: question });
    }

    const result = await admin.query(api.concierge.knowledge.adminListUnknownGroups, { status: "new" });
    expect(result.truncated).toBe(false);
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]).toMatchObject({ normalizedQuestion: "do you have a gym", count: 2, counts: { new: 2, ignored: 0, resolved: 0 } });
    expect(result.groups.flatMap(group => group.channels)).toEqual(["web", "web", "web"]);

    const gym = await admin.query(api.concierge.knowledge.adminListUnknownGroups, { status: "new", search: "gym" });
    expect(gym.groups.map(group => group.latest.userQuestion)).toEqual(["Do you have a gym?"]);
    const args = { normalizedQuestions: [gym.groups[0].normalizedQuestion] };
    expect(await admin.mutation(api.concierge.knowledge.adminIgnoreUnknownGroups, args)).toMatchObject({ ignored: 2 });
    expect((await admin.query(api.concierge.knowledge.adminListUnknownGroups, { status: "new", search: "gym" })).groups).toEqual([]);
    expect((await admin.query(api.concierge.knowledge.adminListUnknownGroups, { status: "ignored", search: "gym" })).groups[0]).toMatchObject({ count: 2, counts: { ignored: 2, new: 0, resolved: 0 } });
    expect(await admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, args)).toMatchObject({ reopened: 2 });
    expect((await admin.query(api.concierge.knowledge.adminListUnknownGroups, { status: "new", search: "gym" })).groups[0].count).toBe(2);
  });
});

describe("grouped unknown questions", () => {

  it("bounds Ignore and Reopen across groups and rejects oversized Undo lists", async () => {
    const { t, admin } = await setup();
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
    const first = await admin.mutation(api.concierge.knowledge.adminIgnoreUnknownGroups, args);
    expect(first).toMatchObject({ ignored: 100, remaining: 100, hasMore: true, remainingIsLowerBound: true });
    expect(first.unknownQuestionIds).toHaveLength(100);
    await expect(admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, {
      unknownQuestionIds: [...first.unknownQuestionIds, first.unknownQuestionIds[0]],
    })).rejects.toThrow("Reopen 100 or fewer report IDs");
    // Validation does not partially apply an oversized Undo, even when the extra ID is a duplicate.
    const untouched = await t.run(async (ctx) => Promise.all(first.unknownQuestionIds.map(id => ctx.db.get(id))));
    expect(untouched.every(row => row?.status === "ignored")).toBe(true);

    const second = await admin.mutation(api.concierge.knowledge.adminIgnoreUnknownGroups, args);
    expect(second).toMatchObject({ ignored: 100, remaining: 100, hasMore: true, remainingIsLowerBound: false });
    const last = await admin.mutation(api.concierge.knowledge.adminIgnoreUnknownGroups, args);
    expect(last).toMatchObject({ ignored: 100, remaining: 0, hasMore: false, remainingIsLowerBound: false });

    // Combining explicit Undo IDs with whole groups still shares one budget and never double-counts.
    const reopened = await admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, {
      ...args, unknownQuestionIds: [first.unknownQuestionIds[0]],
    });
    expect(reopened).toEqual({ reopened: 100, remaining: 100, hasMore: true, remainingIsLowerBound: true });
    expect(await admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, args))
      .toEqual({ reopened: 100, remaining: 100, hasMore: true, remainingIsLowerBound: false });
    expect(await admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, args))
      .toEqual({ reopened: 100, remaining: 0, hasMore: false, remainingIsLowerBound: false });
  });
});
