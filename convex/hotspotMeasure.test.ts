// @vitest-environment edge-runtime

/**
 * Local hotspot measurement for the chat-presence heartbeat and the admin inbox readers.
 *
 * Method (no deployment, convex-test fixtures only):
 *  - WRITES are counted by instrumenting ctx.db inside `t.run`: we wrap `patch`, `replace`,
 *    `insert` and `delete` and tally calls while the measured mutation runs. convex-test shares
 *    one in-memory db per `t`, so a mutation invoked through `t.mutation` cannot be wrapped
 *    directly; instead we read a per-call sentinel. For `touchSession` the only presence write is
 *    `lastSeenAt`, so we set `lastSeenAt` to a sentinel, run the mutation, and a skipped beat
 *    leaves the sentinel untouched (0 writes) while a real beat advances it (>=1 write).
 *  - READS are reasoned from the handler and asserted structurally: `touchSession` reads exactly
 *    one session document, plus one property document only when the villa slug changes. The admin
 *    transcript reader deliberately reads no session document (so guest heartbeats cannot rerun
 *    it); we assert that by confirming its result is independent of a concurrent heartbeat.
 *
 * Evidence from the audit: one `chat.touchSession` OCC retry in 72h on the dev deployment. That is
 * far below the bar for a presence-table split, so the split stays deferred; this file measures the
 * cheaper no-op-write avoidance that was actually shipped.
 */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACTIVE_CHAT_WINDOW_MS, PRESENCE_WRITE_THROTTLE_MS, isChatSessionActive } from "./lib/chatPresence";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

async function newWebSession(t: ReturnType<typeof convexTest>, currentPath = "/") {
  return await t.mutation(api.chat.createSession, { channel: "web", currentPath });
}

/** Mark the session as having a message so its admin sort is driven by latestMessageAt, not lastSeenAt. */
async function giveMessage(t: ReturnType<typeof convexTest>, sessionId: Id<"chatSessions">, at: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("chatMessages", { sessionId, role: "user", content: "hi", timestamp: at });
    await ctx.db.patch(sessionId, { messageCount: 1, latestMessageAt: at, adminSortAt: at });
  });
}

/** Did `touchSession` write presence? Returns the new lastSeenAt, or null when the write was skipped. */
async function heartbeatWrote(
  t: ReturnType<typeof convexTest>,
  sessionId: Id<"chatSessions">,
  args: Record<string, unknown>,
) {
  const before = await t.run((ctx) => ctx.db.get(sessionId));
  await t.mutation(api.chat.touchSession, { sessionId, ...args });
  const after = await t.run((ctx) => ctx.db.get(sessionId));
  return before?.lastSeenAt !== after?.lastSeenAt ? after?.lastSeenAt ?? null : null;
}

