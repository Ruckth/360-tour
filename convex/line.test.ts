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
    await t.mutation(api.line.recordInboundEvent, {
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See prices",
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

  it("keeps inbound LINE text visible when replying to LINE fails", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-event-failed-reply",
      lineUserId: "U999",
      sourceType: "user",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    await t.mutation(api.line.recordInboundEvent, {
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "ราคาเท่าไหร่",
    });
    await t.mutation(api.line.markEventFailed, {
      eventId: claim.eventId,
      error: "LINE reply failed (401): invalid token",
      lineReplyStatus: 401,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: claim.sessionId!,
    });
    const duplicateClaim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-event-failed-reply",
      lineUserId: "U999",
      sourceType: "user",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "ราคาเท่าไหร่"],
    ]);
    expect(duplicateClaim.duplicate).toBe(false);
    expect(duplicateClaim.status).toBe("received");
  });

  it("stores question-bank LINE reply modes in the transcript event", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.line.claimEvent, {
      eventKey: "line-event-question-bank",
      lineUserId: "UQB",
      sourceType: "user",
      eventType: "message",
      messageText: "Do you include airport pickup?",
      eventTimestamp: 1_700_000_000_000,
    });
    await t.mutation(api.line.recordInboundEvent, {
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "Do you include airport pickup?",
    });
    await t.mutation(api.line.completeEvent, {
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      assistantContent: "Yes. Direct booking includes airport pickup.",
      replyMode: "question_bank_exact",
      lineReplyStatus: 200,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: claim.sessionId!,
    });
    const event = await t.run(async (ctx) => await ctx.db.get(claim.eventId));

    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Do you include airport pickup?"],
      ["assistant", "Yes. Direct booking includes airport pickup."],
    ]);
    expect(event).toMatchObject({
      status: "replied",
      replyMode: "question_bank_exact",
      lineReplyStatus: 200,
    });
  });
});
