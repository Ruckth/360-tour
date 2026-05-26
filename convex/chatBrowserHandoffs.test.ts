// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

describe("chat browser handoffs", () => {
  it("creates and claims a handoff once", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-handoff",
    });

    const token = await t.mutation(api.chat.createBrowserHandoff, { sessionId });

    expect(token).toMatch(/^[a-f0-9]{48}$/);
    await expect(
      t.mutation(api.chat.claimBrowserHandoff, { token }),
    ).resolves.toBe(sessionId);
    await expect(
      t.mutation(api.chat.claimBrowserHandoff, { token }),
    ).resolves.toBeNull();
  });

  it("rejects missing, expired, and invalid handoff tokens", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const sessionId = await t.run(async (ctx) => {
      const session = await ctx.db.insert("chatSessions", {
        channel: "web",
        visitorId: "visitor-expired",
        createdAt: now,
      });
      await ctx.db.insert("chatBrowserHandoffs", {
        token: "expired-token",
        sessionId: session,
        expiresAt: now - 1,
        createdAt: now - 10,
      });
      await ctx.db.insert("chatBrowserHandoffs", {
        token: "claimed-token",
        sessionId: session,
        expiresAt: now + 60_000,
        claimedAt: now,
        createdAt: now - 10,
      });
      return session;
    });

    await expect(
      t.mutation(api.chat.claimBrowserHandoff, { token: "expired-token" }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.chat.claimBrowserHandoff, { token: "claimed-token" }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.chat.claimBrowserHandoff, { token: "not-real" }),
    ).resolves.toBeNull();

    const session = await t.query(api.chat.getSession, { sessionId });
    expect(session?.visitorId).toBe("visitor-expired");
  });
});
