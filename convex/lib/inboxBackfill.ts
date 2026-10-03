import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Legacy text has no outcome evidence. Preserve manual Done; review every open conversation. */
export async function inboxBackfillPatch(
  ctx: Pick<QueryCtx, "db">,
  session: Doc<"chatSessions">,
) {
  if (session.inboxState) return null;
  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .order("desc")
    .take(100);
  const latest = messages[0];
  const guest = messages.find((message) => message.role === "user");
  if (!latest) return null; // Legacy embedded transcripts must migrate first.
  if (
    session.adminStatus === "resolved" ||
    session.adminStatus === "archived"
  ) {
    return {
      latestGuestMessageId: guest?._id,
      answeredGuestMessageId: guest?._id,
      inboxState: "done" as const,
      inboxReason: "manual" as const,
      resolutionSource: "manual" as const,
    };
  }
  let eventFailed = false;
  if (session.channel !== "web") {
    const table =
      session.channel === "line"
        ? "lineWebhookEvents"
        : session.channel === "facebook"
          ? "facebookWebhookEvents"
          : session.channel === "whatsapp"
            ? "whatsappWebhookEvents"
            : "instagramWebhookEvents";
    const event = await ctx.db
      .query(table)
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .first();
    eventFailed = event?.status === "failed";
  }
  return {
    latestGuestMessageId: guest?._id,
    inboxState: "needs_staff" as const,
    inboxReason: eventFailed
      ? ("send_failed" as const)
      : ("review_required" as const),
    aiPaused: true,
    adminStatus: undefined,
    resolvedAt: undefined,
  };
}
