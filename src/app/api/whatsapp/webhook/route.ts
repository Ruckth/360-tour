import { createHash } from "node:crypto";
import { api } from "convex/_generated/api";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { resolveWhatsAppReply, type WhatsAppConvexClient } from "@/lib/whatsapp/reply";
import { measureMessagingStage, startMessagingEventMetrics, recordLateMessagingResult, storedReplyMode } from "@/lib/chat/messaging-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SITE_URL = "https://tour.helpgueststay.com";
const DEFAULT_GRAPH_API_VERSION = "v25.0";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
};

type WhatsAppStatus = {
  id?: string;
  recipient_id?: string;
  status?: string;
  timestamp?: string;
};

type WhatsAppContact = {
  wa_id?: string;
  profile?: {
    name?: string;
  };
};

type WhatsAppChange = {
  field?: string;
  value?: {
    messaging_product?: string;
    metadata?: {
      display_phone_number?: string;
      phone_number_id?: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
  };
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: WhatsAppChange[];
  }>;
};

type WhatsAppEventType = "message" | "unsupported";

type ClaimedWhatsAppEvent = {
  eventId: string;
  sessionId?: string;
  duplicate: boolean;
  status: string;
};

class WhatsAppReplyError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`WhatsApp reply failed (${status}): ${body}`);
    this.name = "WhatsAppReplyError";
    this.status = status;
  }
}

let convexClient: WhatsAppConvexClient | null = null;
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

async function getConvexClient(): Promise<WhatsAppConvexClient> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === "placeholder") {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or PUBLIC_CONVEX_URL is required");
  }

  if (!convexClient || convexClientUrl !== convexUrl) {
    const { ConvexHttpClient } = await import("convex/browser");
    convexClient = new ConvexHttpClient(convexUrl) as WhatsAppConvexClient;
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
  return process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
}

function getWhatsAppAppSecret() {
  return process.env.WHATSAPP_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || "";
}

function classifyWhatsAppMessage(message: WhatsAppMessage): WhatsAppEventType {
  if (message.type === "text" && message.text?.body?.trim()) return "message";
  return "unsupported";
}

function getMessageText(message: WhatsAppMessage) {
  return message.text?.body?.trim() || undefined;
}

