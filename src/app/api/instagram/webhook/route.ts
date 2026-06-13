import { createHash } from "node:crypto";
import { api } from "convex/_generated/api";
import {
  detectQuickAnswerLocale,
  localizedTimeoutFallbackReply,
  localizedUnknownFallbackReply,
  parseLineLocaleFromPostback,
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

type InstagramEventReplyMode =
  | "exact"
  | "approved_exact"
  | "question_bank_exact"
  | "question_bank_semantic"
  | "ai"
  | "unknown_fallback"
  | "postback"
  | "failed";

type ResolvedInstagramReply = {
  responseText: string;
  replyMode: InstagramEventReplyMode;
  questionBankMatch: QuestionBankMatch | null;
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

function detectInstagramLocale(messageText?: string) {
  return detectQuickAnswerLocale(messageText);
}

function questionBankReplyMode(match: Pick<QuestionBankMatch, "source">): InstagramEventReplyMode {
  return match.source === "exact" ? "question_bank_exact" : "question_bank_semantic";
}

function instagramChannelCopy(text: string) {
  return text.replace(/\bLINE\b/g, "Instagram");
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

async function resolveInstagramReply({
  client,
  eventType,
  messageText,
  postbackData,
  sessionId,
  siteUrl,
}: {
  client: InstagramConvexClient;
  eventType: Exclude<InstagramEventType, "unsupported">;
  messageText?: string;
  postbackData?: string;
  sessionId: string;
  siteUrl: string;
}): Promise<ResolvedInstagramReply> {
  const locale =
    eventType === "postback"
      ? parseLineLocaleFromPostback(postbackData)
      : detectInstagramLocale(messageText);
  const guardrailReply =
    eventType === "message" && messageText
      ? await timeout(
          client.action(api.chatAi.getGuardrailReply, {
            userMessage: messageText,
            siteUrl,
          } as never) as Promise<string | null>,
          GUARDRAIL_REPLY_TIMEOUT_MS,
          () => null,
        )
      : null;

  if (guardrailReply) {
    return {
      responseText: guardrailReply,
      replyMode: "ai",
      questionBankMatch: null,
    };
  }

  if (eventType === "message" && messageText) {
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
  }

  const properties = (await client.query(api.properties.list, {})) as LinePropertySummary[];
  const quickAnswer = resolveLineQuickAnswer({
    eventType,
    ...(locale ? { locale } : {}),
    messageText,
    postbackData,
    properties,
    siteUrl,
  });

  if (quickAnswer) {
    return {
      responseText: instagramChannelCopy(quickAnswer.text),
      replyMode: quickAnswer.mode === "postback" ? "postback" : "exact",
      questionBankMatch: null,
    };
  }

  let questionBankMatch: QuestionBankMatch | null = null;
  if (eventType === "message" && messageText) {
    const exactMatch = (await client.query(api.chatSuggestions.resolveCuratedExact, {
      sessionId,
      messageText,
      ...(locale ? { locale } : {}),
    } as never)) as QuestionBankMatch | null;

    questionBankMatch =
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
  }

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
        userMessage: messageText ?? postbackData ?? "Instagram message",
        channel: "instagram",
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

  if (eventType === "message" && messageText) {
    await client.mutation(api.chatKnowledge.recordUnknownQuestion, {
      sessionId,
      userQuestion: messageText,
    } as never);
  }

  return {
    responseText: localizedUnknownFallbackReply(locale),
    replyMode: "unknown_fallback",
    questionBankMatch: null,
  };
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

  let claimed: ClaimedInstagramEvent;
  try {
    claimed = (await client.mutation(api.instagram.claimEvent, {
      eventKey,
      instagramUserId,
      instagramAccountId,
      eventType,
      messageText,
      postbackData,
      eventTimestamp: event.timestamp,
    } as never)) as ClaimedInstagramEvent;
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

  try {
    if (claimed.sessionId) {
      await client.mutation(api.instagram.recordInboundEvent, {
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(userContent ? { userContent } : {}),
      } as never);
    }

    if (!claimed.sessionId) {
      await client.mutation(api.instagram.markEventIgnored, {
        eventId: claimed.eventId,
        reason: "Missing Instagram sender id",
      } as never);
      return;
    }

    const { responseText, replyMode, questionBankMatch } = await resolveInstagramReply({
      client,
      eventType,
      messageText,
      postbackData,
      sessionId: claimed.sessionId,
      siteUrl: getSiteUrl(request),
    });

    instagramReplyStatus = await sendInstagramTextMessage({
      accessToken,
      recipientId: instagramUserId,
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
          console.warn("Instagram webhook failed to mark question-bank match clicked", {
            eventKey,
            suggestionId: questionBankMatch?.suggestionId,
            error:
              markClickedError instanceof Error
                ? markClickedError.message
                : "Unknown Convex failure",
          });
        });
    }

    await client.mutation(api.instagram.completeEvent, {
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      ...(userContent ? { userContent } : {}),
      assistantContent: responseText,
      replyMode,
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
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: "INSTAGRAM_ACCESS_TOKEN is required" },
      { status: 500 },
    );
  }

  let payload: InstagramWebhookBody;
  try {
    payload = (await request.json()) as InstagramWebhookBody;
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