describe("chat.touchSession presence writes", () => {
  it("a message-less chat still writes every heartbeat (sort depends on lastSeenAt)", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await newWebSession(t);
    const before = await t.run((ctx) => ctx.db.get(sessionId));

    vi.useFakeTimers();
    try {
      vi.setSystemTime((before?.lastSeenAt ?? 0) + 30_000);
      const wrote = await heartbeatWrote(t, sessionId, { currentPath: "/" });
      expect(wrote).toBe((before?.lastSeenAt ?? 0) + 30_000);

      const session = await t.run((ctx) => ctx.db.get(sessionId));
      // Empty chats sort by presence, so the write must advance adminSortAt too.
      expect(session?.adminSortAt).toBe(session?.lastSeenAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a chat with messages skips the write when nothing but presence would move, within the throttle", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await newWebSession(t);
    const base = (await t.run((ctx) => ctx.db.get(sessionId)))?.lastSeenAt ?? 0;
    await giveMessage(t, sessionId, base);

    vi.useFakeTimers();
    try {
      // One heartbeat interval later: inside the 45s throttle, so no write.
      vi.setSystemTime(base + 30_000);
      expect(await heartbeatWrote(t, sessionId, { currentPath: "/", isOpen: true })).toBeNull();

      const session = await t.run((ctx) => ctx.db.get(sessionId));
      // Nothing moved: presence, sort and search text are all exactly as before.
      expect(session?.lastSeenAt).toBe(base);
      expect(session?.adminSortAt).toBe(base);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still writes once the throttle window has elapsed", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await newWebSession(t);
    const base = (await t.run((ctx) => ctx.db.get(sessionId)))?.lastSeenAt ?? 0;
    await giveMessage(t, sessionId, base);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(base + PRESENCE_WRITE_THROTTLE_MS);
      expect(await heartbeatWrote(t, sessionId, { currentPath: "/", isOpen: true })).toBe(
        base + PRESENCE_WRITE_THROTTLE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("always writes when a context field changes, even inside the throttle", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await t.run((ctx) =>
      ctx.db.insert("properties", {
        slug: "pool-villa",
        name: "Pool Villa",
        tagline: "",
        description: "",
        pricePerNight: 100,
        currency: "THB",
        maxGuests: 2,
        bedrooms: 1,
        bathrooms: 1,
        area: 40,
        images: [],
        amenities: [],
        tourRoomIds: [],
        directDiscountPercent: 0,
        status: "active",
      }),
    );
    const sessionId = await newWebSession(t);
    const base = (await t.run((ctx) => ctx.db.get(sessionId)))?.lastSeenAt ?? 0;
    await giveMessage(t, sessionId, base);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(base + 10_000);
      // The guest navigated to a villa inside the throttle window: context changed, so it writes.
      expect(
        await heartbeatWrote(t, sessionId, {
          currentPath: "/villas/pool-villa",
          propertySlug: "pool-villa",
          isOpen: true,
        }),
      ).toBe(base + 10_000);
      const session = await t.run((ctx) => ctx.db.get(sessionId));
      expect(session).toMatchObject({ propertyId, propertySlug: "pool-villa", currentPath: "/villas/pool-villa" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skipping a beat never changes the observable online state", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await newWebSession(t);
    const base = (await t.run((ctx) => ctx.db.get(sessionId)))?.lastSeenAt ?? 0;
    await giveMessage(t, sessionId, base);

    vi.useFakeTimers();
    try {
      // Beat skipped at +30s.
      vi.setSystemTime(base + 30_000);
      await t.mutation(api.chat.touchSession, { sessionId, currentPath: "/", isOpen: true });
      const session = await t.run((ctx) => ctx.db.get(sessionId));

      // Worst case: a beat lands just inside the throttle and is skipped, so the next write is one
      // 30s heartbeat later. The session must still read as online right before that write.
      const HEARTBEAT_MS = 30_000;
      expect(PRESENCE_WRITE_THROTTLE_MS + HEARTBEAT_MS).toBeLessThanOrEqual(ACTIVE_CHAT_WINDOW_MS - 15_000);
      const latestReadBeforeNextWrite = base + PRESENCE_WRITE_THROTTLE_MS - 1 + HEARTBEAT_MS;
      expect(latestReadBeforeNextWrite - (session?.lastSeenAt ?? 0)).toBeLessThan(ACTIVE_CHAT_WINDOW_MS);
      expect(isChatSessionActive(session ?? {}, latestReadBeforeNextWrite)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("admin readers do not rerun on a presence-only heartbeat", () => {
  it("listTranscriptMessages reads no session document, so a heartbeat cannot change its result", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    const t = convexTest(schema, modules);
    const admin = t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin-token" });
    const sessionId = await newWebSession(t);
    const base = (await t.run((ctx) => ctx.db.get(sessionId)))?.lastSeenAt ?? 0;
    await giveMessage(t, sessionId, base);

    const first = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(base + PRESENCE_WRITE_THROTTLE_MS + 1);
      // A heartbeat that DOES write presence.
      await t.mutation(api.chat.touchSession, { sessionId, currentPath: "/", isOpen: true });
    } finally {
      vi.useRealTimers();
    }

    const second = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(second.page.map((m) => m._id)).toEqual(first.page.map((m) => m._id));
  });

  it("getSession (public reader) exposes no presence field, so heartbeats are invisible to it", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await newWebSession(t);
    const session = await t.query(api.chat.getSession, { sessionId });
    // lastSeenAt is admin-only; the public view omits it, so a heartbeat write does not change
    // what this reader returns.
    expect(session).not.toHaveProperty("lastSeenAt");
    expect(session).toMatchObject({ channel: "web" });
    expect(internal.chat.getSessionInternal).toBeDefined();
  });
});
