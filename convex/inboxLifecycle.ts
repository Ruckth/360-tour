import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { sendFailed } from "./lib/inboxLifecycle";

/** A crashed/timed-out Web generation must not remain “AI is answering” forever. */
export const expireAnswer = internalMutation({
  args: { sessionId: v.id("chatSessions"), messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (
      session?.latestGuestMessageId === args.messageId &&
      session.inboxReason === "answering"
    ) {
      await sendFailed(
        ctx,
        args.sessionId,
        args.messageId,
        "The automatic reply did not finish. A staff reply is needed.",
      );
    }
    return null;
  },
});

export const expireStaffSend = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const attempt = await ctx.db
      .query("adminReplyAttempts")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (!attempt || attempt.status !== "pending") return null;
    const error =
      "Reply confirmation timed out. Check the channel before resending.";
    await sendFailed(
      ctx,
      attempt.sessionId,
      attempt.replyToMessageId,
      error,
      attempt.requestId,
    );
    await ctx.db.patch(attempt._id, {
      status: "failed",
      error,
      completedAt: Date.now(),
    });
    return null;
  },
});
