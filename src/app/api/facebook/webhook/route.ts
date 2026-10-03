import { createHash } from "node:crypto";
import { api } from "convex/_generated/api";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { measureMessagingStage, startMessagingEventMetrics, recordLateMessagingResult, resolveMessagingReply, storedReplyMode } from "@/lib/chat/messaging-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SITE_URL = "https://tour.helpgueststay.com";
const DEFAULT_GRAPH_API_VERSION = "v25.0";

type FacebookMessagingEvent = {
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
    title?: string;
    payload?: string;
  };
};

type FacebookWebhookEntry = {
  id?: string;
  time?: number;
  messaging?: FacebookMessagingEvent[];
};

type FacebookWebhookBody = {
  object?: string;
  entry?: FacebookWebhookEntry[];
};

type FacebookEventType = "message" | "postback" | "unsupported";

type ClaimedFacebookEvent = {
  eventId: string;
  sessionId?: string;
  duplicate: boolean;
  status: string;
};

type FacebookConvexClient = {
  query: (functionReference: unknown, args: unknown) => Promise<unknown>;
  mutation: (functionReference: unknown, args: unknown) => Promise<unknown>;
  action: (functionReference: unknown, args: unknown) => Promise<unknown>;
};

class FacebookReplyError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`Facebook reply failed (${status}): ${body}`);
    this.name = "FacebookReplyError";
    this.status = status;
  }
}

let convexClient: FacebookConvexClient | null = null;
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

async function getConvexClient(): Promise<FacebookConvexClient> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === "placeholder") {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or PUBLIC_CONVEX_URL is required");
  }

  if (!convexClient || convexClientUrl !== convexUrl) {
    const { ConvexHttpClient } = await import("convex/browser");
    convexClient = new ConvexHttpClient(convexUrl) as FacebookConvexClient;
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
  return process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
}

function getFacebookAppSecret() {
  return process.env.FACEBOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || "";
}

function classifyFacebookEvent(event: FacebookMessagingEvent): FacebookEventType {
  if (event.message?.is_echo) return "unsupported";
  if (event.message?.text?.trim()) return "message";
  if (event.postback?.payload?.trim()) return "postback";
  return "unsupported";
}

function getFacebookUserId(event: FacebookMessagingEvent) {
  return event.sender?.id?.trim() || undefined;
}

function getPageId(event: FacebookMessagingEvent) {
  return event.recipient?.id?.trim() || undefined;
}

function getMessageText(event: FacebookMessagingEvent) {
  return event.message?.text?.trim() || undefined;
}

function getPostbackData(event: FacebookMessagingEvent) {
  return event.postback?.payload?.trim() || undefined;
}

