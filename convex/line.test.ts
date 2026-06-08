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

describe("LINE webhook events", () => {
  it("claims duplicate events once and stores the LINE transcript", async () => {
    const t = convexTest(schema, modules);

    const firstClaim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-event-1",
      lineUserId: "U123",
      sourceType: "user",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });
    const duplicateClaim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-event-1",
      lineUserId: "U123",
      sourceType: "user",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(firstClaim.duplicate).toBe(false);
    expect(firstClaim.sessionId).toBeTruthy();
    expect(duplicateClaim.duplicate).toBe(true);
    expect(duplicateClaim.sessionId).toBe(firstClaim.sessionId);

    await t.mutation(api.line.completeEvent, {
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See prices",
      assistantContent: "Current direct booking prices start from ฿4,500/night.",
      replyMode: "exact",
      lineReplyStatus: 200,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: firstClaim.sessionId!,
    });
    const session = await t.query(api.chat.getSession, {
      sessionId: firstClaim.sessionId!,
    });

    expect(session).toMatchObject({
      channel: "line",
      visitorId: "line:U123",
      visitorContactApp: "line",
      visitorContactHandle: "U123",
    });
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "See prices"],
      ["assistant", "Current direct booking prices start from ฿4,500/night."],
    ]);
  });
});
