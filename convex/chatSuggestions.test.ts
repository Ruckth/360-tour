// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

async function finishScheduledWork(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

it("returns ordered static suggestion keys for a session", async () => {
  const t = convexTest(schema, modules);
  const now = 1_700_000_000_000;
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: "visitor-static-suggestions",
      lastSeenAt: now,
      createdAt: now,
    });
  });

  const selected = await t.query(api.chatSuggestions.nextForSession, {
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
  const now = 1_700_000_000_000;
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: "visitor-static-repeat",
      lastSeenAt: now,
      createdAt: now,
    });
  });
  const firstSelected = await t.query(api.chatSuggestions.nextForSession, {
    sessionId,
    candidateSuggestionIds: ["availability", "totalPrice", "direct"],
    limit: 2,
  });
  await t.mutation(api.chatSuggestions.markShown, {
    sessionId,
    suggestions: firstSelected,
  });
  const secondSelected = await t.query(api.chatSuggestions.nextForSession, {
    sessionId,
    candidateSuggestionIds: ["availability", "totalPrice", "direct"],
    limit: 2,
  });

  expect(firstSelected.map((suggestion) => suggestion.suggestionId)).toEqual([
    "availability",
    "totalPrice",
  ]);
  expect(secondSelected.map((suggestion) => suggestion.suggestionId)).toEqual([
    "direct",
  ]);
});

it("records static suggestion clicks and hides clicked keys", async () => {
  const t = convexTest(schema, modules);
  const now = 1_700_000_000_000;
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: "visitor-static-click",
      lastSeenAt: now,
      createdAt: now,
    });
  });

  await t.mutation(api.chatSuggestions.markClicked, {
    sessionId,
    suggestion: { source: "static", suggestionId: "availability" },
  });
  const selected = await t.query(api.chatSuggestions.nextForSession, {
    sessionId,
    candidateSuggestionIds: ["availability", "totalPrice"],
    limit: 2,
  });
  const interactions = await t.run(async (ctx) => {
    return await ctx.db
      .query("chatStaticSuggestionInteractions")
      .withIndex("by_session_and_suggestionKey", (q) =>
        q.eq("sessionId", sessionId).eq("suggestionKey", "availability"),
      )
      .take(1);
  });

  expect(interactions[0]?.shownAt).toBeTruthy();
  expect(interactions[0]?.clickedAt).toBeTruthy();
  expect(selected).toEqual([{ source: "static", suggestionId: "totalPrice" }]);
});

it("returns no static suggestions after every candidate has been shown", async () => {
  const t = convexTest(schema, modules);
  const now = 1_700_000_000_000;
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatSessions", {
      channel: "web",
      visitorId: "visitor-static-exhausted",
      lastSeenAt: now,
      createdAt: now,
    });
  });
  const candidates = ["availability", "totalPrice"];

  await t.mutation(api.chatSuggestions.markShown, {
    sessionId,
    suggestions: candidates.map((suggestionId) => ({
      source: "static" as const,
      suggestionId,
    })),
  });
  const selected = await t.query(api.chatSuggestions.nextForSession, {
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
    const sessionId = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-public-assistant",
    });
    const userMessageId = await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "user",
      content: "What's included when booking direct?",
    });
    expect(userMessageId).toBeTruthy();

    await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "assistant",
      content: "Direct booking includes host support and better pricing.",
    });
    await finishScheduledWork(t);

    const selected = await t.query(api.chatSuggestions.nextForSession, {
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

it("does not store generated suggestions from trusted internal assistant messages", async () => {
  vi.useFakeTimers();
  vi.stubEnv("AI_API_KEY", "");
  try {
    const t = convexTest(schema, modules);
    const sessionId = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-internal-assistant",
    });
    const userMessageId = await t.mutation(api.chat.addMessage, {
      sessionId,
      role: "user",
      content: "What's included when booking direct?",
    });

    await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId,
      content: "Direct booking includes host support and better pricing.",
      locale: "en",
      replyToMessageId: userMessageId,
    });
    await finishScheduledWork(t);

    const selected = await t.query(api.chatSuggestions.nextForSession, {
      sessionId,
      candidateSuggestionIds: ["availability", "totalPrice"],
      limit: 2,
    });
    const generatedRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatSuggestedQuestions")
        .withIndex("by_session_and_status", (q) =>
          q.eq("sessionId", sessionId).eq("status", "active"),
        )
        .take(10);
    });

    expect(selected).toEqual([
      { source: "static", suggestionId: "availability" },
      { source: "static", suggestionId: "totalPrice" },
    ]);
    expect(generatedRows).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
});