function getEventKey(event: FacebookMessagingEvent) {
  if (event.message?.mid) return `message:${event.message.mid}`;

  const stablePayload = JSON.stringify({
    sender: event.sender,
    recipient: event.recipient,
    timestamp: event.timestamp,
    message: event.message,
    postback: event.postback,
  });
  return `derived:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

function getUserContent(eventType: FacebookEventType, event: FacebookMessagingEvent) {
  if (eventType === "message") return getMessageText(event);
  if (eventType === "postback") return `[Facebook postback] ${getPostbackData(event) ?? "unknown"}`;
  return undefined;
}

const PROFILE_LOOKUP_TIMEOUT_MS = 1500;

async function fetchFacebookProfileName(accessToken: string, facebookUserId: string) {
  const url = new URL(`https://graph.facebook.com/${getGraphApiVersion()}/${encodeURIComponent(facebookUserId)}`);
  url.searchParams.set("fields", "name,first_name,last_name");
  url.searchParams.set("access_token", accessToken);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROFILE_LOOKUP_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const profile = (await response.json()) as { name?: string; first_name?: string; last_name?: string };
    const name = profile.name ?? [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    return name.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function sendFacebookTextMessage({
  accessToken,
  recipientId,
  text,
}: {
  accessToken: string;
  recipientId: string;
  text: string;
}) {
  const version = getGraphApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/me/messages`);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new FacebookReplyError(response.status, errorText);
  }

  return response.status;
}

async function handleFacebookEvent({
  accessToken,
  client,
  event,
  request,
}: {
  accessToken: string;
  client: FacebookConvexClient;
  event: FacebookMessagingEvent;
  request: Request;
}) {
  const eventType = classifyFacebookEvent(event);
  const facebookUserId = getFacebookUserId(event);
  const pageId = getPageId(event);
  const messageText = getMessageText(event);
  const postbackData = getPostbackData(event);
  const eventKey = getEventKey(event);
  const userContent = getUserContent(eventType, event);

  if (!facebookUserId || eventType === "unsupported") return;

  const turnMetrics = startMessagingEventMetrics("facebook");
  let claimed: ClaimedFacebookEvent;
  try {
    claimed = (await measureMessagingStage(turnMetrics, "claim", async () => client.mutation(api.facebook.claimEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventKey,
      facebookUserId,
      profileName: await fetchFacebookProfileName(accessToken, facebookUserId),
      pageId,
      eventType,
      messageText,
      postbackData,
      eventTimestamp: event.timestamp,
    } as never))) as ClaimedFacebookEvent;
  } catch (error) {
    console.error("Facebook webhook failed to claim event", {
      eventKey,
      eventType,
      facebookUserId,
      error: error instanceof Error ? error.message : "Unknown Convex failure",
    });
    throw error;
  }

  if (claimed.duplicate) return;

  let facebookReplyStatus: number | undefined;
  let replyToMessageId: string | undefined;

  try {
    if (claimed.sessionId) {
      const inbound = await client.mutation(api.facebook.recordInboundEvent, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(userContent ? { userContent } : {}),
      } as never);
      replyToMessageId = (inbound as { userMessageId?: string }).userMessageId;
    }

    if (!claimed.sessionId) {
      await client.mutation(api.facebook.markEventIgnored, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        reason: "Missing Facebook sender id",
      } as never);
      return;
    }

    // Staff took over this chat: the guest message is recorded, no automatic reply.
    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.facebook.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    const { responseText, outcome, replyMode, timedOut, lateResult } = await measureMessagingStage(turnMetrics, "generation", () => resolveMessagingReply(client, {
      channel: "facebook",
      sessionId: claimed.sessionId!,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      siteUrl: getSiteUrl(request),
      kind: eventType,
      ...(messageText ? { text: messageText } : {}),
      ...(postbackData ? { postbackData } : {}),
      turnId: turnMetrics.turnId,
    }));

    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.facebook.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    facebookReplyStatus = await measureMessagingStage(turnMetrics, "delivery", () => sendFacebookTextMessage({
      accessToken,
      recipientId: facebookUserId,
      text: responseText,
    }));

    // Exactly-once delivery: a late concierge result is recorded, never delivered.
    if (timedOut && lateResult) {
      void recordLateMessagingResult(lateResult, { turnId: turnMetrics.turnId, channel: "facebook" });
    }

    await client.mutation(api.facebook.completeEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      ...(userContent ? { userContent } : {}),
      assistantContent: responseText,
      ...(outcome ? { outcome } : {}),
      replyMode: storedReplyMode(replyMode),
      facebookReplyStatus,
    } as never);
  } catch (error) {
    const failedFacebookReplyStatus =
      error instanceof FacebookReplyError ? error.status : facebookReplyStatus;
    const errorMessage = error instanceof Error ? error.message : "Unknown Facebook webhook failure";

    console.error("Facebook webhook event failed", {
      eventKey,
      eventType,
      facebookUserId,
      facebookReplyStatus: failedFacebookReplyStatus,
      error: errorMessage,
    });

    try {
      await client.mutation(api.facebook.markEventFailed, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        error: errorMessage,
        ...(typeof failedFacebookReplyStatus === "number"
          ? { facebookReplyStatus: failedFacebookReplyStatus }
          : {}),
      } as never);
    } catch (markFailedError) {
      console.error("Facebook webhook failed to record failure", {
        eventKey,
        eventType,
        facebookUserId,
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
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN?.trim() || "";

  if (!verifyToken) {
    return jsonResponse(
      { ok: false, error: "FACEBOOK_VERIFY_TOKEN is required" },
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
  const appSecret = getFacebookAppSecret();
  if (!appSecret) {
    return jsonResponse(
      { ok: false, error: "FACEBOOK_APP_SECRET or META_APP_SECRET is required" },
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
    return jsonResponse({ ok: false, error: "Invalid Facebook signature" }, { status: 401 });
  }

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "FACEBOOK_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: FacebookWebhookBody;
  try {
    payload = JSON.parse(body) as FacebookWebhookBody;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.object !== "page") {
    return jsonResponse({ ok: false, error: "Unsupported Facebook webhook object" }, { status: 404 });
  }

  const events = payload.entry?.flatMap((entry) => entry.messaging ?? []) ?? [];
  if (events.length === 0) return jsonResponse({ ok: true, processed: 0 });

  const client = await getConvexClient();
  let processed = 0;
  for (const event of events) {
    await handleFacebookEvent({ accessToken, client, event, request });
    processed += 1;
  }

  return jsonResponse({ ok: true, processed });
}
