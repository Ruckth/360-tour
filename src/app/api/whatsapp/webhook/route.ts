import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import {
  detectQuickAnswerLocale,
  localizedTimeoutFallbackReply,
  localizedUnknownFallbackReply,
  resolveLineQuickAnswer,
  type LinePropertySummary,
} from "@/lib/line/quick-answers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_REPLY_TIMEOUT_MS = 25_000;
const GUARDRAIL_REPLY_TIMEOUT_MS = 3_000;
const QUESTION_BANK_SEMANTIC_TIMEOUT_MS = 8_000;
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

type GeneratedReply = {
  response?: string;
  model?: string;
};

type QuestionBankMatch = {
  source: "exact" | "semantic";
  suggestionId: string;
  question: string;
  answer?: string;
  answerMode: "static" | "dynamic";
  dynamicIntent?: "availability" | "pricing" | "property_details" | "booking_help" | "contact";
  topic: string;
};

type ApprovedKnowledgeMatch = {
  source: "approved_exact";
  answerId: string;
  questionId: string;
  title: string;
  answer: string;
  questionText: string;
  normalizedQuestion: string;
  propertyId?: string;
};

type WhatsAppEventReplyMode =
  | "exact"
  | "approved_exact"
  | "question_bank_exact"
  | "question_bank_semantic"
  | "ai"
  | "unknown_fallback"
  | "failed";

type ResolvedWhatsAppReply = {
  responseText: string;
  replyMode: WhatsAppEventReplyMode;
  questionBankMatch: QuestionBankMatch | null;
};

class WhatsAppReplyError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`WhatsApp reply failed (${status}): ${body}`);
    this.name = "WhatsAppReplyError";
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

