// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("chat session reuse", () => {

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
