import { createHash } from "node:crypto";
import { api } from "convex/_generated/api";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { measureMessagingStage, startMessagingEventMetrics, recordLateMessagingResult, resolveMessagingReply, storedReplyMode } from "@/lib/chat/messaging-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SITE_URL = "https://tour.helpgueststay.com";
const DEFAULT_GRAPH_API_VERSION = "v25.0";

type InstagramMessagingEvent = {
  sender?: {
    id?: string;
  };
  recipient?: {
    id?: string;
  };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
  };
  postback?: {
    mid?: string;
    title?: string;
    payload?: string;
  };
};

type InstagramWebhookEntry = {
  id?: string;
  time?: number;
  messaging?: InstagramMessagingEvent[];
};

type InstagramWebhookBody = {
  object?: string;
  entry?: InstagramWebhookEntry[];
};

type InstagramEventType = "message" | "postback" | "unsupported";

type ClaimedInstagramEvent = {
  eventId: string;
  sessionId?: string;
  duplicate: boolean;
  status: string;
};

type InstagramConvexClient = {
  query: (functionReference: unknown, args: unknown) => Promise<unknown>;
  mutation: (functionReference: unknown, args: unknown) => Promise<unknown>;
  action: (functionReference: unknown, args: unknown) => Promise<unknown>;
};

class InstagramReplyError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`Instagram reply failed (${status}): ${body}`);
    this.name = "InstagramReplyError";
    this.status = status;
  }
}

let convexClient: InstagramConvexClient | null = null;
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

function getTextParam(request: Request, key: string) {
  return new URL(request.url).searchParams.get(key)?.trim() ?? "";
}

