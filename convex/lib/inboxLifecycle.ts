import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const replyOutcomeValidator = v.union(
  v.literal("answered"),
  v.literal("awaiting_guest"),
  v.literal("needs_staff"),
);
export type ReplyOutcome = "answered" | "awaiting_guest" | "needs_staff";

/** Old rows retain their existing manual lifecycle until the reviewed backfill runs. */
export function inboxNeedsStaff(
  session: Doc<"chatSessions">,
  latest: Doc<"chatMessages"> | null,
) {
  if (session.inboxState) return session.inboxState === "needs_staff";
  return (
    latest?.role === "user" && latest._id !== session.settledGuestMessageId
  );
}

export async function latestGuestId(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"chatSessions">,
) {
  if (session.latestGuestMessageId) return session.latestGuestMessageId;
  const recent = await ctx.db
    .query("chatMessages")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .order("desc")
    .take(100);
  return recent.find((message) => message.role === "user")?._id;
}

export async function guestReceived(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
  messageId: Id<"chatMessages">,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.latestGuestMessageId === messageId) return;
  const needsStaff = !!(session.aiPaused || session.inboxHandoff);
  await ctx.db.patch(sessionId, {
    latestGuestMessageId: messageId,
    adminStatus: undefined,
    resolvedAt: undefined,
    archivedAt: undefined,
    inboxState: needsStaff ? "needs_staff" : "processing",
    inboxReason: needsStaff ? "staff_reply" : "answering",
    resolutionSource: undefined,
    resolutionMessageId: undefined,
    inboxSendError: undefined,
  });
  if (!needsStaff)
    await ctx.scheduler.runAfter(60_000, internal.inboxLifecycle.expireAnswer, {
      sessionId,
      messageId,
    });
}

export async function staffNeeded(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
  replyToMessageId?: Id<"chatMessages">,
) {
  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    session.inboxState === "done" ||
    session.adminStatus === "archived" ||
    (replyToMessageId && session.latestGuestMessageId !== replyToMessageId)
  )
    return false;
  await ctx.db.patch(sessionId, {
    adminStatus: undefined,
    resolvedAt: undefined,
    archivedAt: undefined,
    inboxState: "needs_staff",
    inboxReason: "handoff",
    inboxHandoff: true,
  });
  return true;
}

/** Provider acceptance / durable Web message, not generation or transcript insertion alone. */
export async function answerAccepted(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"chatSessions">;
    replyToMessageId?: Id<"chatMessages">;
    messageId?: Id<"chatMessages">;
    source: "ai" | "staff";
    outcome: ReplyOutcome;
    requestId?: string;
  },
) {
  const session = await ctx.db.get(args.sessionId);
  if (!session) return;
  if (
    session.adminStatus === "archived" ||
    (args.source === "ai" &&
      (session.aiPaused || session.inboxState === "done"))
  )
    return;
  const latest = await latestGuestId(ctx, session);
  // A late reply cannot close or otherwise overwrite the work on a newer question.
  if (latest !== args.replyToMessageId) return;
  if (args.requestId && args.requestId !== session.inboxSendRequestId) return;
  const handoff =
    args.outcome === "needs_staff" ||
    (args.source === "ai" && session.inboxHandoff);
  const task = session.staffTask;
  const done = !handoff && !task;
  await ctx.db.patch(args.sessionId, {
    answeredGuestMessageId: args.replyToMessageId,
    inboxState: handoff ? "needs_staff" : task ? "processing" : "done",
    inboxReason: handoff ? "handoff" : task ? "follow_up" : args.outcome,
    inboxHandoff: handoff ? true : undefined,
    inboxSendError: undefined,
    adminStatus: done ? "resolved" : undefined,
    resolvedAt: done ? Date.now() : undefined,
    archivedAt: undefined,
    resolutionSource: done ? args.source : undefined,
    resolutionMessageId: done ? args.messageId : undefined,
    aiPaused: done ? (session.keepWithStaff ? true : undefined) : true,
    assignedAdminEmail:
      done && !session.keepWithStaff ? undefined : session.assignedAdminEmail,
  });
}

export async function sendFailed(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
  replyToMessageId: Id<"chatMessages"> | undefined,
  error: string,
  requestId?: string,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || (await latestGuestId(ctx, session)) !== replyToMessageId)
    return;
  if (session.inboxState === "done" || session.adminStatus === "archived")
    return;
  if (
    !requestId &&
    (session.answeredGuestMessageId === replyToMessageId ||
      session.inboxReason === "sending")
  )
    return;
  if (requestId && session.inboxSendRequestId !== requestId) return;
  await ctx.db.patch(sessionId, {
    inboxState: "needs_staff",
    inboxReason: "send_failed",
    inboxSendError: error.slice(0, 300),
    adminStatus: undefined,
    resolvedAt: undefined,
    resolutionSource: undefined,
    aiPaused: true,
  });
}

export async function finishWithoutReply(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found");
  await ctx.db.patch(sessionId, {
    answeredGuestMessageId: await latestGuestId(ctx, session),
    inboxState: "done",
    inboxReason: "no_reply_needed",
    inboxHandoff: undefined,
    staffTask: undefined,
    adminStatus: "resolved",
    resolvedAt: Date.now(),
    archivedAt: undefined,
    resolutionSource: "manual",
    inboxSendError: undefined,
    inboxSendRequestId: undefined,
    aiPaused: session.keepWithStaff ? true : undefined,
    assignedAdminEmail: session.keepWithStaff
      ? session.assignedAdminEmail
      : undefined,
  });
}

/** Explicit ownership changes may not bypass a pending send, follow-up or handoff. */
export async function changeStaffOwnership(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
  email: string,
  args: { paused?: boolean; keep?: boolean },
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found");
  const keep = args.keep ?? session.keepWithStaff;
  const blocked = !!(
    session.staffTask ||
    session.inboxHandoff ||
    session.inboxReason === "sending" ||
    keep
  );
  if (args.paused === false && blocked)
    throw new Error(
      "Complete the follow-up, handoff or pending reply and release Keep with staff before resuming AI.",
    );
  const paused =
    args.paused ??
    (blocked || (session.inboxState !== "done" && !!session.aiPaused));
  const needsReply =
    paused &&
    session.inboxState !== "done" &&
    !session.staffTask &&
    !session.inboxHandoff &&
    session.inboxReason !== "sending" &&
    session.inboxReason !== "send_failed";
  await ctx.db.patch(sessionId, {
    keepWithStaff: keep ? true : undefined,
    aiPaused: paused ? true : undefined,
    assignedAdminEmail: paused ? email : undefined,
    ...(needsReply
      ? {
          inboxState: "needs_staff" as const,
          inboxReason: "staff_reply" as const,
        }
      : {}),
  });
}
