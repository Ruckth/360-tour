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

describe("Facebook webhook events", () => {
  it("claims duplicate events once and stores the Facebook transcript", async () => {
    const t = convexTest(schema, modules);

    const firstClaim = await t.mutation(api.facebook.claimEvent, {
      serverSecret: "",
      eventKey: "facebook-event-1",
      facebookUserId: "fb-user-123",
      pageId: "page-123",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });
    await t.mutation(api.facebook.recordInboundEvent, {
      serverSecret: "",
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See prices",
    });

    const duplicateClaim = await t.mutation(api.facebook.claimEvent, {
      serverSecret: "",
      eventKey: "facebook-event-1",
      facebookUserId: "fb-user-123",
      pageId: "page-123",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(firstClaim.duplicate).toBe(false);
    expect(firstClaim.sessionId).toBeTruthy();
    expect(duplicateClaim.duplicate).toBe(true);
    expect(duplicateClaim.sessionId).toBe(firstClaim.sessionId);

    await t.mutation(api.facebook.completeEvent, {
      serverSecret: "",
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      assistantContent: "Current direct booking prices start from ฿4,500/night.",
      replyMode: "exact",
      facebookReplyStatus: 200,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: firstClaim.sessionId!,
    });
    const session = await t.query(internal.chat.getSessionInternal, {
      sessionId: firstClaim.sessionId!,
    });
    const event = await t.run(async (ctx) => await ctx.db.get(firstClaim.eventId));

    expect(session).toMatchObject({
      channel: "facebook",
      visitorId: "facebook:fb-user-123",
      visitorContactApp: "facebook",
      visitorContactHandle: "fb-user-123",
    });
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "See prices"],
      ["assistant", "Current direct booking prices start from ฿4,500/night."],
    ]);
    expect(event).toMatchObject({
      status: "replied",
      replyMode: "exact",
      facebookReplyStatus: 200,
    });
  });

  it("keeps inbound Facebook text visible when replying to Facebook fails", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.facebook.claimEvent, {
      serverSecret: "",
      eventKey: "facebook-event-failed-reply",
      facebookUserId: "fb-user-999",
      pageId: "page-123",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    await t.mutation(api.facebook.recordInboundEvent, {
      serverSecret: "",
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "ราคาเท่าไหร่",
    });
    await t.mutation(api.facebook.markEventFailed, {
      serverSecret: "",
      eventId: claim.eventId,
      error: "Facebook reply failed (401): invalid token",
      facebookReplyStatus: 401,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: claim.sessionId!,
    });
    const duplicateClaim = await t.mutation(api.facebook.claimEvent, {
      serverSecret: "",
      eventKey: "facebook-event-failed-reply",
      facebookUserId: "fb-user-999",
      pageId: "page-123",
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
});
