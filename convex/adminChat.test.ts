// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import migrationsTest from "@convex-dev/migrations/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildAdminSearchText } from "./lib/adminChatMetadata";
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

async function insertAdminSession(
  t: ReturnType<typeof convexTest>,
  overrides: {
    visitorName?: string;
    visitorEmail?: string;
    visitorPhone?: string;
    visitorContactHandle?: string;
    propertySlug?: string;
    currentPath?: string;
    visitorId?: string;
    channel?: "web" | "whatsapp" | "line" | "facebook" | "instagram";
    messageCount?: number;
    latestMessageAt?: number;
    adminSortAt?: number;
    createdAt?: number;
    lastSeenAt?: number;
    lastOpenedAt?: number;
    lastClosedAt?: number;
    omitMessageCount?: boolean;
  } = {},
) {
  return await t.run(async (ctx) => {
    const createdAt = overrides.createdAt ?? 1_700_000_000_000;
    const session = {
      channel: overrides.channel ?? "web",
      visitorId: overrides.visitorId,
      visitorName: overrides.visitorName,
      visitorEmail: overrides.visitorEmail,
      visitorPhone: overrides.visitorPhone,
      visitorContactHandle: overrides.visitorContactHandle,
      propertySlug: overrides.propertySlug,
      currentPath: overrides.currentPath,
      lastSeenAt: overrides.lastSeenAt ?? overrides.adminSortAt ?? createdAt,
      lastOpenedAt: overrides.lastOpenedAt ?? createdAt,
      lastClosedAt: overrides.lastClosedAt,
      messageCount: overrides.messageCount ?? 0,
      latestMessageAt: overrides.latestMessageAt,
      adminSortAt:
        overrides.adminSortAt ??
        overrides.latestMessageAt ??
        overrides.lastSeenAt ??
        createdAt,
      createdAt,
    };

    return await ctx.db.insert("chatSessions", {
      channel: session.channel,
      ...(session.visitorId ? { visitorId: session.visitorId } : {}),
      ...(session.visitorName ? { visitorName: session.visitorName } : {}),
      ...(session.visitorEmail ? { visitorEmail: session.visitorEmail } : {}),
      ...(session.visitorPhone ? { visitorPhone: session.visitorPhone } : {}),
      ...(session.visitorContactHandle
        ? { visitorContactHandle: session.visitorContactHandle }
        : {}),
      ...(session.propertySlug ? { propertySlug: session.propertySlug } : {}),
      ...(session.currentPath ? { currentPath: session.currentPath } : {}),
      lastSeenAt: session.lastSeenAt,
      lastOpenedAt: session.lastOpenedAt,
      ...(typeof session.lastClosedAt === "number"
        ? { lastClosedAt: session.lastClosedAt }
        : {}),
      ...(overrides.omitMessageCount ? {} : { messageCount: session.messageCount }),
      ...(typeof session.latestMessageAt === "number"
        ? { latestMessageAt: session.latestMessageAt }
        : {}),
      adminSortAt: session.adminSortAt,
      adminSearchText: buildAdminSearchText(session),
      createdAt,
    });
  });
}

