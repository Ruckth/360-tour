// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { asTestOwner } from "./testing/staff.test-support";

const modules = import.meta.glob("./**/*.ts");
type Fields = { inboxState?: "needs_staff" | "processing" | "done"; adminStatus?: "resolved" | "archived"; messageCount?: number };

async function seed(t: ReturnType<typeof convexTest>, rows: Fields[]) {
  await t.run(async (ctx) => {
    let at = 1_700_000_000_000;
    for (const row of rows) {
      at += 1000;
      await ctx.db.insert("conversations", {
        channel: "web", visitorId: `v-${at}`, lastSeenAt: at, lastOpenedAt: at, createdAt: at, adminSortAt: at, ...(row.messageCount === 0 ? {} : { latestMessageAt: at }),
        lastActivityAt: at, inboxProjectionVersion: 1, messageCount: row.messageCount ?? 2,
        ...(row.inboxState ? { inboxState: row.inboxState } : {}), ...(row.adminStatus ? { adminStatus: row.adminStatus } : {}),
      });
    }
  });
}

describe("adminChat.queueCounts (D02)", () => {
  it("counts the Needs you queue with its own predicates, across pages", async () => {
    const t = convexTest(schema, modules);
    const owner = await asTestOwner(t, { emailVerified: true, email: "admin@example.com", tokenIdentifier: "admin" });
    await seed(t, [
      ...Array.from({ length: 12 }, () => ({ inboxState: "needs_staff" as const })),
      { inboxState: "needs_staff", adminStatus: "archived" },
      { inboxState: "needs_staff", messageCount: 0 },
      { inboxState: "processing" },
      { inboxState: "done" },
    ]);
    expect(await owner.query(api.messaging.adminChat.queueCounts, {})).toMatchObject({ waiting: 12 });
    // The queue's first page holds fewer rows than the total; the badge doesn't depend on paging.
    const page = await owner.query(api.messaging.adminChat.listSessions, { status: "needs_reply", adminStatus: "open", paginationOpts: { numItems: 10, cursor: null } });
    expect(page.sessions.length).toBeLessThan(12);
  });

  it("saturates at 99+ and denies people without operations access", async () => {
    const t = convexTest(schema, modules);
    const owner = await asTestOwner(t, { emailVerified: true, email: "admin@example.com", tokenIdentifier: "admin" });
    await seed(t, Array.from({ length: 101 }, () => ({ inboxState: "needs_staff" as const })));
    expect(await owner.query(api.messaging.adminChat.queueCounts, {})).toMatchObject({ waiting: 100 });
    await expect(t.query(api.messaging.adminChat.queueCounts, {})).rejects.toThrow("Not authenticated");
    await expect(t.withIdentity({ emailVerified: true, email: "x@example.com", tokenIdentifier: "x" }).query(api.messaging.adminChat.queueCounts, {})).rejects.toThrow("Not authorized");
  });

  it("returns null while the inbox projection is initializing", async () => {
    const t = convexTest(schema, modules);
    const owner = await asTestOwner(t, { emailVerified: true, email: "admin@example.com", tokenIdentifier: "admin" });
    await t.run((ctx) => ctx.db.insert("conversations", { channel: "web", visitorId: "legacy", lastSeenAt: 1, lastOpenedAt: 1, createdAt: 1 }));
    expect(await owner.query(api.messaging.adminChat.queueCounts, {})).toBeNull();
  });
});
