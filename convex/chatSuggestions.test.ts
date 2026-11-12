// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { fixtureGuestToken, fixtureGuestTokenHash } from "./testing/fixtures.test-support";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function finishScheduledWork(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

async function createWebSession(t: ReturnType<typeof convexTest>, visitorId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("conversations", {
      channel: "web",
      guestTokenHash: fixtureGuestTokenHash,
      visitorId,
      lastSeenAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });
  });
}


describe("static suggestion chips remain live", () => {
  it("returns ordered static suggestion keys for a session", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-suggestions");
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });
    expect(selected).toEqual([
      { source: "static", suggestionId: "availability" },
      { source: "static", suggestionId: "totalPrice" },
    ]);
  });

  it("does not return static suggestion keys that were already shown", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-repeat");
    const firstSelected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });
    await t.mutation(api.chatSuggestions.markShown, { guestToken: fixtureGuestToken, sessionId, suggestions: firstSelected });
    const secondSelected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice", "direct"],
      limit: 2,
    });

    expect(firstSelected.map((s) => s.suggestionId)).toEqual(["availability", "totalPrice"]);
    expect(secondSelected.map((s) => s.suggestionId)).toEqual(["direct"]);
  });

  it("records static suggestion clicks and hides clicked keys", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-click");

    await t.mutation(api.chatSuggestions.markClicked, { guestToken: fixtureGuestToken,
      sessionId,
      suggestion: { source: "static", suggestionId: "availability" },
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice"],
      limit: 2,
    });
    const interactions = await t.run(async (ctx) =>
      ctx.db
        .query("chatStaticSuggestionInteractions")
        .withIndex("by_session_and_suggestionKey", (q) => q.eq("sessionId", sessionId).eq("suggestionKey", "availability"))
        .take(1),
    );

    expect(interactions[0]?.shownAt).toBeTruthy();
    expect(interactions[0]?.clickedAt).toBeTruthy();
    expect(selected).toEqual([{ source: "static", suggestionId: "totalPrice" }]);
  });

  it("returns no static suggestions after every candidate has been shown", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await createWebSession(t, "visitor-static-exhausted");
    const candidates: Array<"availability" | "totalPrice"> = ["availability", "totalPrice"];

    await t.mutation(api.chatSuggestions.markShown, { guestToken: fixtureGuestToken,
      sessionId,
      suggestions: candidates.map((suggestionId) => ({ source: "static" as const, suggestionId })),
    });
    const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken: fixtureGuestToken,
      sessionId,
      candidateSuggestionIds: candidates,
      limit: 2,
    });

    expect(selected).toEqual([]);
  });

  it("does not generate ranked suggestions from public assistant messages", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { sessionId, guestToken } = await t.mutation(api.chat.createSession, {
        channel: "web",
        visitorId: "visitor-public-assistant",
      });
      const userMessageId = await t.mutation(internal.chat.acceptGuestMessage, {
        sessionId,
        content: "What's included when booking direct?",
      });
      expect(userMessageId).toBeTruthy();

      await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId,
        content: "Direct booking includes host support and better pricing.",
      });
      await finishScheduledWork(t);

      const selected = await t.query(api.chatSuggestions.nextForSession, { guestToken,
        sessionId,
        candidateSuggestionIds: ["availability", "totalPrice"],
        limit: 5,
      });
      expect(selected).toEqual([
        { source: "static", suggestionId: "availability" },
        { source: "static", suggestionId: "totalPrice" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