describe("adminChat.listSessions", () => {
  it("requires admin identity", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.adminChat.listSessions, {
        status: "all",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("defaults to non-empty sessions ordered by latest message time", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Recent empty activity",
      messageCount: 0,
      adminSortAt: 5_000,
      lastSeenAt: 5_000,
    });
    await insertAdminSession(t, {
      visitorName: "Older message",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 2_000,
      lastSeenAt: 8_000,
    });
    await insertAdminSession(t, {
      visitorName: "Newer message",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 1_000,
      lastSeenAt: 1_000,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Newer message",
      "Older message",
    ]);
  });

  it("returns 10 sessions per cursor page", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    for (let index = 0; index < 12; index++) {
      await insertAdminSession(t, {
        visitorName: `Visitor ${index}`,
        messageCount: 1,
        latestMessageAt: 1_700_000_000_000 + index,
        adminSortAt: 1_700_000_000_000 + index,
      });
    }

    const firstPage = await admin.query(api.adminChat.listSessions, {
      status: "all",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(firstPage.sessions).toHaveLength(10);
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.continueCursor).toBeTruthy();
    expect(firstPage.sessions[0]?.visitorName).toBe("Visitor 11");

    const secondPage = await admin.query(api.adminChat.listSessions, {
      status: "all",
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
    });

    expect(secondPage.sessions).toHaveLength(2);
    expect(secondPage.isDone).toBe(true);
  });

  it("filters empty sessions using messageCount", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Empty visitor",
      messageCount: 0,
      adminSortAt: 1_700_000_000_010,
    });
    await insertAdminSession(t, {
      visitorName: "Non empty visitor",
      messageCount: 1,
      latestMessageAt: 1_700_000_000_020,
      adminSortAt: 1_700_000_000_020,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      empty: "empty",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Empty visitor",
    ]);
  });

  it("keeps legacy empty sessions visible without including stale zero-count sessions", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "True empty visitor",
      messageCount: 0,
      adminSortAt: 1_700_000_000_030,
    });
    const staleSessionId = await insertAdminSession(t, {
      visitorName: "Stale zero visitor",
      messageCount: 0,
      latestMessageAt: 1_700_000_000_020,
      adminSortAt: 1_700_000_000_020,
    });
    await insertAdminSession(t, {
      visitorName: "Legacy missing count visitor",
      omitMessageCount: true,
      adminSortAt: 1_700_000_000_010,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessages", {
        sessionId: staleSessionId,
        role: "assistant",
        content: "This stored message means the thread is not empty.",
        timestamp: 1_700_000_000_020,
      });
    });

    const emptyResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      empty: "empty",
      paginationOpts: { numItems: 10, cursor: null },
    });
    const allResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(emptyResult.sessions.map((session) => session.visitorName)).toEqual([
      "True empty visitor",
      "Legacy missing count visitor",
    ]);
    expect(
      allResult.sessions.find((session) => session._id === staleSessionId)?.messageCount,
    ).toBe(1);
  });

  it("filters by latest message date range", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Too early",
      messageCount: 1,
      latestMessageAt: 1_000,
      adminSortAt: 1_000,
    });
    await insertAdminSession(t, {
      visitorName: "Inside range",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 2_000,
    });
    await insertAdminSession(t, {
      visitorName: "Too late",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 3_000,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      messageStartAt: 1_500,
      messageEndAt: 2_500,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Inside range",
    ]);
  });

  it("filters sessions by channel in normal and search results", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Website guest",
      visitorEmail: "web@example.com",
      channel: "web",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 3_000,
    });
    await insertAdminSession(t, {
      visitorName: "LINE guest",
      visitorContactHandle: "U123",
      visitorId: "line:U123",
      channel: "line",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 2_000,
    });
    await insertAdminSession(t, {
      visitorName: "Facebook guest",
      visitorContactHandle: "FB123",
      visitorId: "facebook:FB123",
      channel: "facebook",
      messageCount: 1,
      latestMessageAt: 1_000,
      adminSortAt: 1_000,
    });
    await insertAdminSession(t, {
      visitorName: "WhatsApp guest",
      visitorPhone: "+66956823432",
      visitorContactHandle: "66956823432",
      visitorId: "whatsapp:66956823432",
      channel: "whatsapp",
      messageCount: 1,
      latestMessageAt: 500,
      adminSortAt: 500,
    });
    await insertAdminSession(t, {
      visitorName: "Instagram guest",
      visitorContactHandle: "ig123",
      visitorId: "instagram:ig123",
      channel: "instagram",
      messageCount: 1,
      latestMessageAt: 250,
      adminSortAt: 250,
    });

    const lineResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "line",
      paginationOpts: { numItems: 10, cursor: null },
    });
    const facebookSearchResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "facebook",
      searchQuery: "guest",
      paginationOpts: { numItems: 10, cursor: null },
    });
    const whatsappResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "whatsapp",
      searchQuery: "9568",
      paginationOpts: { numItems: 10, cursor: null },
    });
    const instagramResult = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "instagram",
      searchQuery: "ig123",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(lineResult.sessions.map((session) => session.channel)).toEqual(["line"]);
    expect(facebookSearchResult.sessions.map((session) => session.visitorName)).toEqual([
      "Facebook guest",
    ]);
    expect(whatsappResult.sessions.map((session) => session.visitorName)).toEqual([
      "WhatsApp guest",
    ]);
    expect(instagramResult.sessions.map((session) => session.visitorName)).toEqual([
      "Instagram guest",
    ]);
  });

  it("includes sessions at the exact latest-message end timestamp", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "End inclusive",
      messageCount: 1,
      latestMessageAt: 2_999,
      adminSortAt: 2_999,
    });
    await insertAdminSession(t, {
      visitorName: "After end",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 3_000,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      messageStartAt: 2_000,
      messageEndAt: 2_999,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "End inclusive",
    ]);
  });

  it("excludes sessions without latest-message metadata from date filters", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Message without metadata",
      messageCount: 1,
      adminSortAt: 4_000,
      lastSeenAt: 4_000,
    });
    await insertAdminSession(t, {
      visitorName: "Message with metadata",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 3_000,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      messageEndAt: 3_500,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Message with metadata",
    ]);
  });

  it("fills status-filtered pages when matching sessions are beyond the first raw page", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const now = 1_700_000_000_000;

    for (let index = 0; index < 12; index++) {
      await insertAdminSession(t, {
        visitorName: `Active ${index}`,
        messageCount: 1,
        latestMessageAt: now + 2_000 + index,
        adminSortAt: now + 2_000 + index,
        lastSeenAt: now - 1_000,
        lastOpenedAt: now - 1_000,
      });
    }
    for (let index = 0; index < 10; index++) {
      await insertAdminSession(t, {
        visitorName: `Inactive ${index}`,
        messageCount: 1,
        latestMessageAt: now + index,
        adminSortAt: now + index,
        lastSeenAt: now - 300_000,
        lastOpenedAt: now - 300_000,
      });
    }

    const result = await admin.query(api.adminChat.listSessions, {
      status: "inactive",
      now,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions).toHaveLength(10);
    expect(result.sessions.every((session) => session.visitorName?.startsWith("Inactive"))).toBe(true);
    expect(result.isDone).toBe(true);
  });

  it("returns a continuation cursor for sparse filtered pages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const now = 1_700_000_000_000;

    for (let index = 0; index < 100; index++) {
      await insertAdminSession(t, {
        visitorName: `Active sparse ${index}`,
        messageCount: 1,
        latestMessageAt: now + 2_000 + index,
        adminSortAt: now + 2_000 + index,
        lastSeenAt: now - 1_000,
        lastOpenedAt: now - 1_000,
      });
    }
    await insertAdminSession(t, {
      visitorName: "Inactive sparse match",
      messageCount: 1,
      latestMessageAt: now + 1_000,
      adminSortAt: now + 1_000,
      lastSeenAt: now - 300_000,
      lastOpenedAt: now - 300_000,
    });

    const firstPage = await admin.query(api.adminChat.listSessions, {
      status: "inactive",
      now,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const secondPage = await admin.query(api.adminChat.listSessions, {
      status: "inactive",
      now,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
    });

    expect(firstPage.sessions).toHaveLength(0);
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.continueCursor).toBeTruthy();
    expect(secondPage.sessions.map((session) => session.visitorName)).toEqual([
      "Inactive sparse match",
    ]);
    expect(secondPage.isDone).toBe(true);
  });

  it("fills date-filtered active pages when inactive sessions are newer", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const now = 1_700_000_000_000;

    for (let index = 0; index < 12; index++) {
      await insertAdminSession(t, {
        visitorName: `Inactive in range ${index}`,
        messageCount: 1,
        latestMessageAt: 3_000 + index,
        adminSortAt: 3_000 + index,
        lastSeenAt: now - 300_000,
        lastOpenedAt: now - 300_000,
      });
    }
    for (let index = 0; index < 10; index++) {
      await insertAdminSession(t, {
        visitorName: `Active in range ${index}`,
        messageCount: 1,
        latestMessageAt: 2_000 + index,
        adminSortAt: 2_000 + index,
        lastSeenAt: now - 1_000,
        lastOpenedAt: now - 1_000,
      });
    }

    const result = await admin.query(api.adminChat.listSessions, {
      status: "active",
      messageStartAt: 1_500,
      messageEndAt: 4_000,
      now,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions).toHaveLength(10);
    expect(result.sessions.every((session) => session.visitorName?.startsWith("Active in range"))).toBe(true);
    expect(result.isDone).toBe(true);
  });

  it("keeps combined date and status cursors stable without skipping overflow matches", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const now = 1_700_000_000_000;

    for (let index = 0; index < 12; index++) {
      await insertAdminSession(t, {
        visitorName: `Inactive cursor ${index}`,
        messageCount: 1,
        latestMessageAt: 4_000 + index,
        adminSortAt: 4_000 + index,
        lastSeenAt: now - 300_000,
        lastOpenedAt: now - 300_000,
      });
    }
    for (let index = 0; index < 13; index++) {
      await insertAdminSession(t, {
        visitorName: `Active cursor ${index}`,
        messageCount: 1,
        latestMessageAt: 2_000 + index,
        adminSortAt: 2_000 + index,
        lastSeenAt: now - 1_000,
        lastOpenedAt: now - 1_000,
      });
    }

    const firstPage = await admin.query(api.adminChat.listSessions, {
      status: "active",
      messageStartAt: 1_500,
      messageEndAt: 5_000,
      now,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const secondPage = await admin.query(api.adminChat.listSessions, {
      status: "active",
      messageStartAt: 1_500,
      messageEndAt: 5_000,
      now,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
    });

    expect(firstPage.sessions).toHaveLength(10);
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.sessions).toHaveLength(3);
    expect(secondPage.isDone).toBe(true);
    expect(new Set([...firstPage.sessions, ...secondPage.sessions].map((session) => session._id)).size).toBe(13);
  });

  it("searches visitor contact and context with light typo tolerance", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Maya Chen",
      visitorEmail: "maya@example.com",
      visitorPhone: "+66123456789",
      visitorContactHandle: "@maya-line",
      propertySlug: "garden-suite",
      currentPath: "/rooms/garden-suite",
      visitorId: "visitor-maya",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 2_000,
    });
    await insertAdminSession(t, {
      visitorName: "Other Guest",
      visitorEmail: "other@example.com",
      propertySlug: "pool-villa",
      messageCount: 1,
      latestMessageAt: 1_000,
      adminSortAt: 1_000,
    });

    const direct = await admin.query(api.adminChat.listSessions, {
      status: "all",
      searchQuery: "garden-suite",
      paginationOpts: { numItems: 10, cursor: null },
    });
    const typo = await admin.query(api.adminChat.listSessions, {
      status: "all",
      searchQuery: "myaa",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(direct.sessions.map((session) => session.visitorName)).toContain("Maya Chen");
    expect(typo.sessions.map((session) => session.visitorName)).toContain("Maya Chen");
  });

  it("sorts equal-score search results by latest message time", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    await insertAdminSession(t, {
      visitorName: "Older same match",
      propertySlug: "shared-query",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 9_000,
    });
    await insertAdminSession(t, {
      visitorName: "Newer same match",
      propertySlug: "shared-query",
      messageCount: 1,
      latestMessageAt: 3_000,
      adminSortAt: 1_000,
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      searchQuery: "shared-query",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Newer same match",
      "Older same match",
    ]);
  });

  it("searches message transcript content", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    const matchingSessionId = await insertAdminSession(t, {
      visitorName: "Transcript match",
      messageCount: 1,
      latestMessageAt: 2_000,
      adminSortAt: 2_000,
    });
    await insertAdminSession(t, {
      visitorName: "No transcript match",
      messageCount: 1,
      latestMessageAt: 1_000,
      adminSortAt: 1_000,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessages", {
        sessionId: matchingSessionId,
        role: "user",
        content: "Is there a halal restaurant nearby?",
        timestamp: 2_000,
      });
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      searchQuery: "halal restaurant",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session._id)).toContain(matchingSessionId);
  });

  it("paginates transcript messages from newest to older", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await insertAdminSession(t, {
      visitorName: "Long transcript",
      messageCount: 45,
      latestMessageAt: 1_044,
      adminSortAt: 1_044,
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 45; index++) {
        await ctx.db.insert("chatMessages", {
          sessionId,
          role: index % 2 === 0 ? "user" : "assistant",
          content: `Message ${index}`,
          timestamp: 1_000 + index,
        });
      }
    });

    const firstPage = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const secondPage = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 20, cursor: firstPage.continueCursor },
    });
    const thirdPage = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 20, cursor: secondPage.continueCursor },
    });

    expect(firstPage.page).toHaveLength(10);
    expect(firstPage.page[0]?.content).toBe("Message 44");
    expect(firstPage.page[firstPage.page.length - 1]?.content).toBe("Message 35");
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page).toHaveLength(20);
    expect(secondPage.page[0]?.content).toBe("Message 34");
    expect(secondPage.page[secondPage.page.length - 1]?.content).toBe("Message 15");
    expect(secondPage.isDone).toBe(false);
    expect(thirdPage.page.map((message) => message.content)).toEqual(
      Array.from({ length: 15 }, (_, index) => `Message ${14 - index}`),
    );
    expect(thirdPage.isDone).toBe(true);
  });

  it("backfills latest-message metadata from legacy embedded messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorName: "Legacy transcript",
        visitorId: "legacy-transcript",
        messageCount: 0,
        latestMessageAt: 1_000,
        adminSortAt: 1_000,
        adminSearchText: "legacy transcript",
        messages: [
          { role: "user", content: "Old hello", timestamp: 2_000 },
          { role: "assistant", content: "Old reply", timestamp: 3_000 },
        ],
        createdAt: 900,
      });
    });

    migrationsTest.register(t);
    vi.useFakeTimers();
    try {
      await t.mutation(internal.migrations.run, { fn: "migrations:backfillChatSessionAdminMetadata" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    const session = await t.query(internal.chat.getSessionInternal, { sessionId });
    const filtered = await admin.query(api.adminChat.listSessions, {
      status: "all",
      messageStartAt: 2_500,
      messageEndAt: 3_500,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(session?.messageCount).toBe(2);
    expect(session?.latestMessageAt).toBe(3_000);
    expect(session?.adminSortAt).toBe(3_000);
    expect(filtered.sessions.map((row) => row._id)).toContain(sessionId);
  });
});

describe("admin chat metadata writes", () => {
  it("chat.addMessage increments messageCount and latestMessageAt", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-metadata",
    });

    await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "user",
      content: "Hello",
    });
    const afterFirst = await t.query(internal.chat.getSessionInternal, { sessionId });
    await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "assistant",
      content: "Hi there",
    });
    const afterSecond = await t.query(internal.chat.getSessionInternal, { sessionId });

    expect(afterFirst?.messageCount).toBe(1);
    expect(afterFirst?.latestMessageAt).toEqual(expect.any(Number));
    expect(afterSecond?.messageCount).toBe(2);
    expect(afterSecond?.latestMessageAt).toBeGreaterThanOrEqual(
      afterFirst?.latestMessageAt ?? 0,
    );
  });

  it("identifyVisitor refreshes searchable contact text", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-contact-refresh",
    });

    await t.mutation(api.chat.identifyVisitor, {
      sessionId,
      name: "Nina Contact",
      email: "NINA@Example.com",
      phone: "+66111111111",
      contactApp: "whatsapp",
    });

    const session = await t.query(internal.chat.getSessionInternal, { sessionId });
    expect(session?.adminSearchText).toContain("nina contact");
    expect(session?.adminSearchText).toContain("nina@example.com");
    expect(session?.adminSearchText).toContain("+66111111111");
  });

  it("LINE inbound and reply paths update session metadata", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.line.claimEvent, {
      serverSecret: "",
      eventKey: "line-admin-metadata",
      lineUserId: "UMETA",
      sourceType: "user",
      eventType: "message",
      messageText: "Can I check in late?",
      eventTimestamp: 1_700_000_000_000,
    });
    const sessionId = claim.sessionId as Id<"chatSessions">;

    await t.mutation(api.line.recordInboundEvent, {
      serverSecret: "",
      eventId: claim.eventId,
      sessionId,
      userContent: "Can I check in late?",
    });
    const afterInbound = await t.query(internal.chat.getSessionInternal, { sessionId });

    await t.mutation(api.line.completeEvent, {
      serverSecret: "",
      eventId: claim.eventId,
      sessionId,
      assistantContent: "Late check-in depends on availability.",
      replyMode: "unknown_fallback",
      lineReplyStatus: 200,
    });
    const afterReply = await t.query(internal.chat.getSessionInternal, { sessionId });

    expect(afterInbound?.messageCount).toBe(1);
    expect(afterInbound?.latestMessageAt).toBe(1_700_000_000_000);
    expect(afterReply?.messageCount).toBe(2);
    expect(afterReply?.latestMessageAt).toBeGreaterThanOrEqual(
      afterInbound?.latestMessageAt ?? 0,
    );
    expect(afterReply?.adminSearchText).toContain("umeta");
  });

  it("WhatsApp inbound and reply paths update session metadata", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.whatsapp.claimEvent, {
      serverSecret: "",
      eventKey: "whatsapp-admin-metadata",
      whatsappUserId: "66956823432",
      profileName: "WhatsApp Guest",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "Can I check in late?",
      eventTimestamp: 1_700_000_000_000,
    });
    const sessionId = claim.sessionId as Id<"chatSessions">;

    await t.mutation(api.whatsapp.recordInboundEvent, {
      serverSecret: "",
      eventId: claim.eventId,
      sessionId,
      userContent: "Can I check in late?",
    });
    const afterInbound = await t.query(internal.chat.getSessionInternal, { sessionId });

    await t.mutation(api.whatsapp.completeEvent, {
      serverSecret: "",
      eventId: claim.eventId,
      sessionId,
      assistantContent: "Late check-in depends on availability.",
      replyMode: "unknown_fallback",
      whatsappReplyStatus: 200,
    });
    const afterReply = await t.query(internal.chat.getSessionInternal, { sessionId });

    expect(afterInbound?.messageCount).toBe(1);
    expect(afterInbound?.latestMessageAt).toBe(1_700_000_000_000);
    expect(afterReply?.messageCount).toBe(2);
    expect(afterReply?.latestMessageAt).toBeGreaterThanOrEqual(
      afterInbound?.latestMessageAt ?? 0,
    );
    expect(afterReply?.adminSearchText).toContain("whatsapp guest");
    expect(afterReply?.adminSearchText).toContain("66956823432");
  });
});

