// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
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
    channel?: "web" | "whatsapp" | "line" | "facebook";
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

    expect(lineResult.sessions.map((session) => session.channel)).toEqual(["line"]);
    expect(facebookSearchResult.sessions.map((session) => session.visitorName)).toEqual([
      "Facebook guest",
    ]);
    expect(whatsappResult.sessions.map((session) => session.visitorName)).toEqual([
      "WhatsApp guest",
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

  it("uses stored transcript messages for end-only date filters when metadata is missing", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = adminTest(t);

    const missingMetadataSessionId = await insertAdminSession(t, {
      visitorName: "Stored message without metadata",
      messageCount: 1,
      adminSortAt: 4_000,
      lastSeenAt: 4_000,
    });
    await insertAdminSession(t, {
      visitorName: "No message date",
      adminSortAt: 3_500,
      lastSeenAt: 3_500,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessages", {
        sessionId: missingMetadataSessionId,
        role: "assistant",
        content: "Stored transcript timestamp should drive the filter.",
        timestamp: 3_000,
      });
    });

    const result = await admin.query(api.adminChat.listSessions, {
      status: "all",
      messageEndAt: 3_500,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sessions.map((session) => session.visitorName)).toEqual([
      "Stored message without metadata",
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
      messageCount: 25,
      latestMessageAt: 1_024,
      adminSortAt: 1_024,
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index++) {
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
      paginationOpts: { numItems: 20, cursor: null },
    });
    const secondPage = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 20, cursor: firstPage.continueCursor },
    });

    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.page[0]?.content).toBe("Message 24");
    expect(firstPage.page[firstPage.page.length - 1]?.content).toBe("Message 5");
    expect(firstPage.isDone).toBe(false);
    expect(secondPage.page.map((message) => message.content)).toEqual([
      "Message 4",
      "Message 3",
      "Message 2",
      "Message 1",
      "Message 0",
    ]);
    expect(secondPage.isDone).toBe(true);
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

    await t.mutation(internal.migrations.backfillChatSessionAdminMetadata, {
      limit: 10,
      dryRun: false,
    });

    const session = await t.query(api.chat.getSession, { sessionId });
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
    const afterFirst = await t.query(api.chat.getSession, { sessionId });
    await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "assistant",
      content: "Hi there",
    });
    const afterSecond = await t.query(api.chat.getSession, { sessionId });

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

    const session = await t.query(api.chat.getSession, { sessionId });
    expect(session?.adminSearchText).toContain("nina contact");
    expect(session?.adminSearchText).toContain("nina@example.com");
    expect(session?.adminSearchText).toContain("+66111111111");
  });

  it("LINE inbound and reply paths update session metadata", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-admin-metadata",
      lineUserId: "UMETA",
      sourceType: "user",
      eventType: "message",
      messageText: "Can I check in late?",
      eventTimestamp: 1_700_000_000_000,
    });
    const sessionId = claim.sessionId as Id<"chatSessions">;

    await t.mutation(api.line.recordInboundEvent, {
      eventId: claim.eventId,
      sessionId,
      userContent: "Can I check in late?",
    });
    const afterInbound = await t.query(api.chat.getSession, { sessionId });

    await t.mutation(api.line.completeEvent, {
      eventId: claim.eventId,
      sessionId,
      assistantContent: "Late check-in depends on availability.",
      replyMode: "unknown_fallback",
      lineReplyStatus: 200,
    });
    const afterReply = await t.query(api.chat.getSession, { sessionId });

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
      eventId: claim.eventId,
      sessionId,
      userContent: "Can I check in late?",
    });
    const afterInbound = await t.query(api.chat.getSession, { sessionId });

    await t.mutation(api.whatsapp.completeEvent, {
      eventId: claim.eventId,
      sessionId,
      assistantContent: "Late check-in depends on availability.",
      replyMode: "unknown_fallback",
      whatsappReplyStatus: 200,
    });
    const afterReply = await t.query(api.chat.getSession, { sessionId });

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