async function getConvexClient(): Promise<InstagramConvexClient> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === "placeholder") {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or PUBLIC_CONVEX_URL is required");
  }

  if (!convexClient || convexClientUrl !== convexUrl) {
    const { ConvexHttpClient } = await import("convex/browser");
    convexClient = new ConvexHttpClient(convexUrl) as InstagramConvexClient;
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

function getGraphApiVersion() {
  return process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
}

function getInstagramAppSecret() {
  return process.env.INSTAGRAM_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || "";
}

function classifyInstagramEvent(event: InstagramMessagingEvent): InstagramEventType {
  if (event.message?.is_echo) return "unsupported";
  if (event.message?.text?.trim()) return "message";
  if (event.postback?.payload?.trim()) return "postback";
  return "unsupported";
}

function getInstagramUserId(event: InstagramMessagingEvent) {
  return event.sender?.id?.trim() || undefined;
}

function getInstagramAccountId(event: InstagramMessagingEvent) {
  return event.recipient?.id?.trim() || undefined;
}

function getMessageText(event: InstagramMessagingEvent) {
  return event.message?.text?.trim() || undefined;
}

function getPostbackData(event: InstagramMessagingEvent) {
  return event.postback?.payload?.trim() || undefined;
}

function getEventKey(event: InstagramMessagingEvent) {
  if (event.message?.mid) return `message:${event.message.mid}`;
  if (event.postback?.mid) return `postback:${event.postback.mid}`;

  const stablePayload = JSON.stringify({
    sender: event.sender,
    recipient: event.recipient,
    timestamp: event.timestamp,
    message: event.message,
    postback: event.postback,
  });
  return `derived:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

function getUserContent(eventType: InstagramEventType, event: InstagramMessagingEvent) {
  if (eventType === "message") return getMessageText(event);
  if (eventType === "postback") return `[Instagram postback] ${getPostbackData(event) ?? "unknown"}`;
  return undefined;
}

const PROFILE_LOOKUP_TIMEOUT_MS = 1500;

async function fetchInstagramProfileName(accessToken: string, instagramUserId: string) {
  const url = new URL(`https://graph.instagram.com/${getGraphApiVersion()}/${encodeURIComponent(instagramUserId)}`);
  url.searchParams.set("fields", "name,username");
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const profile = (await response.json()) as { name?: string; username?: string };
    return profile.name?.trim() || profile.username?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function sendInstagramTextMessage({
  accessToken,
  recipientId,
  text,
}: {
  accessToken: string;
  recipientId: string;
  text: string;
}) {
  const version = getGraphApiVersion();
  const response = await fetch(`https://graph.instagram.com/${version}/me/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InstagramReplyError(response.status, errorText);
  }

  return response.status;
}

async function handleInstagramEvent({
  accessToken,
  client,
  event,
  request,
}: {
  accessToken: string;
  client: InstagramConvexClient;
  event: InstagramMessagingEvent;
  request: Request;
}) {
  const eventType = classifyInstagramEvent(event);
  const instagramUserId = getInstagramUserId(event);
  const instagramAccountId = getInstagramAccountId(event);
  const messageText = getMessageText(event);
  const postbackData = getPostbackData(event);
  const eventKey = getEventKey(event);
  const userContent = getUserContent(eventType, event);

  if (!instagramUserId || eventType === "unsupported") return;

  const turnMetrics = startMessagingEventMetrics("instagram");
  let claimed: ClaimedInstagramEvent;
  try {
    claimed = (await measureMessagingStage(turnMetrics, "claim", async () => client.mutation(api.instagram.claimEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventKey,
      instagramUserId,
      profileName: await fetchInstagramProfileName(accessToken, instagramUserId),
      instagramAccountId,
      eventType,
      messageText,
      postbackData,
      eventTimestamp: event.timestamp,
    } as never))) as ClaimedInstagramEvent;
  } catch (error) {
    console.error("Instagram webhook failed to claim event", {
      eventKey,
      eventType,
      instagramUserId,
      error: error instanceof Error ? error.message : "Unknown Convex failure",
    });
    throw error;
  }

  if (claimed.duplicate) return;

  let instagramReplyStatus: number | undefined;
  let replyToMessageId: string | undefined;

  try {
    if (claimed.sessionId) {
      const inbound = await client.mutation(api.instagram.recordInboundEvent, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(userContent ? { userContent } : {}),
      } as never);
      replyToMessageId = (inbound as { userMessageId?: string }).userMessageId;
    }

    if (!claimed.sessionId) {
      await client.mutation(api.instagram.markEventIgnored, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        reason: "Missing Instagram sender id",
      } as never);
      return;
    }

    // Staff took over this chat: the guest message is recorded, no automatic reply.
    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.instagram.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    const { responseText, outcome, replyMode, timedOut, lateResult } = await measureMessagingStage(turnMetrics, "generation", () => resolveMessagingReply(client, {
      channel: "instagram",
      sessionId: claimed.sessionId!,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      siteUrl: getSiteUrl(request),
      kind: eventType,
      ...(messageText ? { text: messageText } : {}),
      ...(postbackData ? { postbackData } : {}),
      turnId: turnMetrics.turnId,
    }));

    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.instagram.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    instagramReplyStatus = await measureMessagingStage(turnMetrics, "delivery", () => sendInstagramTextMessage({
      accessToken,
      recipientId: instagramUserId,
      text: responseText,
    }));

    // Exactly-once delivery: a late concierge result is recorded, never delivered.
    if (timedOut && lateResult) {
      void recordLateMessagingResult(lateResult, { turnId: turnMetrics.turnId, channel: "instagram" });
    }

    await client.mutation(api.instagram.completeEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      ...(userContent ? { userContent } : {}),
      assistantContent: responseText,
      ...(outcome ? { outcome } : {}),
      replyMode: storedReplyMode(replyMode),
      instagramReplyStatus,
    } as never);
  } catch (error) {
    const failedInstagramReplyStatus =
      error instanceof InstagramReplyError ? error.status : instagramReplyStatus;
    const errorMessage = error instanceof Error ? error.message : "Unknown Instagram webhook failure";

    console.error("Instagram webhook event failed", {
      eventKey,
      eventType,
      instagramUserId,
      instagramReplyStatus: failedInstagramReplyStatus,
      error: errorMessage,
    });

    try {
      await client.mutation(api.instagram.markEventFailed, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        error: errorMessage,
        ...(typeof failedInstagramReplyStatus === "number"
          ? { instagramReplyStatus: failedInstagramReplyStatus }
          : {}),
      } as never);
    } catch (markFailedError) {
      console.error("Instagram webhook failed to record failure", {
        eventKey,
        eventType,
        instagramUserId,
        error: markFailedError instanceof Error ? markFailedError.message : "Unknown Convex failure",
      });
      throw markFailedError;
    }
  }
}

export async function GET(request: Request) {
  const mode = getTextParam(request, "hub.mode");
  const token = getTextParam(request, "hub.verify_token");
  const challenge = getTextParam(request, "hub.challenge");
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN?.trim() || "";

  if (!verifyToken) {
    return jsonResponse(
      { ok: false, error: "INSTAGRAM_VERIFY_TOKEN is required" },
      { status: 500 },
    );
  }

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return jsonResponse({ ok: false, error: "Invalid verification token" }, { status: 403 });
}

export async function POST(request: Request) {
  const body = await request.text();
  const appSecret = getInstagramAppSecret();
  if (!appSecret) {
    return jsonResponse(
      { ok: false, error: "INSTAGRAM_APP_SECRET or META_APP_SECRET is required" },
      { status: 500 },
    );
  }
  if (
    !verifyMetaSignature({
      appSecret,
      body,
      signature: request.headers.get("x-hub-signature-256"),
    })
  ) {
    return jsonResponse({ ok: false, error: "Invalid Instagram signature" }, { status: 401 });
  }

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "INSTAGRAM_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: InstagramWebhookBody;
  try {
    payload = JSON.parse(body) as InstagramWebhookBody;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.object !== "instagram") {
    return jsonResponse({ ok: false, error: "Unsupported Instagram webhook object" }, { status: 404 });
  }

  const events = payload.entry?.flatMap((entry) => entry.messaging ?? []) ?? [];
  if (events.length === 0) return jsonResponse({ ok: true, processed: 0 });

  const client = await getConvexClient();
  let processed = 0;
  for (const event of events) {
    await handleInstagramEvent({ accessToken, client, event, request });
    processed += 1;
  }

  return jsonResponse({ ok: true, processed });
}