describe("admin chat unanswered warning", () => {
  it("flags the latest guest message until a reply or settle, then re-flags new guest messages", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await insertAdminSession(t, {
      visitorName: "Warning guest",
      messageCount: 1,
      latestMessageAt: 1_000,
    });
    const insertMessage = (role: "user" | "assistant", timestamp: number) =>
      t.run(async (ctx) =>
        ctx.db.insert("chatMessages", { sessionId, role, content: `${role} ${timestamp}`, timestamp }),
      );
    const needsReply = async () => {
      const result = await admin.query(api.adminChat.listSessions, {
        status: "all",
        paginationOpts: { numItems: 10, cursor: null },
      });
      return result.sessions[0]?.needsReply;
    };

    const firstGuestMessageId = await insertMessage("user", 1_000);
    expect(await needsReply()).toBe(true);

    await insertMessage("assistant", 2_000);
    expect(await needsReply()).toBe(false);

    const secondGuestMessageId = await insertMessage("user", 3_000);
    expect(await needsReply()).toBe(true);

    await expect(
      admin.mutation(api.adminChat.settleGuestMessage, { sessionId, messageId: firstGuestMessageId }),
    ).resolves.toBeNull();
    expect(await needsReply()).toBe(true);

    await admin.mutation(api.adminChat.settleGuestMessage, { sessionId, messageId: secondGuestMessageId });
    expect(await needsReply()).toBe(false);

    await insertMessage("user", 4_000);
    expect(await needsReply()).toBe(true);
  });

  it("requires admin identity to settle", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const sessionId = await insertAdminSession(t);
    const messageId = await t.run(async (ctx) =>
      ctx.db.insert("chatMessages", { sessionId, role: "user", content: "Hi", timestamp: 1 }),
    );

    await expect(
      t.mutation(api.adminChat.settleGuestMessage, { sessionId, messageId }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("channel profile names", () => {
  it("stores LINE, Facebook, and Instagram profile names on the session", async () => {
    const t = convexTest(schema, modules);
    const claims = await Promise.all([
      t.mutation(api.line.claimEvent, {
        serverSecret: "",
        eventKey: "line-name",
        lineUserId: "U-name",
        profileName: " Somchai ",
        eventType: "message",
      }),
      t.mutation(api.facebook.claimEvent, {
        serverSecret: "",
        eventKey: "fb-name",
        facebookUserId: "fb-name",
        profileName: "Maya Chen",
        eventType: "message",
      }),
      t.mutation(api.instagram.claimEvent, {
        serverSecret: "",
        eventKey: "ig-name",
        instagramUserId: "ig-name",
        profileName: "ana.travels",
        eventType: "message",
      }),
    ]);

    const names = await t.run(async (ctx) =>
      Promise.all(
        claims.map(async (claim) => (await ctx.db.get(claim.sessionId as Id<"chatSessions">))?.visitorName),
      ),
    );
    expect(names).toEqual(["Somchai", "Maya Chen", "ana.travels"]);
  });
});

describe("adminChat inbox lifecycle", () => {
  async function insertMessage(
    t: ReturnType<typeof convexTest>,
    sessionId: Id<"chatSessions">,
    role: "user" | "assistant",
    timestamp: number,
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("chatMessages", {
        sessionId,
        role,
        content: role === "user" ? "Guest question" : "Reply",
        timestamp,
      }),
    );
  }

  it("filters by admin status and needs reply", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const base = 1_700_000_000_000;
    const waiting = await insertAdminSession(t, { visitorName: "Waiting", messageCount: 1, latestMessageAt: base + 3 });
    const answered = await insertAdminSession(t, { visitorName: "Answered", messageCount: 2, latestMessageAt: base + 2 });
    const settled = await insertAdminSession(t, { visitorName: "Settled", messageCount: 1, latestMessageAt: base + 1 });
    await insertMessage(t, waiting, "user", base + 3);
    await insertMessage(t, answered, "user", base + 1);
    await insertMessage(t, answered, "assistant", base + 2);
    const settledMessage = await insertMessage(t, settled, "user", base + 1);
    await admin.mutation(api.adminChat.settleGuestMessage, { sessionId: settled, messageId: settledMessage });

    const needsReply = await admin.query(api.adminChat.listSessions, {
      status: "needs_reply",
      adminStatus: "open",
      now: base,
    });
    expect(needsReply.sessions.map((session) => session.visitorName)).toEqual(["Waiting"]);

    await admin.mutation(api.adminChat.setSessionStatus, { sessionId: waiting, status: "resolved" });
    const open = await admin.query(api.adminChat.listSessions, { status: "all", adminStatus: "open", now: base });
    expect(open.sessions.map((session) => session.visitorName)).toEqual(["Answered", "Settled"]);
    const resolved = await admin.query(api.adminChat.listSessions, {
      status: "all",
      adminStatus: "resolved",
      now: base,
    });
    expect(resolved.sessions).toMatchObject([{ visitorName: "Waiting", adminStatus: "resolved" }]);
    expect(typeof resolved.sessions[0].resolvedAt).toBe("number");

    await admin.mutation(api.adminChat.setSessionStatus, { sessionId: waiting, status: "open" });
    const reopened = await t.run((ctx) => ctx.db.get(waiting));
    expect(reopened?.adminStatus).toBeUndefined();
    expect(reopened?.resolvedAt).toBeUndefined();
  });

  it("paginates resolved and archived chats together in Done without including open chats", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const base = 1_700_000_000_000;
    for (let index = 0; index < 12; index++) {
      const sessionId = await insertAdminSession(t, { visitorName: `Completed ${index}`, messageCount: 1, latestMessageAt: base + index, channel: index % 2 ? "line" : "web" });
      await admin.mutation(api.adminChat.setSessionStatus, { sessionId, status: index % 2 ? "archived" : "resolved" });
    }
    await insertAdminSession(t, { visitorName: "Still open", messageCount: 1, latestMessageAt: base + 100 });
    const first = await admin.query(api.adminChat.listSessions, { status: "all", adminStatus: "done", now: base });
    expect(first.sessions).toHaveLength(10);
    expect(first.sessions.every((session) => session.adminStatus === "resolved" || session.adminStatus === "archived")).toBe(true);
    const second = await admin.query(api.adminChat.listSessions, { status: "all", adminStatus: "done", paginationOpts: { numItems: 10, cursor: first.continueCursor }, now: base });
    expect(second.sessions).toHaveLength(2);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.sessions, ...second.sessions].map((session) => session._id)).size).toBe(12);
    const lineOnly = await admin.query(api.adminChat.listSessions, { status: "all", adminStatus: "done", channel: "line", now: base });
    expect(lineOnly.sessions).toHaveLength(6);
    expect(lineOnly.sessions.every((session) => session.channel === "line")).toBe(true);
    const search = await admin.query(api.adminChat.listSessions, { status: "all", adminStatus: "done", searchQuery: "Completed", now: base });
    expect(search.sessions).toHaveLength(10);
    expect(search.sessions.every((session) => session.adminStatus !== undefined)).toBe(true);
  });

  it("reopens a resolved or archived chat when the guest writes again, but not on admin replies", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await insertAdminSession(t, { visitorName: "Guest" });

    await admin.mutation(api.adminChat.setSessionStatus, { sessionId, status: "archived" });
    await admin.mutation(api.adminReply.claim, { sessionId, requestId: "r-1", content: "Following up" });
    await admin.mutation(api.adminReply.complete, { requestId: "r-1" });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.adminStatus).toBe("archived");

    await t.mutation(api.chat.addMessage, { sessionId, role: "user", content: "Hello again" });
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.adminStatus).toBeUndefined();
    expect(session?.archivedAt).toBeUndefined();
  });

  it("pauses and resumes the AI with the assigned admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const sessionId = await insertAdminSession(t);

    await expect(t.mutation(api.adminChat.setAiPaused, { sessionId, paused: true })).rejects.toThrow(
      "Not authenticated",
    );
    await admin.mutation(api.adminChat.setAiPaused, { sessionId, paused: true });
    expect(await t.query(api.chat.isAiPaused, { sessionId })).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
      aiPaused: true,
      assignedAdminEmail: adminEmail,
    });

    await admin.mutation(api.adminChat.setAiPaused, { sessionId, paused: false });
    const resumed = await t.run((ctx) => ctx.db.get(sessionId));
    expect(resumed?.aiPaused).toBeUndefined();
    expect(resumed?.assignedAdminEmail).toBeUndefined();
    expect(await t.query(api.chat.isAiPaused, { sessionId })).toBe(false);
  });

  it("returns the 24-hour reply window for Meta channels", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const web = await insertAdminSession(t, { channel: "web" });
    const whatsapp = await insertAdminSession(t, { channel: "whatsapp" });
    const guestAt = 1_700_000_000_000;
    await insertMessage(t, whatsapp, "user", guestAt);
    await insertMessage(t, whatsapp, "assistant", guestAt + 5);

    expect((await admin.query(api.adminChat.getSessionDetail, { sessionId: web }))?.replyWindow).toEqual({
      applies: false,
    });
    expect((await admin.query(api.adminChat.getSessionDetail, { sessionId: whatsapp }))?.replyWindow).toEqual({
      applies: true,
      lastGuestMessageAt: guestAt,
      closesAt: guestAt + 24 * 60 * 60 * 1000,
    });
  });

  it("deletes only archived chats and cascades their rows in batches", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    try {
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const sessionId = await insertAdminSession(t);
      const keptSessionId = await insertAdminSession(t);
      await t.run(async (ctx) => {
        const questionId = await ctx.db.insert("curatedChatQuestions", {
          question: "Pool?",
          normalizedQuestion: "pool",
          topic: "amenities",
          score: 1,
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          createdByAdminEmail: adminEmail,
          updatedByAdminEmail: adminEmail,
        });
        for (let index = 0; index < 250; index++) {
          await ctx.db.insert("chatMessages", { sessionId, role: "user", content: `m${index}`, timestamp: index });
        }
        const assistantMessageId = await ctx.db.insert("chatMessages", {
          sessionId,
          role: "assistant",
          content: "answer",
          timestamp: 999,
        });
        await ctx.db.insert("chatMessages", { sessionId: keptSessionId, role: "user", content: "keep", timestamp: 1 });
        await ctx.db.insert("adminReplyAttempts", {
          requestId: "req",
          sessionId,
          adminEmail,
          content: "hi",
          status: "sent",
          createdAt: 1,
        });
        await ctx.db.insert("chatBrowserHandoffs", { token: "tok", sessionId, expiresAt: 2, createdAt: 1 });
        await ctx.db.insert("chatQuestionInteractions", { sessionId, questionId, createdAt: 1 });
        await ctx.db.insert("chatStaticSuggestionInteractions", {
          sessionId,
          suggestionKey: "pool",
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("chatSuggestedQuestions", {
          sessionId,
          assistantMessageId,
          question: "Pool?",
          normalizedQuestion: "pool",
          locale: "en",
          topic: "amenities",
          score: 1,
          status: "active",
          createdAt: 1,
        });
      });
      const unknownId = await t.run((ctx) => ctx.db.insert("chatUnknownQuestions", {
        sessionId, userId: "visitor-secret", userQuestion: "Is there a pool?",
        normalizedQuestion: "is there a pool", status: "new", adminNotified: false,
        createdAt: 1, updatedAt: 1,
      }));

      await expect(admin.mutation(api.adminChat.deleteArchivedSession, { sessionId })).rejects.toThrow(
        "Archive the chat before deleting it",
      );
      await admin.mutation(api.adminChat.setSessionStatus, { sessionId, status: "archived" });
      await admin.mutation(api.adminChat.deleteArchivedSession, { sessionId });
      expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.get(unknownId))).toMatchObject({
        userQuestion: "Is there a pool?", status: "new",
      });
      expect((await t.run((ctx) => ctx.db.get(unknownId)))?.sessionId).toBeUndefined();
      expect((await t.run((ctx) => ctx.db.get(unknownId)))?.userId).toBeUndefined();

      const remaining = await t.run(async (ctx) => ({
        messages: await ctx.db.query("chatMessages").collect(),
        attempts: await ctx.db.query("adminReplyAttempts").collect(),
        handoffs: await ctx.db.query("chatBrowserHandoffs").collect(),
        questionInteractions: await ctx.db.query("chatQuestionInteractions").collect(),
        staticInteractions: await ctx.db.query("chatStaticSuggestionInteractions").collect(),
        suggested: await ctx.db.query("chatSuggestedQuestions").collect(),
      }));
      expect(remaining.messages.map((message) => message.content)).toEqual(["keep"]);
      expect(remaining.attempts).toHaveLength(0);
      expect(remaining.handoffs).toHaveLength(0);
      expect(remaining.questionInteractions).toHaveLength(0);
      expect(remaining.staticInteractions).toHaveLength(0);
      expect(remaining.suggested).toHaveLength(0);
      expect(await admin.query(api.adminChat.getSessionDetail, { sessionId })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("adminChat.listSessions with sparse filters", () => {
  async function seed() {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    // 150 newer web chats bury a few older LINE / resolved chats well past one 100-row source page.
    for (let index = 0; index < 150; index++) {
      await insertAdminSession(t, {
        visitorName: `Web ${index}`,
        messageCount: 1,
        latestMessageAt: 1_700_000_100_000 + index,
      });
    }
    const line: Id<"chatSessions">[] = [];
    for (let index = 0; index < 3; index++) {
      line.push(
        await insertAdminSession(t, {
          channel: "line",
          visitorName: `Line ${index}`,
          messageCount: 1,
          latestMessageAt: 1_700_000_000_000 + index,
        }),
      );
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(line[0], { adminStatus: "resolved" });
      await ctx.db.patch(line[1], { adminStatus: "archived" });
    });
    return { t, admin: adminTest(t), line };
  }

  it("finds every chat of a quiet channel on the first page", async () => {
    const { admin, line } = await seed();
    const page = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "line",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.sessions.map((session) => session._id).sort()).toEqual([...line].sort());
    expect(page.isDone).toBe(true);
  });

  it("finds resolved chats directly and still treats a missing status as open", async () => {
    const { admin, line } = await seed();
    const resolved = await admin.query(api.adminChat.listSessions, {
      status: "all",
      adminStatus: "resolved",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(resolved.sessions.map((session) => session._id)).toEqual([line[0]]);
    expect(resolved.isDone).toBe(true);

    const open = await admin.query(api.adminChat.listSessions, {
      status: "all",
      adminStatus: "open",
      channel: "line",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(open.sessions.map((session) => session._id)).toEqual([line[2]]);
  });

  it("keeps date filters on the channel index", async () => {
    const { admin, line } = await seed();
    const page = await admin.query(api.adminChat.listSessions, {
      status: "all",
      channel: "line",
      messageStartAt: 1_700_000_000_001,
      messageEndAt: 1_700_000_000_001,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.sessions.map((session) => session._id)).toEqual([line[1]]);
  });
});

describe("chat.touchSession heartbeat", () => {
  it("only rewrites what changed, but always marks the guest as seen", async () => {
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
    const sessionId = await t.mutation(api.chat.createSession, { channel: "web", currentPath: "/" });
    const before = await t.run((ctx) => ctx.db.get(sessionId));

    vi.useFakeTimers();
    vi.setSystemTime((before?.lastSeenAt ?? 0) + 30_000);
    await t.mutation(api.chat.touchSession, { sessionId, currentPath: "/" });
    const same = await t.run((ctx) => ctx.db.get(sessionId));
    expect(same?.lastSeenAt).toBe((before?.lastSeenAt ?? 0) + 30_000);
    expect(same?.adminSearchText).toBe(before?.adminSearchText);
    // No messages yet, so the inbox sorts this chat by when the guest was last seen.
    expect(same?.adminSortAt).toBe(same?.lastSeenAt);

    await t.mutation(api.chat.touchSession, { sessionId, currentPath: "/villas/pool-villa", propertySlug: "pool-villa" });
    const moved = await t.run((ctx) => ctx.db.get(sessionId));
    expect(moved).toMatchObject({ propertyId, propertySlug: "pool-villa", currentPath: "/villas/pool-villa" });
    expect(moved?.adminSearchText).toContain("pool-villa");
    vi.useRealTimers();
  });
});

it("returns the same Waiting eligibility in a deep-linked detail as in the queue", async () => {
  vi.stubEnv("ADMIN_EMAILS", adminEmail);
  const t = convexTest(schema, modules);
  const admin = adminTest(t);
  const sessionId = await insertAdminSession(t, { visitorName: "Older waiting guest", messageCount: 1 });
  const messageId = await t.run(async (ctx) =>
    ctx.db.insert("chatMessages", {
      sessionId,
      role: "user",
      content: "Is late check-in available?",
      timestamp: 1,
    }),
  );
  const detail = await admin.query(api.adminChat.getSessionDetail, { sessionId });
  expect(detail?.session.needsReply).toBe(true);
  expect(detail?.session.latestMessage?._id).toBe(messageId);
  await admin.mutation(api.adminChat.settleGuestMessage, { sessionId, messageId });
  expect((await admin.query(api.adminChat.getSessionDetail, { sessionId }))?.session.needsReply).toBe(false);
});

describe("adminChat read optimizations", () => {
  const eventTables = {
    line: "lineWebhookEvents",
    facebook: "facebookWebhookEvents",
    whatsapp: "whatsappWebhookEvents",
    instagram: "instagramWebhookEvents",
  } as const;
  const eventKeys = {
    line: "lineEvents",
    facebook: "facebookEvents",
    whatsapp: "whatsappEvents",
    instagram: "instagramEvents",
  } as const;
  type EventChannel = keyof typeof eventTables;
  const eventChannels = Object.keys(eventTables) as EventChannel[];

  async function insertMessage(
    t: ReturnType<typeof convexTest>,
    sessionId: Id<"chatSessions">,
    role: "user" | "assistant",
    timestamp: number,
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("chatMessages", { sessionId, role, content: `${role} ${timestamp}`, timestamp }),
    );
  }

  /** Inserts `count` events into every channel's event table; returns each table's newest id. */
  async function insertEventsInEveryTable(
    t: ReturnType<typeof convexTest>,
    sessionId: Id<"chatSessions">,
    count: number,
  ) {
    return await t.run(async (ctx) => {
      const newest = {} as Record<EventChannel, string>;
      for (const channel of eventChannels) {
        for (let index = 0; index < count; index++) {
          newest[channel] = await ctx.db.insert(eventTables[channel], {
            eventKey: `${channel}-${sessionId}-${index}`,
            sessionId,
            eventType: "message",
            messageText: `${channel} event ${index}`,
            status: "replied",
            eventTimestamp: 1_000 + index,
            processingStartedAt: 1_000 + index,
            createdAt: 1_000 + index,
            updatedAt: 1_000 + index,
          });
        }
      }
      return newest;
    });
  }

  it.each(eventChannels)(
    "getSessionDetail returns only the newest %s event and leaves other channels and the reply window unchanged",
    async (channel) => {
      vi.stubEnv("ADMIN_EMAILS", adminEmail);
      const t = convexTest(schema, modules);
      const admin = adminTest(t);
      const guestAt = 1_700_000_000_000;
      const sessionId = await insertAdminSession(t, { channel, messageCount: 2, latestMessageAt: guestAt + 5 });
      await insertMessage(t, sessionId, "user", guestAt);
      await insertMessage(t, sessionId, "assistant", guestAt + 5);
      // Events in every table, so a wrong table or limit shows up on any channel.
      const newest = await insertEventsInEveryTable(t, sessionId, 12);

      const detail = await admin.query(api.adminChat.getSessionDetail, { sessionId });
      for (const other of eventChannels) {
        expect(detail?.[eventKeys[other]].map((event) => event._id)).toEqual(
          other === channel ? [newest[other]] : [],
        );
      }
      expect(detail?.[eventKeys[channel]][0]?.messageText).toBe(`${channel} event 11`);
      expect(detail?.replyWindow).toEqual(
        channel === "line"
          ? { applies: false }
          : { applies: true, lastGuestMessageAt: guestAt, closesAt: guestAt + 24 * 60 * 60 * 1000 },
      );

      // The legacy transcript keeps its 10 newest events.
      const transcript = await admin.query(api.adminChat.getTranscript, { sessionId });
      for (const other of eventChannels) {
        const events = transcript[eventKeys[other]];
        expect(events).toHaveLength(other === channel ? 10 : 0);
        if (other === channel) {
          expect(events[0]?._id).toBe(newest[other]);
          expect(events.map((event) => event.messageText)).toEqual(
            Array.from({ length: 10 }, (_, index) => `${channel} event ${11 - index}`),
          );
        }
      }
    },
  );

  it("keeps source order and overflow across filtered pages, and dedupes a chat that moved", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const base = 1_700_000_000_000;
    // 105 chats, newest first; the Waiting matches are spread over the first 100-row source page
    // so page 1 overflows, and one more match sits in the second source page.
    const waitingIndexes = new Set([0, 3, 4, 9, 17, 18, 30, 44, 61, 62, 77, 90, 99, 102]);
    const ids: Id<"chatSessions">[] = [];
    for (let index = 0; index < 105; index++) {
      const latestMessageAt = base + 10_000 - index * 10;
      const sessionId = await insertAdminSession(t, {
        visitorName: `Chat ${index}`,
        messageCount: 1,
        latestMessageAt,
      });
      ids.push(sessionId);
      await insertMessage(t, sessionId, waitingIndexes.has(index) ? "user" : "assistant", latestMessageAt);
    }
    const names = (indexes: number[]) => indexes.map((index) => `Chat ${index}`);
    const listWaiting = (cursor: string | null) =>
      admin.query(api.adminChat.listSessions, {
        status: "needs_reply",
        now: base,
        paginationOpts: { numItems: 10, cursor },
      });

    const first = await listWaiting(null);
    expect(first.sessions.map((session) => session.visitorName)).toEqual(
      names([0, 3, 4, 9, 17, 18, 30, 44, 61, 62]),
    );
    expect(first.isDone).toBe(false);
    expect(JSON.parse(first.continueCursor ?? "{}").overflowIds).toEqual([ids[77], ids[90], ids[99]]);

    // Chat 99 (in the overflow) gets older and moves into the unread part of the source.
    await t.run((ctx) => ctx.db.patch(ids[99], { latestMessageAt: base + 10_000 - 1_035 }));

    const second = await listWaiting(first.continueCursor);
    expect(second.sessions.map((session) => session.visitorName)).toEqual(names([77, 90, 99, 102]));
    expect(second.isDone).toBe(true);
    expect(second.continueCursor).toBeNull();
  });

  it("serves overflow-only pages in order until the overflow drains", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const base = 1_700_000_000_000;
    for (let index = 0; index < 30; index++) {
      const latestMessageAt = base + 1_000 - index;
      const sessionId = await insertAdminSession(t, {
        visitorName: `Guest ${index}`,
        messageCount: 1,
        latestMessageAt,
      });
      await insertMessage(t, sessionId, index % 6 === 5 ? "assistant" : "user", latestMessageAt);
    }
    const expected = Array.from({ length: 30 }, (_, index) => index)
      .filter((index) => index % 6 !== 5)
      .map((index) => `Guest ${index}`);

    const pages: string[][] = [];
    let cursor: string | null = null;
    for (let call = 0; call < 5; call++) {
      const page: { sessions: { visitorName?: string }[]; continueCursor: string | null; isDone: boolean } =
        await admin.query(api.adminChat.listSessions, {
          status: "needs_reply",
          now: base,
          paginationOpts: { numItems: 10, cursor },
        });
      pages.push(page.sessions.map((session) => session.visitorName ?? ""));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    expect(pages).toEqual([expected.slice(0, 10), expected.slice(10, 20), expected.slice(20)]);
  });

  it("keeps filtered search pages in score and recency order across offset cursors", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);
    const base = 1_700_000_000_000;
    for (let index = 0; index < 14; index++) {
      const latestMessageAt = base + 1_000 - index;
      const sessionId = await insertAdminSession(t, {
        visitorName: `Searched ${index}`,
        propertySlug: "orderedquery",
        messageCount: 1,
        latestMessageAt,
      });
      await insertMessage(t, sessionId, index === 2 || index === 7 ? "assistant" : "user", latestMessageAt);
    }
    const search = (cursor: string | null) =>
      admin.query(api.adminChat.listSessions, {
        status: "needs_reply",
        searchQuery: "orderedquery",
        now: base,
        paginationOpts: { numItems: 10, cursor },
      });
    const expected = Array.from({ length: 14 }, (_, index) => index)
      .filter((index) => index !== 2 && index !== 7)
      .map((index) => `Searched ${index}`);

    const first = await search(null);
    const second = await search(first.continueCursor);

    expect(first.sessions.map((session) => session.visitorName)).toEqual(expected.slice(0, 10));
    expect(first.isDone).toBe(false);
    expect(second.sessions.map((session) => session.visitorName)).toEqual(expected.slice(10));
    expect(second.isDone).toBe(true);
  });
});
