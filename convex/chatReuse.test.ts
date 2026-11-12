// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

describe("chat session reuse", () => {
  it("does not reuse a session that was closed after opening", async () => {
    const t = convexTest(schema, modules);
    const { sessionId, guestToken: sessionIdGuestToken } = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-closed-reuse",
    });

    await t.mutation(internal.chat.acceptGuestMessage, {
      sessionId,
      content: "Please do not bring this back after restart.",
    });
    await t.mutation(api.chat.closeSession, { guestToken: sessionIdGuestToken, sessionId });

    await expect(
      t.query(api.chat.getReusableSession, { guestToken: sessionIdGuestToken, sessionId: sessionId,
        visitorId: "visitor-closed-reuse",
        messageLimit: 20,
      }),
    ).resolves.toBeNull();
  });

  it("returns a newer open session after skipping a closed one", async () => {
    const t = convexTest(schema, modules);
    const visitorId = "visitor-new-open-reuse";
    const { sessionId: closedSessionId, guestToken: closedSessionIdGuestToken } = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId,
    });
    await t.mutation(api.chat.closeSession, { guestToken: closedSessionIdGuestToken, sessionId: closedSessionId });

    const { sessionId: openSessionId, guestToken: openSessionIdGuestToken } = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId,
    });

    const reusableSession = await t.query(api.chat.getReusableSession, { guestToken: openSessionIdGuestToken, sessionId: openSessionId,
      visitorId,
      messageLimit: 20,
    });

    expect(reusableSession?._id).toBe(openSessionId);
  });

  it("keeps reusing an under-limit session that has not been closed", async () => {
    const t = convexTest(schema, modules);
    const visitorId = "visitor-under-limit-reuse";
    const { sessionId, guestToken: sessionIdGuestToken } = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId,
    });

    await t.mutation(internal.chat.acceptGuestMessage, {
      sessionId,
      content: "Can I see the villa in 360?",
    });
    await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId,
      content: "Yes, the virtual tour is available on every villa page.",
    });

    const reusableSession = await t.query(api.chat.getReusableSession, { guestToken: sessionIdGuestToken, sessionId: sessionId,
      visitorId,
      messageLimit: 20,
    });

    expect(reusableSession?._id).toBe(sessionId);
  });

  it("round-trips assistant action metadata with chat messages", async () => {
    const t = convexTest(schema, modules);
    const { sessionId, guestToken: sessionIdGuestToken } = await t.mutation(api.chat.createSession, {
      channel: "web",
      visitorId: "visitor-action-metadata",
    });

    await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId,
      content: "Use the booking card below to choose dates.",
      action: "booking",
    });
    await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId,
      content: "This answer should not show an action card.",
      action: "none",
    });

    const messages = await t.query(api.chat.getMessages, { guestToken: sessionIdGuestToken, sessionId });

    expect(messages.map((message) => message.action)).toEqual(["booking", "none"]);
  });
});
