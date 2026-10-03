import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import { verifyLineSignature } from "@/lib/line/signature";
import { measureMessagingStage, startMessagingEventMetrics, recordLateMessagingResult, resolveMessagingReply, storedReplyMode, type MessagingClient } from "@/lib/chat/messaging-reply";
import { type LineQuickReplyItem } from "@/lib/line/quick-answers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SITE_URL = "https://tour.helpgueststay.com";

type LineSource = {
  type?: string;
  userId?: string;
};

type LineWebhookEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  message?: {
    id?: string;
    type?: string;
    text?: string;
  };
  postback?: {
    data?: string;
  };
};

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

type LineEventType = "message" | "follow" | "postback" | "unsupported";

type LineReplyMessage = {
  type: "text";
  text: string;
  quickReply?: {
    items: LineQuickReplyItem[];
  };
};

type ClaimedLineEvent = {
  eventId: string;
  sessionId?: string;
  duplicate: boolean;
  status: string;
};

class LineReplyError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`LINE reply failed (${status}): ${body}`);
    this.name = "LineReplyError";
    this.status = status;
  }
}

let convexClient: ConvexHttpClient | null = null;
let convexClientUrl: string | null = null;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === "placeholder") {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or PUBLIC_CONVEX_URL is required");
  }

  if (!convexClient || convexClientUrl !== convexUrl) {
    convexClient = new ConvexHttpClient(convexUrl);
    convexClientUrl = convexUrl;
  }

  return convexClient;
}

function getSiteUrl(request: Request) {
  const configuredUrl =
    process.env.SITE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
    new URL(request.url).origin ||
    DEFAULT_SITE_URL;

  try {
    return new URL(configuredUrl).origin;
  } catch {
    return configuredUrl || DEFAULT_SITE_URL;
  }
}

function classifyLineEvent(event: LineWebhookEvent): LineEventType {
  if (event.type === "message" && event.message?.type === "text") return "message";
  if (event.type === "follow") return "follow";
  if (event.type === "postback") return "postback";
  return "unsupported";
}

function getLineUserId(event: LineWebhookEvent) {
  return event.source?.type === "user" ? event.source.userId : undefined;
}

function getMessageText(event: LineWebhookEvent) {
  return event.message?.type === "text" ? event.message.text?.trim() || undefined : undefined;
}

function getPostbackData(event: LineWebhookEvent) {
  return event.postback?.data?.trim() || undefined;
}

