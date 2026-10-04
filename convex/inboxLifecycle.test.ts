// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sendFailed, staffNeeded } from "./lib/inboxLifecycle";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.stubEnv("ADMIN_EMAILS", "admin@example.com"));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const sessionId = await t.mutation(api.chat.createSession, {
    channel: "web",
  });
  const guestId = await t.mutation(api.chat.addMessage, {
    sessionId,
    role: "user",
    content: "Does the suite have Wi-Fi?",
  });
  const detail = async () =>
    (await admin.query(api.adminChat.getSessionDetail, { sessionId }))!.session;
  return { t, admin, sessionId, guestId, detail };
}
describe("automatic responder lifecycle", () => {
  it("exposes the guest turn for guarded completion of an unmigrated legacy chat", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.patch(s.sessionId, { latestGuestMessageId: undefined, inboxState: undefined, inboxReason: undefined });
      await ctx.db.insert("chatMessages", {
        sessionId: s.sessionId, role: "assistant", content: "Historical reply", timestamp: Date.now(),
      });
    });
    const detail = await s.detail();
    expect(detail.latestGuestMessageId).toBe(s.guestId);
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId, status: "resolved", expectedGuestMessageId: detail.latestGuestMessageId,
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done", inboxReason: "no_reply_needed" });
  });
  it("rejects No reply needed when a new guest turn arrived after the action was chosen", async () => {
    const s = await setup();
    const newer = await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId, role: "user", content: "Can I bring a pet?",
    });
    await expect(s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId, status: "resolved", expectedGuestMessageId: s.guestId,
    })).rejects.toThrow("A new guest message arrived");
    expect(await s.detail()).toMatchObject({ latestGuestMessageId: newer, inboxState: "processing" });
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId, status: "resolved", expectedGuestMessageId: newer,
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done", inboxReason: "no_reply_needed" });
  });
  it.each(["answered", "awaiting_guest"] as const)(
    "resolves a successful AI %s and reopens on another guest turn",
    async (outcome) => {
      const s = await setup();
      expect(await s.detail()).toMatchObject({
        inboxState: "processing",
        needsReply: false,
      });
      await s.t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId: s.sessionId,
        replyToMessageId: s.guestId,
        content: "Yes, Wi-Fi is included.",
        outcome,
      });
      expect(await s.detail()).toMatchObject({
        adminStatus: "resolved",
        inboxState: "done",
        inboxReason: outcome,
        resolutionSource: "ai",
        needsReply: false,
      });
      await s.t.mutation(api.chat.addMessage, {
        sessionId: s.sessionId,
        role: "user",
        content: "What time is check-in?",
      });
      expect(await s.detail()).toMatchObject({
        inboxState: "processing",
        inboxReason: "answering",
      });
      expect((await s.detail()).adminStatus).toBeUndefined();
    },
  );
  it("keeps an AI handoff visible even when its acknowledgement is the last message", async () => {
    const s = await setup();
    await s.t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId: s.sessionId,
      replyToMessageId: s.guestId,
      content: "I will ask staff to confirm.",
      outcome: "needs_staff",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
      inboxHandoff: true,
      aiPaused: true,
    });
    const queue = await s.admin.query(api.adminChat.listSessions, {
      status: "needs_reply",
      adminStatus: "open",
    });
    expect(queue.sessions.map((row) => row._id)).toContain(s.sessionId);
  });
  it("resolves a staff answer once, releases takeover, and preserves a newer question", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "first",
      content: "Wi-Fi is included.",
      replyToMessageId: s.guestId,
    });
    const newer = await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId,
      role: "user",
      content: "Can you arrange a transfer?",
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "first" });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      latestGuestMessageId: newer,
      needsReply: true,
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "second",
      content: "Yes, send your flight details.",
      replyToMessageId: newer,
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "second" });
    await s.admin.mutation(api.adminReply.complete, { requestId: "second" });
    expect(await s.detail()).toMatchObject({
      adminStatus: "resolved",
      inboxState: "done",
      resolutionSource: "staff",
    });
    expect((await s.detail()).aiPaused).toBeUndefined();
    const transcript = await s.admin.query(
      api.adminChat.listTranscriptMessages,
      {
        sessionId: s.sessionId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(
      transcript.page.filter(
        (row) => row.content === "Yes, send your flight details.",
      ),
    ).toHaveLength(1);
  });
  it("refuses a reply drafted against a guest turn that is no longer current", async () => {
    const s = await setup();
    await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId,
      role: "user",
      content: "Another question",
    });
    await expect(
      s.admin.mutation(api.adminReply.claim, {
        sessionId: s.sessionId,
        requestId: "stale",
        content: "Old answer",
        replyToMessageId: s.guestId,
      }),
    ).rejects.toThrow("A new guest message arrived");
  });
  it("keeps a failed send actionable and resolves only after a successful retry", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "fail",
      content: "Yes.",
    });
    await s.admin.mutation(api.adminReply.fail, {
      requestId: "fail",
      error: "Channel unavailable",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
      inboxReason: "send_failed",
      inboxSendError: "Channel unavailable",
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "retry",
      content: "Yes.",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "retry" });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
    expect((await s.detail()).inboxSendError).toBeUndefined();
  });
  it("does not resolve a promised follow-up until its explicit task is completed", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check with housekeeping",
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "task-answer",
      content: "We found your charger.",
    });
    await s.admin.mutation(api.adminReply.complete, {
      requestId: "task-answer",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      staffTask: "Check with housekeeping",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: null,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "done",
      resolutionSource: "staff",
    });
  });
  it("completing a task without answering the guest returns it to Needs you", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check availability",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: null,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
    });
  });
  it("keeps the next issue with staff only when explicitly pinned", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: true,
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "pinned",
      content: "Yes.",
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "pinned" });
    expect(await s.detail()).toMatchObject({
      inboxState: "done",
      aiPaused: true,
      keepWithStaff: true,
    });
    await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId,
      role: "user",
      content: "One more question.",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
    });
  });
  it("does not let a late AI answer or a failed old send overwrite a newer turn", async () => {
    const s = await setup();
    await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId,
      role: "user",
      content: "New question",
    });
    await s.t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
      sessionId: s.sessionId,
      replyToMessageId: s.guestId,
      content: "Old answer",
      outcome: "answered",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "answering",
    });
  });
  it("moves a crashed AI turn to Needs you and ignores the watchdog after success", async () => {
    const s = await setup();
    await s.t.mutation(internal.inboxLifecycle.expireAnswer, {
      sessionId: s.sessionId,
      messageId: s.guestId,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      inboxReason: "send_failed",
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "recovery",
      content: "Yes.",
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "recovery" });
    await s.t.mutation(internal.inboxLifecycle.expireAnswer, {
      sessionId: s.sessionId,
      messageId: s.guestId,
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
  });
  it("undo reopens as a deliberate follow-up and No reply needed completes it", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "open",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      staffTask: "Review conversation",
    });
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "done",
      resolutionSource: "manual",
    });
  });
  it("ignores a delayed handoff and failure after staff has answered the current guest", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "answered",
      content: "Wi-Fi is included.",
    });
    await s.admin.mutation(api.adminReply.complete, { requestId: "answered" });
    await s.t.run(async (ctx) => {
      expect(await staffNeeded(ctx, s.sessionId, s.guestId)).toBe(false);
      await sendFailed(ctx, s.sessionId, s.guestId, "Old AI request failed");
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "done",
      resolutionSource: "staff",
    });
    expect((await s.detail()).inboxSendError).toBeUndefined();
  });
  it("ignores a delayed handoff from an older guest turn", async () => {
    const s = await setup();
    const current = await s.t.mutation(api.chat.addMessage, {
      sessionId: s.sessionId,
      role: "user",
      content: "A different question",
    });
    await s.t.run(async (ctx) => {
      expect(await staffNeeded(ctx, s.sessionId, s.guestId)).toBe(false);
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      latestGuestMessageId: current,
      inboxReason: "answering",
    });
  });
  it.each(["resolved", "archived"] as const)(
    "preserves intentional %s despite a late send failure or confirmation",
    async (status) => {
      const s = await setup();
      await s.admin.mutation(api.adminReply.claim, {
        sessionId: s.sessionId,
        requestId: "manual",
        content: "Yes.",
      });
      await s.admin.mutation(api.adminChat.setSessionStatus, {
        sessionId: s.sessionId,
        status,
      });
      await s.t.run((ctx) =>
        sendFailed(ctx, s.sessionId, s.guestId, "Late failure", "manual"),
      );
      await s.admin.mutation(api.adminReply.complete, { requestId: "manual" });
      expect(await s.detail()).toMatchObject({
        adminStatus: status,
        inboxState: "done",
      });
    },
  );
  it("prevents unpin or Resume AI from releasing a pending send or follow-up", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: true,
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "pending",
      content: "Yes.",
    });
    await s.admin.mutation(api.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: false,
    });
    await s.admin.mutation(api.adminChat.setAiPaused, {
      sessionId: s.sessionId,
      paused: true,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
      aiPaused: true,
    });
    await expect(
      s.admin.mutation(api.adminChat.setAiPaused, {
        sessionId: s.sessionId,
        paused: false,
      }),
    ).rejects.toThrow("Complete the follow-up");
    await s.admin.mutation(api.adminReply.complete, { requestId: "pending" });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check transfer",
    });
    await s.admin.mutation(api.adminChat.setAiPaused, {
      sessionId: s.sessionId,
      paused: true,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "follow_up",
      aiPaused: true,
    });
    await expect(
      s.admin.mutation(api.adminChat.setAiPaused, {
        sessionId: s.sessionId,
        paused: false,
      }),
    ).rejects.toThrow("Complete the follow-up");
  });
  it.each(["manual", "staff"] as const)(
    "ignores an old AI handoff after %s completion",
    async (source) => {
      const s = await setup();
      if (source === "manual")
        await s.admin.mutation(api.adminChat.setSessionStatus, {
          sessionId: s.sessionId,
          status: "resolved",
        });
      else {
        await s.admin.mutation(api.adminReply.claim, {
          sessionId: s.sessionId,
          requestId: "staff-first",
          content: "Yes.",
        });
        await s.admin.mutation(api.adminReply.complete, {
          requestId: "staff-first",
        });
      }
      await s.t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
        sessionId: s.sessionId,
        replyToMessageId: s.guestId,
        content: "I will ask staff.",
        outcome: "needs_staff",
      });
      expect(await s.detail()).toMatchObject({
        inboxState: "done",
        resolutionSource: source,
      });
    },
  );
  it("keeps a pending send In progress while a task is added and completed", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "extra-reply",
      content: "One more detail.",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Arrange a transfer",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: null,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
      aiPaused: true,
    });
    await s.admin.mutation(api.adminReply.complete, {
      requestId: "extra-reply",
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
  });
  it("does not hide a failed extra reply when its follow-up is completed", async () => {
    const s = await setup();
    await s.admin.mutation(api.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "extra-failure",
      content: "One more detail.",
    });
    await s.admin.mutation(api.adminReply.fail, {
      requestId: "extra-failure",
      error: "Delivery not confirmed",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check the channel",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      inboxReason: "send_failed",
      inboxSendError: "Delivery not confirmed",
    });
    await s.admin.mutation(api.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: null,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      inboxReason: "send_failed",
      inboxSendError: "Delivery not confirmed",
      needsReply: true,
    });
  });
});
