// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const adminEmail = "admin@example.com";

async function insertSession(t: ReturnType<typeof convexTest>, channel: "web" | "line" | "facebook") {
  return await t.run((ctx) =>
    ctx.db.insert("chatSessions", {
      channel,
      ...(channel === "line" ? { visitorContactHandle: "Uline123" } : {}),
      ...(channel === "facebook" ? { visitorContactHandle: "fb-user-123" } : {}),
      createdAt: Date.now(),
    }),
  );
}

describe("admin replies", () => {
  it("requires an allowlisted admin before claiming a reply", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const sessionId = await insertSession(t, "web");

    await expect(
      t.mutation(api.adminReply.claim, {
        sessionId,
        requestId: "reply-1",
        content: "Hello from admin",
      }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("records one admin message after delivery and updates the session", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
    const sessionId = await insertSession(t, "web");

    const claim = await admin.mutation(api.adminReply.claim, {
      sessionId,
      requestId: "reply-2",
      content: "Hello from admin",
    });
    expect(claim).toMatchObject({ state: "new", channel: "web" });

    await admin.mutation(api.adminReply.complete, { requestId: "reply-2" });
    await admin.mutation(api.adminReply.complete, { requestId: "reply-2" });

    const messages = await admin.query(api.adminChat.listTranscriptMessages, {
      sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(messages.page).toMatchObject([
      { role: "assistant", source: "admin", content: "Hello from admin" },
    ]);
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.messageCount).toBe(1);
  });

  it("uses the saved LINE recipient and refuses duplicate claims", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
    const sessionId = await insertSession(t, "line");
    const args = { sessionId, requestId: "reply-3", content: "LINE reply" };

    expect(await admin.mutation(api.adminReply.claim, args)).toMatchObject({
      state: "new",
      channel: "line",
      recipient: "Uline123",
    });
    expect(await admin.mutation(api.adminReply.claim, args)).toMatchObject({
      state: "pending",
    });
  });

  it("rejects a Facebook reply outside the visitor response window", async () => {
    vi.stubEnv("ADMIN_EMAILS", adminEmail);
    const t = convexTest(schema, modules);
    const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: "admin-token" });
    const sessionId = await insertSession(t, "facebook");
    await expect(
      admin.mutation(api.adminReply.claim, {
        sessionId,
        requestId: "reply-4",
        content: "Too late",
      }),
    ).rejects.toThrow(/within 24 hours/);
  });
});