function getEventKey(message: WhatsAppMessage) {
  if (message.id) return `message:${message.id}`;

  const stablePayload = JSON.stringify({
    from: message.from,
    timestamp: message.timestamp,
    type: message.type,
    text: message.text,
  });
  return `derived:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

function parseWhatsAppTimestamp(timestamp?: string) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function contactForMessage(change: WhatsAppChange, message: WhatsAppMessage) {
  const contacts = change.value?.contacts ?? [];
  return contacts.find((contact) => contact.wa_id === message.from) ?? contacts[0];
}

async function sendWhatsAppTextMessage({
  accessToken,
  phoneNumberId,
  recipientId,
  text,
}: {
  accessToken: string;
  phoneNumberId: string;
  recipientId: string;
  text: string;
}) {
  const version = getGraphApiVersion();
  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipientId,
        type: "text",
        text: {
          preview_url: true,
          body: text,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new WhatsAppReplyError(response.status, errorText);
  }

  return response.status;
}

async function handleWhatsAppMessage({
  accessToken,
  change,
  client,
  message,
  request,
}: {
  accessToken: string;
  change: WhatsAppChange;
  client: WhatsAppConvexClient;
  message: WhatsAppMessage;
  request: Request;
}) {
  const eventType = classifyWhatsAppMessage(message);
  const whatsappUserId = message.from?.trim();
  const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
  const contact = contactForMessage(change, message);
  const profileName = contact?.profile?.name?.trim();
  const messageText = getMessageText(message);
  const eventKey = getEventKey(message);
  const eventTimestamp = parseWhatsAppTimestamp(message.timestamp);

  if (!whatsappUserId) return;

  const turnMetrics = startMessagingEventMetrics("whatsapp");
  let claimed: ClaimedWhatsAppEvent;
  try {
    claimed = (await measureMessagingStage(turnMetrics, "claim", async () => client.mutation(api.whatsapp.claimEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventKey,
      whatsappUserId,
      profileName,
      phoneNumberId,
      eventType,
      messageText,
      eventTimestamp,
    } as never))) as ClaimedWhatsAppEvent;
  } catch (error) {
    console.error("WhatsApp webhook failed to claim event", {
      eventKey,
      eventType,
      whatsappUserId,
      error: error instanceof Error ? error.message : "Unknown Convex failure",
    });
    throw error;
  }

  if (claimed.duplicate) return;

  let whatsappReplyStatus: number | undefined;

  try {
    if (claimed.sessionId) {
      await client.mutation(api.whatsapp.recordInboundEvent, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(messageText ? { userContent: messageText } : {}),
      } as never);
    }

    if (!claimed.sessionId) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        reason: "Missing WhatsApp sender id",
      } as never);
      return;
    }

    // Staff took over this chat: the guest message is recorded, no automatic reply.
    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    if (eventType === "unsupported" || !messageText) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        reason: `Unsupported WhatsApp message type: ${message.type ?? "unknown"}`,
      } as never);
      return;
    }

    const { responseText, replyMode, timedOut, lateResult } = await measureMessagingStage(turnMetrics, "generation", () => resolveWhatsAppReply({
      client,
      messageText,
      sessionId: claimed.sessionId!,
      siteUrl: getSiteUrl(request),
      turnId: turnMetrics.turnId,
    }));

    if (await client.query(api.chat.isAiPaused, { sessionId: claimed.sessionId } as never)) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "AI paused: staff is replying",
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      } as never);
      return;
    }

    whatsappReplyStatus = await measureMessagingStage(turnMetrics, "delivery", () => sendWhatsAppTextMessage({
      accessToken,
      phoneNumberId: phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
      recipientId: whatsappUserId,
      text: responseText,
    }));

    await client.mutation(api.whatsapp.completeEvent, {
      serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      userContent: messageText,
      assistantContent: responseText,
      replyMode: storedReplyMode(replyMode),
      whatsappReplyStatus,
    } as never);

    // Exactly-once delivery: a late concierge result (after the outer timeout) is RECORDED,
    // never delivered. We only note its model/committed outcome — no guest-derived text.
    if (timedOut && lateResult) {
      void recordLateMessagingResult(lateResult, { turnId: turnMetrics.turnId, channel: "whatsapp" });
    }
  } catch (error) {
    const failedWhatsAppReplyStatus =
      error instanceof WhatsAppReplyError ? error.status : whatsappReplyStatus;
    const errorMessage = error instanceof Error ? error.message : "Unknown WhatsApp webhook failure";

    console.error("WhatsApp webhook event failed", {
      eventKey,
      eventType,
      whatsappUserId,
      whatsappReplyStatus: failedWhatsAppReplyStatus,
      error: errorMessage,
    });

    try {
      await client.mutation(api.whatsapp.markEventFailed, {
        serverSecret: process.env.CONVEX_SERVER_SECRET ?? "",
        eventId: claimed.eventId,
        error: errorMessage,
        ...(typeof failedWhatsAppReplyStatus === "number"
          ? { whatsappReplyStatus: failedWhatsAppReplyStatus }
          : {}),
      } as never);
    } catch (markFailedError) {
      console.error("WhatsApp webhook failed to record failure", {
        eventKey,
        eventType,
        whatsappUserId,
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
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";

  if (!verifyToken) {
    return jsonResponse(
      { ok: false, error: "WHATSAPP_VERIFY_TOKEN is required" },
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
  const appSecret = getWhatsAppAppSecret();
  if (!appSecret) {
    return jsonResponse(
      { ok: false, error: "WHATSAPP_APP_SECRET or META_APP_SECRET is required" },
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
    return jsonResponse({ ok: false, error: "Invalid WhatsApp signature" }, { status: 401 });
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "WHATSAPP_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: WhatsAppWebhookBody;
  try {
    payload = JSON.parse(body) as WhatsAppWebhookBody;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") {
    return jsonResponse({ ok: false, error: "Unsupported WhatsApp webhook object" }, { status: 404 });
  }

  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
  const messages = changes.flatMap((change) =>
    (change.value?.messages ?? []).map((message) => ({ change, message })),
  );
  const statuses = changes.flatMap((change) => change.value?.statuses ?? []);

  if (statuses.length > 0) {
    console.log("WhatsApp status webhook received", {
      statuses: statuses.map((status) => ({
        id: status.id,
        recipientId: status.recipient_id,
        status: status.status,
      })),
    });
  }

  if (messages.length === 0) {
    return jsonResponse({ ok: true, processed: 0, statuses: statuses.length });
  }

  const client = await getConvexClient();
  let processed = 0;
  for (const { change, message } of messages) {
    await handleWhatsAppMessage({ accessToken, change, client, message, request });
    processed += 1;
  }

  return jsonResponse({ ok: true, processed, statuses: statuses.length });
}
