import { asTestOwner, seedTestBranch } from './testing/staff.test-support';
import { insertFixture } from "./testing/completeFixture.test-support";
import { resortDateTime } from "./shared/time";

import { recordTestGuest, commitTestAssistant } from './testing/messages.test-support';
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sendFailed, staffNeeded } from './messaging/inboxState';

const modules = import.meta.glob("./**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { emailVerified: true,
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const { sessionId } = await t.mutation(api.messaging.chat.createSession, {
    channel: "web",
  });
  const guestId = await recordTestGuest(t, {
    sessionId,
    content: "Does the suite have Wi-Fi?",
  });
  const detail = async () =>
    (await admin.query(api.messaging.adminChat.getSessionDetail, { sessionId }))!.session;
  return { t, admin, sessionId, guestId, detail };
}
describe("automatic responder lifecycle", () => {
  it("exposes the guest turn for guarded completion of an unmigrated legacy chat", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.patch(s.sessionId, { latestGuestMessageId: undefined, inboxState: undefined, inboxReason: undefined });
      await ctx.db.insert("messages", {
        sessionId: s.sessionId, role: "assistant", content: "Historical reply", timestamp: Date.now(),
      });
    });
    const detail = await s.detail();
    expect(detail.latestGuestMessageId).toBe(s.guestId);
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId, status: "resolved", expectedGuestMessageId: detail.latestGuestMessageId,
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done", inboxReason: "no_reply_needed" });
  });
  it("rejects No reply needed when a new guest turn arrived after the action was chosen", async () => {
    const s = await setup();
    const newer = await recordTestGuest(s.t, {
      sessionId: s.sessionId,  content: "Can I bring a pet?",
    });
    await expect(s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId, status: "resolved", expectedGuestMessageId: s.guestId,
    })).rejects.toThrow("A new guest message arrived");
    expect(await s.detail()).toMatchObject({ latestGuestMessageId: newer, inboxState: "processing" });
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
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
      await commitTestAssistant(s.t, {
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
      await recordTestGuest(s.t, {
        sessionId: s.sessionId,
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
    await commitTestAssistant(s.t, {
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
    const queue = await s.admin.query(api.messaging.adminChat.listSessions, {
      status: "needs_reply",
      adminStatus: "open",
    });
    expect(queue.sessions.map((row) => row._id)).toContain(s.sessionId);
  });
  it("resolves a staff answer once, releases takeover, and preserves a newer question", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "first",
      content: "Wi-Fi is included.",
      replyToMessageId: s.guestId,
    });
    const newer = await recordTestGuest(s.t, {
      sessionId: s.sessionId,
      content: "Can you arrange a transfer?",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "first" });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      latestGuestMessageId: newer,
      needsReply: true,
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "second",
      content: "Yes, send your flight details.",
      replyToMessageId: newer,
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "second" });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "second" });
    expect(await s.detail()).toMatchObject({
      adminStatus: "resolved",
      inboxState: "done",
      resolutionSource: "staff",
    });
    expect((await s.detail()).aiPaused).toBeUndefined();
    const transcript = await s.admin.query(
      api.messaging.adminChat.listTranscriptMessages,
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
    await recordTestGuest(s.t, {
      sessionId: s.sessionId,
      content: "Another question",
    });
    await expect(
      s.admin.mutation(api.messaging.adminReply.claim, {
        sessionId: s.sessionId,
        requestId: "stale",
        content: "Old answer",
        replyToMessageId: s.guestId,
      }),
    ).rejects.toThrow("A new guest message arrived");
  });
  it("keeps a failed send actionable and resolves only after a successful retry", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "fail",
      content: "Yes.",
    });
    await s.admin.mutation(api.messaging.adminReply.fail, {
      requestId: "fail",
      error: "Channel unavailable",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
      inboxReason: "send_failed",
      inboxSendError: "Channel unavailable",
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "retry",
      content: "Yes.",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "retry" });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
    expect((await s.detail()).inboxSendError).toBeUndefined();
  });
  it("does not resolve a promised follow-up until its explicit task is completed", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check with housekeeping",
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "task-answer",
      content: "We found your charger.",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, {
      requestId: "task-answer",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      staffTask: "Check with housekeeping",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
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
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check availability",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
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
    await s.admin.mutation(api.messaging.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: true,
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "pinned",
      content: "Yes.",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "pinned" });
    expect(await s.detail()).toMatchObject({
      inboxState: "done",
      aiPaused: true,
      keepWithStaff: true,
    });
    await recordTestGuest(s.t, {
      sessionId: s.sessionId,
      content: "One more question.",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      needsReply: true,
    });
  });
  it("does not let a late AI answer or a failed old send overwrite a newer turn", async () => {
    const s = await setup();
    await recordTestGuest(s.t, {
      sessionId: s.sessionId,
      content: "New question",
    });
    await commitTestAssistant(s.t, {
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
    await s.t.mutation(internal.messaging.inboxLifecycle.expireAnswer, {
      sessionId: s.sessionId,
      messageId: s.guestId,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      inboxReason: "send_failed",
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "recovery",
      content: "Yes.",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "recovery" });
    await s.t.mutation(internal.messaging.inboxLifecycle.expireAnswer, {
      sessionId: s.sessionId,
      messageId: s.guestId,
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
  });
  it("undo reopens as a deliberate follow-up and No reply needed completes it", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "open",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      staffTask: "Review conversation",
    });
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
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
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "answered",
      content: "Wi-Fi is included.",
    });
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "answered" });
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
    const current = await recordTestGuest(s.t, {
      sessionId: s.sessionId,
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
      await s.admin.mutation(api.messaging.adminReply.claim, {
        sessionId: s.sessionId,
        requestId: "manual",
        content: "Yes.",
      });
      await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
        sessionId: s.sessionId,
        status,
      });
      await s.t.run((ctx) =>
        sendFailed(ctx, s.sessionId, s.guestId, "Late failure", "manual"),
      );
      await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "manual" });
      expect(await s.detail()).toMatchObject({
        adminStatus: status,
        inboxState: "done",
      });
    },
  );
  it("prevents unpin or Resume AI from releasing a pending send or follow-up", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: true,
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "pending",
      content: "Yes.",
    });
    await s.admin.mutation(api.messaging.adminChat.setKeepWithStaff, {
      sessionId: s.sessionId,
      keep: false,
    });
    await s.admin.mutation(api.messaging.adminChat.setAiPaused, {
      sessionId: s.sessionId,
      paused: true,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
      aiPaused: true,
    });
    await expect(
      s.admin.mutation(api.messaging.adminChat.setAiPaused, {
        sessionId: s.sessionId,
        paused: false,
      }),
    ).rejects.toThrow("Complete the follow-up");
    await s.admin.mutation(api.messaging.adminReply.complete, { requestId: "pending" });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check transfer",
    });
    await s.admin.mutation(api.messaging.adminChat.setAiPaused, {
      sessionId: s.sessionId,
      paused: true,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "follow_up",
      aiPaused: true,
    });
    await expect(
      s.admin.mutation(api.messaging.adminChat.setAiPaused, {
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
        await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
          sessionId: s.sessionId,
          status: "resolved",
        });
      else {
        await s.admin.mutation(api.messaging.adminReply.claim, {
          sessionId: s.sessionId,
          requestId: "staff-first",
          content: "Yes.",
        });
        await s.admin.mutation(api.messaging.adminReply.complete, {
          requestId: "staff-first",
        });
      }
      await commitTestAssistant(s.t, {
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
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "extra-reply",
      content: "One more detail.",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Arrange a transfer",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: null,
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "processing",
      inboxReason: "sending",
      aiPaused: true,
    });
    await s.admin.mutation(api.messaging.adminReply.complete, {
      requestId: "extra-reply",
    });
    expect(await s.detail()).toMatchObject({ inboxState: "done" });
  });
  it("does not hide a failed extra reply when its follow-up is completed", async () => {
    const s = await setup();
    await s.admin.mutation(api.messaging.adminChat.setSessionStatus, {
      sessionId: s.sessionId,
      status: "resolved",
    });
    await s.admin.mutation(api.messaging.adminReply.claim, {
      sessionId: s.sessionId,
      requestId: "extra-failure",
      content: "One more detail.",
    });
    await s.admin.mutation(api.messaging.adminReply.fail, {
      requestId: "extra-failure",
      error: "Delivery not confirmed",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
      sessionId: s.sessionId,
      task: "Check the channel",
    });
    expect(await s.detail()).toMatchObject({
      inboxState: "needs_staff",
      inboxReason: "send_failed",
      inboxSendError: "Delivery not confirmed",
    });
    await s.admin.mutation(api.messaging.adminChat.setStaffTask, {
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

it("preserves a pending staff send against a second tab's reply claim", async () => {
  const s = await setup();
  await s.admin.mutation(api.messaging.adminReply.claim, { sessionId: s.sessionId, requestId: 'first-tab', content: 'First reply' });
  await expect(s.admin.mutation(api.messaging.adminReply.claim, { sessionId: s.sessionId, requestId: 'second-tab', content: 'Second reply' })).rejects.toThrow('A staff reply is pending');
  await s.admin.mutation(api.messaging.adminReply.fail, { requestId: 'first-tab', error: 'Channel failed' });
  expect(await s.detail()).toMatchObject({ inboxReason: 'send_failed', inboxSendError: 'Channel failed', needsReply: true });
  // Failure releases the send lock so staff can deliberately retry.
  expect(await s.admin.mutation(api.messaging.adminReply.claim, { sessionId: s.sessionId, requestId: 'retry-tab', content: 'Retry reply' })).toMatchObject({ state: 'new' });
});

it("preserves pending extra reply failures against stale Reopen", async () => {
  const s = await setup();
  await s.admin.mutation(api.messaging.adminChat.setSessionStatus, { sessionId: s.sessionId, status: 'resolved' });
  await s.admin.mutation(api.messaging.adminReply.claim, { sessionId: s.sessionId, requestId: 'extra-pending', content: 'Extra detail' });
  await expect(s.admin.mutation(api.messaging.adminChat.setSessionStatus, { sessionId: s.sessionId, status: 'open' })).rejects.toThrow('A staff reply is pending');
  await s.admin.mutation(api.messaging.adminReply.fail, { requestId: 'extra-pending', error: 'Channel failed' });
  expect(await s.detail()).toMatchObject({ inboxReason: 'send_failed', inboxSendError: 'Channel failed', needsReply: true });
  await s.admin.mutation(api.messaging.adminChat.setSessionStatus, { sessionId: s.sessionId, status: 'open' });
  expect(await s.detail()).toMatchObject({ inboxState: 'processing', staffTask: 'Review conversation' });
});

describe("chat desk controls", () => {
  const chat = api.messaging.adminChat;

  async function desk() {
    const s = await setup();
    await s.t.run(async ctx => {
      const primary = await seedTestBranch(ctx);
      const other = await seedTestBranch(ctx, "other");
      for (const [email, tokenIdentifier, branchId] of [
        ["desk@example.com", "desk", primary],
        ["other@example.com", "other", other],
      ] as const) {
        await ctx.db.insert("staffGrants", {
          email, tokenIdentifier, branchIds: [branchId], role: "manager",
          createdAt: 1, updatedAt: 1, updatedByEmail: "admin@example.com",
        });
      }
    });
    const manager = s.t.withIdentity({ email: "desk@example.com", tokenIdentifier: "desk", emailVerified: true });
    const outsider = s.t.withIdentity({ email: "other@example.com", tokenIdentifier: "other", emailVerified: true });
    return { ...s, manager, outsider };
  }

  it("allows eligible assignments, rejects stale writes and denies cross-branch access", async () => {
    const { admin, manager, outsider, sessionId, guestId, detail } = await desk();
    const args = { sessionId, email: "desk@example.com", expectedEmail: null };
    await expect(outsider.mutation(chat.assignSession, args)).rejects.toThrow("Chat desk access required");
    await expect(admin.mutation(chat.assignSession, { ...args, email: "other@example.com" })).rejects.toThrow("does not have access");
    await manager.mutation(chat.assignSession, args);
    await expect(admin.mutation(chat.assignSession, args)).rejects.toThrow("Assignment changed");
    expect(await detail()).toMatchObject({ assignedAdminEmail: "desk@example.com" });
    await expect(admin.mutation(chat.settleGuestMessage, {
      sessionId, messageId: guestId, expectedAssignedEmail: null,
    })).rejects.toThrow("Assignment changed");
    await expect(outsider.query(chat.getSessionDetail, { sessionId })).rejects.toThrow("Chat desk access required");
    expect(await outsider.query(chat.queueCounts, {})).toBeNull();
  });

  it("caps queue totals independently of list pagination and excludes empty chats", async () => {
    const { t, admin } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("conversations", {
          channel: "web", createdAt: i, latestMessageAt: i, inboxProjectionVersion: 1, inboxState: "needs_staff",
        });
      }
      await ctx.db.insert("conversations", {
        channel: "web", createdAt: 1, inboxProjectionVersion: 1, inboxState: "processing",
      });
      await ctx.db.insert("conversations", {
        channel: "web", createdAt: 1, latestMessageAt: 1, inboxProjectionVersion: 1,
      });
      await ctx.db.insert("conversations", {
        channel: "web", createdAt: 1, latestMessageAt: 1, inboxProjectionVersion: 1,
        adminStatus: "resolved", inboxState: "processing",
      });
    });
    expect(await admin.query(chat.queueCounts, {})).toEqual({ waiting: 100, inProgress: 2 });
    await admin.query(chat.listSessions, { adminStatus: "archived" });
    expect(await admin.query(chat.queueCounts, {})).toEqual({ waiting: 100, inProgress: 2 });
  });

  it("rejects stale settlement and AI changes while preserving current state", async () => {
    const { t, admin, sessionId, guestId, detail } = await setup();
    const newer = await recordTestGuest(t, { sessionId, content: "Another question" });
    await expect(admin.mutation(chat.settleGuestMessage, { sessionId, messageId: guestId })).rejects.toThrow("The chat changed");
    expect((await detail()).settledGuestMessageId).toBeUndefined();
    await admin.mutation(chat.setAiPaused, { sessionId, paused: true, expectedPaused: false });
    await expect(admin.mutation(chat.setAiPaused, { sessionId, paused: true, expectedPaused: false })).rejects.toThrow("AI state changed");
    await admin.mutation(chat.settleGuestMessage, { sessionId, messageId: newer });
    expect(await detail()).toMatchObject({ settledGuestMessageId: newer, inboxState: "done" });
  });

  it("keeps an in-flight reply and queue state when a stale list action settles it", async () => {
    const { admin, sessionId, guestId, detail } = await setup();
    await admin.mutation(api.messaging.adminReply.claim, { sessionId, requestId: "pending-settle", content: "Yes" });
    await expect(admin.mutation(chat.settleGuestMessage, { sessionId, messageId: guestId })).rejects.toThrow("reply is pending");
    expect(await detail()).toMatchObject({ inboxState: "processing", inboxReason: "sending" });
    expect((await detail()).settledGuestMessageId).toBeUndefined();
  });

  it("stores Bangkok due times and rejects completion after a concurrent edit", async () => {
    const { admin, sessionId, detail } = await setup();
    const dueAt = resortDateTime("2026-12-02", "00:15");
    expect(new Date(dueAt).toISOString()).toBe("2026-12-01T17:15:00.000Z");
    await admin.mutation(chat.setStaffTask, { sessionId, task: "Review", dueAt, expectedRevision: 0 });
    await admin.mutation(chat.setStaffTask, { sessionId, task: "Check again", dueAt, expectedRevision: 1 });
    await expect(admin.mutation(chat.setStaffTask, { sessionId, task: null, expectedRevision: 1 })).rejects.toThrow("follow-up changed");
    expect(await detail()).toMatchObject({ staffTask: "Check again", staffTaskDueAt: dueAt, staffTaskRevision: 2 });
    await admin.mutation(chat.setStaffTask, { sessionId, task: null, expectedRevision: 2 });
    expect((await detail()).staffTaskDueAt).toBeUndefined();
  });

  it("returns an explicit stay association and withholds contact matches and booking tokens", async () => {
    const { t, admin, outsider, sessionId } = await desk();
    const bookingId = await t.run(async ctx => {
      const propertyId = await ctx.db.insert("properties", {
        name: "Hill Villa", slug: "hill", tagline: "Private stay", description: "Test villa",
        pricePerNight: 100000, currency: "THB", maxGuests: 4, bedrooms: 2, bathrooms: 2,
        area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: "active",
      });
      const common = {
        propertyId, guestName: "Guest", guestPhone: "+66800000000", guestEmail: "guest@example.com",
        checkIn: "2026-12-02", checkOut: "2026-12-05", guests: 2, nights: 3, subtotal: 300000,
        discountAmount: 0, total: 300000, currency: "THB", paymentStatus: "pending", status: "confirmed", createdAt: 1,
      } as const;
      await ctx.db.patch(sessionId, { visitorEmail: common.guestEmail });
      const id = await insertFixture(ctx, "bookings", { ...common, chatSessionId: sessionId, accessToken: "private-token" });
      await insertFixture(ctx, "bookings", common);
      return id;
    });
    expect((await admin.query(chat.getSessionDetail, { sessionId }))?.linkedStay).toEqual({
      bookingId, propertyName: "Hill Villa", checkIn: "2026-12-02", checkOut: "2026-12-05",
    });
    expect(await outsider.query(api.bookings.admin.getForAdmin, { bookingId })).toBeNull();
    expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId: "bad-deep-link" })).toBeNull();
    await t.run(ctx => ctx.db.patch(bookingId, { chatSessionId: undefined }));
    expect((await admin.query(chat.getSessionDetail, { sessionId }))?.linkedStay).toBeNull();
  });

  it("rejects over-limit staff replies and accepts the exact limit", async () => {
    const { admin, sessionId } = await setup();
    const args = { sessionId, requestId: "length-check" };
    const claim = api.messaging.adminReply.claim;
    await expect(admin.mutation(claim, { ...args, content: "a".repeat(1001) })).rejects.toThrow("1 and 1000");
    await expect(admin.mutation(claim, { ...args, content: "a".repeat(1000) })).resolves.toMatchObject({ state: "new" });
  });
});