function getEventKey(event: LineWebhookEvent) {
  if (event.webhookEventId) return event.webhookEventId;
  if (event.message?.id) return `message:${event.message.id}`;

  const stablePayload = JSON.stringify({
    source: event.source,
    type: event.type,
    timestamp: event.timestamp,
    message: event.message,
    postback: event.postback,
  });
  return `derived:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

function getUserContent(eventType: LineEventType, event: LineWebhookEvent) {
  if (eventType === "message") return getMessageText(event);
  if (eventType === "postback") return `[LINE postback] ${getPostbackData(event) ?? "unknown"}`;
  if (eventType === "follow") return "[LINE follow]";
  return undefined;
}

function createLineTextMessage(text: string, quickReplyItems: LineQuickReplyItem[]) {
  const message: LineReplyMessage = { type: "text", text };
  if (quickReplyItems.length > 0) {
    message.quickReply = { items: quickReplyItems };
  }
  return message;
}

async function replyToLine({
  accessToken,
  messages,
  replyToken,
}: {
  accessToken: string;
  messages: LineReplyMessage[];
  replyToken: string;
}) {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new LineReplyError(response.status, errorText);
  }

  return response.status;
}

const PROFILE_LOOKUP_TIMEOUT_MS = 1500;

async function fetchLineProfileName(accessToken: string, lineUserId?: string) {
  if (!lineUserId) return undefined;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const profile = (await response.json()) as { displayName?: string };
    return profile.displayName?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function handleLineEvent({
  accessToken,
  client,
  event,
  request,
}: {
  accessToken: string;
  client: ConvexHttpClient;
  event: LineWebhookEvent;
  request: Request;
}) {
  const eventType = classifyLineEvent(event);
  const lineUserId = getLineUserId(event);
  const messageText = getMessageText(event);
  const postbackData = getPostbackData(event);
  const eventKey = getEventKey(event);
  const userContent = getUserContent(eventType, event);

  const turnMetrics = startMessagingEventMetrics("line");
  let claimed: ClaimedLineEvent;
  try {
    claimed = (await measureMessagingStage(turnMetrics, "claim", async () => client.mutation(api.line.claimEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventKey,
      lineUserId,
      profileName: await fetchLineProfileName(accessToken, lineUserId),
      sourceType: event.source?.type,
      eventType,
      messageText,
      postbackData,
      eventTimestamp: event.timestamp,
    } as never))) as ClaimedLineEvent;
  } catch (error) {
    console.error("LINE webhook failed to claim event", {
      eventKey,
      eventType,
      lineUserId,
      error: error instanceof Error ? error.message : "Unknown Convex failure",
    });
    throw error;
  }

  if (claimed.duplicate) return;

  let lineReplyStatus: number | undefined;
  let replyToMessageId: string | undefined;

  try {
    if (claimed.sessionId) {
      const inbound = await client.mutation(api.line.recordInboundEvent, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(userContent ? { userContent } : {}),
      } as never);
      replyToMessageId = (inbound as { userMessageId?: string }).userMessageId;
    }

    if (!event.replyToken || !claimed.sessionId || eventType === "unsupported") {
      await client.mutation(api.line.markEventIgnored, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        reason: !event.replyToken
          ? "Missing LINE reply token"
          : !claimed.sessionId
            ? "Missing direct LINE user id"
            : "Unsupported LINE event type",
      } as never);
      return;
    }
    const replyToken = event.replyToken;

    // Staff took over this chat: the guest message is recorded, no automatic reply.
    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.line.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    const siteUrl = getSiteUrl(request);
    const { responseText, outcome, replyMode, quickReplyItems, timedOut, lateResult } =
      await measureMessagingStage(turnMetrics, "generation", () => resolveMessagingReply(client as unknown as MessagingClient, {
        channel: "line",
        sessionId: claimed.sessionId!,
        ...(replyToMessageId ? { replyToMessageId } : {}),
        siteUrl,
        kind: eventType,
        ...(messageText ? { text: messageText } : {}),
        ...(postbackData ? { postbackData } : {}),
        turnId: turnMetrics.turnId,
      }));

    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.line.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    lineReplyStatus = await measureMessagingStage(turnMetrics, "delivery", () => replyToLine({
      accessToken,
      replyToken,
      messages: [createLineTextMessage(responseText, quickReplyItems ?? [])],
    }));

    // Exactly-once delivery: a late concierge result is recorded, never delivered.
    if (timedOut && lateResult) {
      void recordLateMessagingResult(lateResult, { turnId: turnMetrics.turnId, channel: "line" });
    }

    await client.mutation(api.line.completeEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      ...(userContent ? { userContent } : {}),
      assistantContent: responseText,
      ...(outcome ? { outcome } : {}),
      replyMode: storedReplyMode(replyMode),
      lineReplyStatus,
    } as never);
  } catch (error) {
    const failedLineReplyStatus = error instanceof LineReplyError ? error.status : lineReplyStatus;
    const errorMessage = error instanceof Error ? error.message : "Unknown LINE webhook failure";

    console.error("LINE webhook event failed", {
      eventKey,
      eventType,
      lineUserId,
      lineReplyStatus: failedLineReplyStatus,
      error: errorMessage,
    });

    try {
      await client.mutation(api.line.markEventFailed, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        error: errorMessage,
        ...(typeof failedLineReplyStatus === "number"
          ? { lineReplyStatus: failedLineReplyStatus }
          : {}),
      } as never);
    } catch (markFailedError) {
      console.error("LINE webhook failed to record failure", {
        eventKey,
        eventType,
        lineUserId,
        error: markFailedError instanceof Error ? markFailedError.message : "Unknown Convex failure",
      });
      throw markFailedError;
    }
  }
}

export async function GET() {
  return jsonResponse({
    ok: true,
    webhook: "/api/line/webhook",
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (
    !verifyLineSignature({
      body,
      channelSecret,
      signature: request.headers.get("x-line-signature"),
    })
  ) {
    return jsonResponse({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(body) as LineWebhookBody;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return jsonResponse({ ok: true, processed: 0 });

  const client = getConvexClient();
  for (const event of events) {
    await handleLineEvent({ accessToken, client, event, request });
  }

  return jsonResponse({ ok: true, processed: events.length });
}
