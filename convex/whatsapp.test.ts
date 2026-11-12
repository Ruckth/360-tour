// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");
const TEST_SERVER_SECRET = "test-server-secret";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", TEST_SERVER_SECRET));

describe("WhatsApp webhook events", () => {
  it("claims duplicate events once and stores the WhatsApp transcript", async () => {
    const t = convexTest(schema, modules);

    const firstClaim = await t.mutation(api.whatsapp.claimEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventKey: "whatsapp-event-1",
      whatsappUserId: "66956823432",
      profileName: "Rugby",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });
    await t.mutation(api.whatsapp.recordInboundEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See prices",
    });

    const duplicateClaim = await t.mutation(api.whatsapp.claimEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventKey: "whatsapp-event-1",
      whatsappUserId: "66956823432",
      profileName: "Rugby",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(firstClaim.duplicate).toBe(false);
    expect(firstClaim.sessionId).toBeTruthy();
    expect(duplicateClaim.duplicate).toBe(true);
    expect(duplicateClaim.sessionId).toBe(firstClaim.sessionId);

    await t.mutation(api.whatsapp.completeEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      assistantContent: "Current direct booking prices start from ฿4,500/night.",
      replyMode: "exact",
      whatsappReplyStatus: 200,
    });

    const messages = await t.query(internal.chat.getRecentMessages, { limit: 100,
      sessionId: firstClaim.sessionId!,
    });
    const session = await t.query(internal.chat.getSessionInternal, {
      sessionId: firstClaim.sessionId!,
    });
    const event = await t.run(async (ctx) => await ctx.db.get(firstClaim.eventId));

    expect(session).toMatchObject({ adminStatus: "resolved", inboxState: "done", resolutionSource: "ai" });
    expect(session).toMatchObject({
      channel: "whatsapp",
      visitorId: "whatsapp:66956823432",
      visitorName: "Rugby",
      visitorPhone: "66956823432",
      visitorContactApp: "whatsapp",
      visitorContactHandle: "66956823432",
    });
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "See prices"],
      ["assistant", "Current direct booking prices start from ฿4,500/night."],
    ]);
    expect(event).toMatchObject({
      status: "replied",
      replyMode: "exact",
      whatsappReplyStatus: 200,
    });
  });

  it("keeps inbound WhatsApp text visible when replying to WhatsApp fails", async () => {
    const t = convexTest(schema, modules);

    const claim = await t.mutation(api.whatsapp.claimEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventKey: "whatsapp-event-failed-reply",
      whatsappUserId: "66999999999",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    await t.mutation(api.whatsapp.recordInboundEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "ราคาเท่าไหร่",
    });
    await t.mutation(api.whatsapp.markEventFailed, {
      serverSecret: TEST_SERVER_SECRET,
      eventId: claim.eventId,
      error: "WhatsApp reply failed (401): invalid token",
      whatsappReplyStatus: 401,
    });

    const messages = await t.query(internal.chat.getRecentMessages, { limit: 100,
      sessionId: claim.sessionId!,
    });
    const duplicateClaim = await t.mutation(api.whatsapp.claimEvent, {
      serverSecret: TEST_SERVER_SECRET,
      eventKey: "whatsapp-event-failed-reply",
      whatsappUserId: "66999999999",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "ราคาเท่าไหร่"],
    ]);
    expect(duplicateClaim.duplicate).toBe(false);
    expect(duplicateClaim.status).toBe("processing");
  });
});


describe("durable delivery guard", () => {
  it("claims atomically before recording inbound content", async () => {
    const t = convexTest(schema, modules);
    const args = { serverSecret: TEST_SERVER_SECRET, eventKey: "atomic-claim", whatsappUserId: "test-guest", eventType: "message" as const };
    const first = await t.mutation(api.whatsapp.claimEvent, args);
    const second = await t.mutation(api.whatsapp.claimEvent, args);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it("never replays a failed or ambiguous send once delivery began", async () => {
    const t = convexTest(schema, modules);
    const args = { serverSecret: TEST_SERVER_SECRET, eventKey: "uncertain-send", whatsappUserId: "test-guest", eventType: "message" as const };
    const claim = await t.mutation(api.whatsapp.claimEvent, args);
    await t.mutation(api.whatsapp.recordInboundEvent, { serverSecret: TEST_SERVER_SECRET, eventId: claim.eventId, sessionId: claim.sessionId!, userContent: "Show villas" });
    expect(await t.mutation(api.whatsapp.beginDelivery, { serverSecret: TEST_SERVER_SECRET, eventId: claim.eventId })).toEqual({ started: true });
    expect(await t.mutation(api.whatsapp.beginDelivery, { serverSecret: TEST_SERVER_SECRET, eventId: claim.eventId })).toEqual({ started: false });
    await t.mutation(api.whatsapp.markEventFailed, { serverSecret: TEST_SERVER_SECRET, eventId: claim.eventId, error: "Connection lost after request body sent" });
    const retry = await t.mutation(api.whatsapp.claimEvent, args);
    expect(retry).toMatchObject({ duplicate: true, status: "failed" });
    const event = await t.run(ctx => ctx.db.get(claim.eventId));
    expect(event?.deliveryStartedAt).toEqual(expect.any(Number));
    const session = await t.query(internal.chat.getSessionInternal, { sessionId: claim.sessionId! });
    expect(session?.inboxState).toBe("needs_staff");
  });

  it("blocks a send when staff takes over before the delivery mutation", async () => {
    const t = convexTest(schema, modules);
    const claim = await t.mutation(api.whatsapp.claimEvent, { serverSecret: TEST_SERVER_SECRET, eventKey: "staff-pause", whatsappUserId: "test-guest", eventType: "message" });
    await t.run(ctx => ctx.db.patch(claim.sessionId!, { aiPaused: true }));
    expect(await t.mutation(api.whatsapp.beginDelivery, { serverSecret: TEST_SERVER_SECRET, eventId: claim.eventId })).toEqual({ started: false });
    expect((await t.run(ctx => ctx.db.get(claim.eventId)))?.deliveryStartedAt).toBeUndefined();
  });
});
