import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { deliverAdminReply } from "@/lib/admin/reply-delivery";

export const runtime = "nodejs";

const MAX_REPLY_LENGTH = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    return Response.json({ error: "Admin sign-in is required" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid reply request" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Invalid reply request" }, { status: 400 });
  }
  const { sessionId, requestId, content } = payload as Record<string, unknown>;
  if (
    typeof sessionId !== "string" ||
    typeof requestId !== "string" ||
    !UUID_PATTERN.test(requestId) ||
    typeof content !== "string" ||
    content.trim().length < 1 ||
    content.trim().length > MAX_REPLY_LENGTH
  ) {
    return Response.json(
      { error: `Reply must be between 1 and ${MAX_REPLY_LENGTH} characters` },
      { status: 400 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json({ error: "Chat service is unavailable" }, { status: 503 });
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  let claimed = false;
  let delivered = false;
  try {
    const reply = await client.mutation(api.adminReply.claim, {
      sessionId: sessionId as Id<"chatSessions">,
      requestId,
      content,
    });
    if (reply.state === "sent") return Response.json({ ok: true, channel: reply.channel });
    if (reply.state !== "new") {
      return Response.json(
        { error: "This reply was already attempted. Check the transcript before sending again." },
        { status: 409 },
      );
    }
    claimed = true;
    await deliverAdminReply({
      channel: reply.channel,
      recipient: reply.recipient,
      content: content.trim(),
      requestId,
    });
    delivered = true;
    await client.mutation(api.adminReply.complete, { requestId });
    return Response.json({ ok: true, channel: reply.channel });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send reply";
    if (claimed && !delivered) {
      await client.mutation(api.adminReply.fail, { requestId, error: message }).catch(() => null);
    }
    return Response.json(
      {
        error: delivered
          ? "The channel accepted the reply, but the transcript did not update. Check before resending."
          : message,
      },
      { status: claimed ? 502 : 403 },
    );
  }
}