function getTextParam(request: Request, key: string) {
  return new URL(request.url).searchParams.get(key)?.trim() ?? "";
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

function getGraphApiVersion() {
  return process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
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

function timeoutFallbackReply(locale?: string) {
  return {
    response: localizedTimeoutFallbackReply(locale),
    model: "timeout",
  };
}

function questionBankReplyMode(match: Pick<QuestionBankMatch, "source">): WhatsAppEventReplyMode {
  return match.source === "exact" ? "question_bank_exact" : "question_bank_semantic";
}

function whatsappChannelCopy(text: string) {
  return text.replace(/\bLINE\b/g, "WhatsApp");
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

async function resolveWhatsAppReply({
  client,
  messageText,
  sessionId,
  siteUrl,
}: {
  client: ConvexHttpClient;
  messageText: string;
  sessionId: string;
  siteUrl: string;
}): Promise<ResolvedWhatsAppReply> {
  const locale = detectQuickAnswerLocale(messageText);
  const guardrailReply = await timeout(
    client.action(api.chatAi.getGuardrailReply, {
      userMessage: messageText,
      siteUrl,
    } as never) as Promise<string | null>,
    GUARDRAIL_REPLY_TIMEOUT_MS,
    () => null,
  );

  if (guardrailReply) {
    return {
      responseText: guardrailReply,
      replyMode: "ai",
      questionBankMatch: null,
    };
  }

  const approvedKnowledgeMatch = (await client.query(api.chatKnowledge.resolveExact, {
    sessionId,
    messageText,
  } as never)) as ApprovedKnowledgeMatch | null;

  if (approvedKnowledgeMatch) {
    return {
      responseText: approvedKnowledgeMatch.answer.trim(),
      replyMode: "approved_exact",
      questionBankMatch: null,
    };
  }

  const properties = (await client.query(api.properties.list, {})) as LinePropertySummary[];
  const quickAnswer = resolveLineQuickAnswer({
    eventType: "message",
    ...(locale ? { locale } : {}),
    messageText,
    properties,
    siteUrl,
  });

  if (quickAnswer) {
    return {
      responseText: whatsappChannelCopy(quickAnswer.text),
      replyMode: "exact",
      questionBankMatch: null,
    };
  }

  const exactMatch = (await client.query(api.chatSuggestions.resolveCuratedExact, {
    sessionId,
    messageText,
    ...(locale ? { locale } : {}),
  } as never)) as QuestionBankMatch | null;

  const questionBankMatch =
    exactMatch ??
    ((await timeout(
      client.action(api.chatSuggestions.resolveCuratedSemantic, {
        sessionId,
        messageText,
        ...(locale ? { locale } : {}),
      } as never) as Promise<QuestionBankMatch | null>,
      QUESTION_BANK_SEMANTIC_TIMEOUT_MS,
      () => null,
    )) as QuestionBankMatch | null);

  if (questionBankMatch?.answerMode === "static" && questionBankMatch.answer?.trim()) {
    return {
      responseText: questionBankMatch.answer.trim(),
      replyMode: questionBankReplyMode(questionBankMatch),
      questionBankMatch,
    };
  }

  if (questionBankMatch) {
    const generated = await timeout(
      client.action(api.chatAi.generateReply, {
        sessionId,
        userMessage: messageText,
        channel: "whatsapp",
        siteUrl,
        ...(locale ? { locale } : {}),
        questionBankHint: {
          question: questionBankMatch.question,
          topic: questionBankMatch.topic,
          ...(questionBankMatch.dynamicIntent
            ? { dynamicIntent: questionBankMatch.dynamicIntent }
            : {}),
          source: questionBankMatch.source,
        },
      } as never) as Promise<GeneratedReply>,
      AI_REPLY_TIMEOUT_MS,
      () => timeoutFallbackReply(locale),
    );

    return {
      responseText: generated.response ?? timeoutFallbackReply(locale).response,
      replyMode:
        generated.model === "timeout" ? "failed" : questionBankReplyMode(questionBankMatch),
      questionBankMatch,
    };
  }

  await client.mutation(api.chatKnowledge.recordUnknownQuestion, {
    sessionId,
    userQuestion: messageText,
  } as never);

  return {
    responseText: localizedUnknownFallbackReply(locale),
    replyMode: "unknown_fallback",
    questionBankMatch: null,
  };
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
  client: ConvexHttpClient;
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

  let claimed: ClaimedWhatsAppEvent;
  try {
    claimed = (await client.mutation(api.whatsapp.claimEvent, {
      eventKey,
      whatsappUserId,
      profileName,
      phoneNumberId,
      eventType,
      messageText,
      eventTimestamp,
    } as never)) as ClaimedWhatsAppEvent;
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
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(messageText ? { userContent: messageText } : {}),
      } as never);
    }

    if (!claimed.sessionId) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "Missing WhatsApp sender id",
      } as never);
      return;
    }

    if (eventType === "unsupported" || !messageText) {
      await client.mutation(api.whatsapp.markEventIgnored, {
        eventId: claimed.eventId,
        reason: `Unsupported WhatsApp message type: ${message.type ?? "unknown"}`,
      } as never);
      return;
    }

    const { responseText, replyMode, questionBankMatch } = await resolveWhatsAppReply({
      client,
      messageText,
      sessionId: claimed.sessionId,
      siteUrl: getSiteUrl(request),
    });

    whatsappReplyStatus = await sendWhatsAppTextMessage({
      accessToken,
      phoneNumberId: phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
      recipientId: whatsappUserId,
      text: responseText,
    });

    if (questionBankMatch) {
      await client
        .mutation(api.chatSuggestions.markClicked, {
          sessionId: claimed.sessionId,
          suggestion: {
            source: "curated",
            suggestionId: questionBankMatch.suggestionId,
          },
        } as never)
        .catch((markClickedError) => {
          console.warn("WhatsApp webhook failed to mark question-bank match clicked", {
            eventKey,
            suggestionId: questionBankMatch?.suggestionId,
            error:
              markClickedError instanceof Error
                ? markClickedError.message
                : "Unknown Convex failure",
          });
        });
    }

    await client.mutation(api.whatsapp.completeEvent, {
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      userContent: messageText,
      assistantContent: responseText,
      replyMode,
      whatsappReplyStatus,
    } as never);
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
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "WHATSAPP_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: WhatsAppWebhookBody;
  try {
    payload = (await request.json()) as WhatsAppWebhookBody;
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

  const client = getConvexClient();
  let processed = 0;
  for (const { change, message } of messages) {
    await handleWhatsAppMessage({ accessToken, change, client, message, request });
    processed += 1;
  }

  return jsonResponse({ ok: true, processed, statuses: statuses.length });
}
