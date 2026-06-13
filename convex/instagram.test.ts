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

describe("Instagram webhook events", () => {
  it("claims duplicate events once and stores the Instagram transcript", async () => {
    const t = convexTest(schema, modules);

    const firstClaim = await t.mutation(api.instagram.claimEvent, {
      eventKey: "instagram-event-1",
      instagramUserId: "ig-user-123",
      instagramAccountId: "ig-account-123",
      eventType: "message",
      messageText: "See villas",
      eventTimestamp: 1_700_000_000_000,
    });
    await t.mutation(api.instagram.recordInboundEvent, {
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See villas",
    });

    const duplicateClaim = await t.mutation(api.instagram.claimEvent, {
      eventKey: "instagram-event-1",
      instagramUserId: "ig-user-123",
      instagramAccountId: "ig-account-123",
      eventType: "message",
      messageText: "See villas",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(firstClaim.duplicate).toBe(false);
    expect(firstClaim.sessionId).toBeTruthy();
    expect(duplicateClaim.duplicate).toBe(true);
    expect(duplicateClaim.sessionId).toBe(firstClaim.sessionId);

    await t.mutation(api.instagram.completeEvent, {
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      assistantContent: "You can explore all demo villas on the 360° tour.",
      replyMode: "exact",
      instagramReplyStatus: 200,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: firstClaim.sessionId!,
    });
    const session = await t.query(api.chat.getSession, {
      sessionId: firstClaim.sessionId!,
    });
    const event = await t.run(async (ctx) => await ctx.db.get(firstClaim.eventId));

    expect(session).toMatchObject({
      channel: "instagram",
      visitorId: "instagram:ig-user-123",
      visitorContactApp: "instagram",
      visitorContactHandle: "ig-user-123",
    });
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "See villas"],
      ["assistant", "You can explore all demo villas on the 360° tour."],
    ]);
    expect(event).toMatchObject({
      status: "replied",
      replyMode: "exact",
      instagramReplyStatus: 200,
    });
  });

  it("keeps inbound Instagram text visible when replying to Instagram fails", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.instagram.claimEvent, {
      eventKey: "instagram-event-failed-reply",
      instagramUserId: "ig-user-999",
      instagramAccountId: "ig-account-123",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    await t.mutation(api.instagram.recordInboundEvent, {
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "ราคาเท่าไหร่",
    });
    await t.mutation(api.instagram.markEventFailed, {
      eventId: claim.eventId,
      error: "Instagram reply failed (401): invalid token",
      instagramReplyStatus: 401,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: claim.sessionId!,
    });
    const duplicateClaim = await t.mutation(api.instagram.claimEvent, {
      eventKey: "instagram-event-failed-reply",
      instagramUserId: "ig-user-999",
      instagramAccountId: "ig-account-123",
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
