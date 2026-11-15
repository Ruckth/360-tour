// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { fixtureGuestTokenHash } from "./testing/fixtures.test-support";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("chat browser handoffs", () => {
  it("creates and claims a handoff once", async () => {
    const t = convexTest(schema, modules);
    const { sessionId, guestToken: sessionIdGuestToken } = await t.mutation(api.messaging.chat.createSession, {
      channel: "web",
      visitorId: "visitor-handoff",
    });

    const token = await t.mutation(api.messaging.chat.createBrowserHandoff, { guestToken: sessionIdGuestToken, sessionId });

    expect(token).toMatch(/^[a-f0-9]{48}$/);
    await expect(
      t.mutation(api.messaging.chat.claimBrowserHandoff, { token }),
    ).resolves.toMatchObject({ sessionId });
    await expect(
      t.mutation(api.messaging.chat.claimBrowserHandoff, { token }),
    ).resolves.toBeNull();
  });

  it("rejects missing, expired, and invalid handoff tokens", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const sessionId = await t.run(async (ctx) => {
      const session = await ctx.db.insert("conversations", { guestTokenHash: fixtureGuestTokenHash,
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
      t.mutation(api.messaging.chat.claimBrowserHandoff, { token: "expired-token" }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.messaging.chat.claimBrowserHandoff, { token: "claimed-token" }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.messaging.chat.claimBrowserHandoff, { token: "not-real" }),
    ).resolves.toBeNull();

    const session = await t.query(internal.messaging.chat.getSessionInternal, { sessionId });
    expect(session?.visitorId).toBe("visitor-expired");
  });
});
