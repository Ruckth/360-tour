import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import { verifyLineSignature } from "@/lib/line/signature";
import {
  resolveLineQuickAnswer,
  type LinePropertySummary,
  type LineQuickReplyItem,
} from "@/lib/line/quick-answers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_REPLY_TIMEOUT_MS = 25_000;
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

type GeneratedReply = {
  response?: string;
  model?: string;
};

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
  return (
    process.env.SITE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
    new URL(request.url).origin ||
    DEFAULT_SITE_URL
  );
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
    throw new Error(`LINE reply failed (${response.status}): ${errorText}`);
  }

  return response.status;
}

function timeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback());
      },
    );
  });
}

function timeoutFallbackReply() {
  return {
    response:
      "I'm checking that for you, but the concierge is taking longer than usual. Please send your villa, dates, and guest count here and the host can help confirm.",
    model: "timeout",
  };
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

  const claimed = (await client.mutation(api.line.claimEvent, {
    eventKey: getEventKey(event),
    lineUserId,
    sourceType: event.source?.type,
    eventType,
    messageText,
    postbackData,
    eventTimestamp: event.timestamp,
  } as never)) as ClaimedLineEvent;

  if (claimed.duplicate) return;

  if (!event.replyToken || !claimed.sessionId || eventType === "unsupported") {
    await client.mutation(api.line.markEventIgnored, {
      eventId: claimed.eventId,
      reason: !event.replyToken
        ? "Missing LINE reply token"
        : !claimed.sessionId
          ? "Missing direct LINE user id"
          : "Unsupported LINE event type",
    } as never);
    return;
  }

  try {
    const siteUrl = getSiteUrl(request);
    const properties = (await client.query(api.properties.list, {})) as LinePropertySummary[];
    const quickAnswer = resolveLineQuickAnswer({
      eventType,
      messageText,
      postbackData,
      properties,
      siteUrl,
    });
    const userContent = getUserContent(eventType, event);
    const generated = quickAnswer
      ? null
      : await timeout(
          client.action(api.chatAi.generateReply, {
            sessionId: claimed.sessionId,
            userMessage: messageText ?? postbackData ?? "LINE message",
            channel: "line",
            siteUrl,
          } as never) as Promise<GeneratedReply>,
          AI_REPLY_TIMEOUT_MS,
          timeoutFallbackReply,
        );
    const responseText = quickAnswer?.text ?? generated?.response ?? timeoutFallbackReply().response;
    const quickReplyItems = quickAnswer?.quickReplyItems ?? [];
    const lineReplyStatus = await replyToLine({
      accessToken,
      replyToken: event.replyToken,
      messages: [createLineTextMessage(responseText, quickReplyItems)],
    });

    await client.mutation(api.line.completeEvent, {
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      userContent,
      assistantContent: responseText,
      replyMode: quickAnswer?.mode ?? (generated?.model === "timeout" ? "failed" : "ai"),
      lineReplyStatus,
    } as never);
  } catch (error) {
    await client.mutation(api.line.markEventFailed, {
      eventId: claimed.eventId,
      error: error instanceof Error ? error.message : "Unknown LINE webhook failure",
    } as never);
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
