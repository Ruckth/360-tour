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

describe("WhatsApp webhook events", () => {
  it("claims duplicate events once and stores the WhatsApp transcript", async () => {
    const t = convexTest(schema, modules);

    const firstClaim = await t.mutation(api.whatsapp.claimEvent, {
      eventKey: "whatsapp-event-1",
      whatsappUserId: "66956823432",
      profileName: "Rugby",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "See prices",
      eventTimestamp: 1_700_000_000_000,
    });
    await t.mutation(api.whatsapp.recordInboundEvent, {
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      userContent: "See prices",
    });

    const duplicateClaim = await t.mutation(api.whatsapp.claimEvent, {
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
      eventId: firstClaim.eventId,
      sessionId: firstClaim.sessionId!,
      assistantContent: "Current direct booking prices start from ฿4,500/night.",
      replyMode: "exact",
      whatsappReplyStatus: 200,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: firstClaim.sessionId!,
    });
    const session = await t.query(api.chat.getSession, {
      sessionId: firstClaim.sessionId!,
    });
    const event = await t.run(async (ctx) => await ctx.db.get(firstClaim.eventId));

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
      eventKey: "whatsapp-event-failed-reply",
      whatsappUserId: "66999999999",
      phoneNumberId: "1134040116463992",
      eventType: "message",
      messageText: "ราคาเท่าไหร่",
      eventTimestamp: 1_700_000_000_000,
    });

    await t.mutation(api.whatsapp.recordInboundEvent, {
      eventId: claim.eventId,
      sessionId: claim.sessionId!,
      userContent: "ราคาเท่าไหร่",
    });
    await t.mutation(api.whatsapp.markEventFailed, {
      eventId: claim.eventId,
      error: "WhatsApp reply failed (401): invalid token",
      whatsappReplyStatus: 401,
    });

    const messages = await t.query(api.chat.getMessages, {
      sessionId: claim.sessionId!,
    });
    const duplicateClaim = await t.mutation(api.whatsapp.claimEvent, {
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
    expect(duplicateClaim.status).toBe("received");
  });
});
