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
const GUARDRAIL_REPLY_TIMEOUT_MS = 3_000;
const QUESTION_BANK_SEMANTIC_TIMEOUT_MS = 8_000;
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

type QuestionBankMatch = {
  source: "exact" | "semantic";
  suggestionId: string;
  question: string;
  answer?: string;
  answerMode: "static" | "dynamic";
  dynamicIntent?: "availability" | "pricing" | "property_details" | "booking_help" | "contact";
  topic: string;
};

type LineEventReplyMode =
  | "exact"
  | "question_bank_exact"
  | "question_bank_semantic"
  | "ai"
  | "postback"
  | "follow"
  | "failed";

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

function detectLineLocale(messageText?: string) {
  if (!messageText) return undefined;
  return /[\u0E00-\u0E7F]/u.test(messageText) ? "th" : "en";
}

function questionBankReplyMode(match: Pick<QuestionBankMatch, "source">): LineEventReplyMode {
  return match.source === "exact" ? "question_bank_exact" : "question_bank_semantic";
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

  let claimed: ClaimedLineEvent;
  try {
    claimed = (await client.mutation(api.line.claimEvent, {
      eventKey,
      lineUserId,
      sourceType: event.source?.type,
      eventType,
      messageText,
      postbackData,
      eventTimestamp: event.timestamp,
    } as never)) as ClaimedLineEvent;
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

  try {
    if (claimed.sessionId) {
      await client.mutation(api.line.recordInboundEvent, {
        eventId: claimed.eventId,
        sessionId: claimed.sessionId,
        ...(userContent ? { userContent } : {}),
      } as never);
    }

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

    const siteUrl = getSiteUrl(request);
    const locale = detectLineLocale(messageText);
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

    let responseText = guardrailReply ?? "";
    let quickReplyItems: LineQuickReplyItem[] = [];
    let replyMode: LineEventReplyMode = "ai";
    let questionBankMatch: QuestionBankMatch | null = null;
    let generated: GeneratedReply | null = null;

    if (!guardrailReply) {
      const properties = (await client.query(api.properties.list, {})) as LinePropertySummary[];
      const quickAnswer = resolveLineQuickAnswer({
        eventType,
        messageText,
        postbackData,
        properties,
        siteUrl,
      });

      if (quickAnswer) {
        responseText = quickAnswer.text;
        quickReplyItems = quickAnswer.quickReplyItems;
        replyMode = quickAnswer.mode;
      } else {
        if (eventType === "message" && messageText) {
          const exactMatch = (await client.query(api.chatSuggestions.resolveCuratedExact, {
            sessionId: claimed.sessionId,
            messageText,
            ...(locale ? { locale } : {}),
          } as never)) as QuestionBankMatch | null;

          questionBankMatch =
            exactMatch ??
            ((await timeout(
              client.action(api.chatSuggestions.resolveCuratedSemantic, {
                sessionId: claimed.sessionId,
                messageText,
                ...(locale ? { locale } : {}),
              } as never) as Promise<QuestionBankMatch | null>,
              QUESTION_BANK_SEMANTIC_TIMEOUT_MS,
              () => null,
            )) as QuestionBankMatch | null);
        }

        if (
          questionBankMatch?.answerMode === "static" &&
          questionBankMatch.answer?.trim()
        ) {
          responseText = questionBankMatch.answer.trim();
          replyMode = questionBankReplyMode(questionBankMatch);
        } else {
          generated = await timeout(
            client.action(api.chatAi.generateReply, {
              sessionId: claimed.sessionId,
              userMessage: messageText ?? postbackData ?? "LINE message",
              channel: "line",
              siteUrl,
              ...(questionBankMatch
                ? {
                    questionBankHint: {
                      question: questionBankMatch.question,
                      topic: questionBankMatch.topic,
                      ...(questionBankMatch.dynamicIntent
                        ? { dynamicIntent: questionBankMatch.dynamicIntent }
                        : {}),
                      source: questionBankMatch.source,
                    },
                  }
                : {}),
            } as never) as Promise<GeneratedReply>,
            AI_REPLY_TIMEOUT_MS,
            timeoutFallbackReply,
          );
          responseText = generated.response ?? timeoutFallbackReply().response;
          replyMode =
            generated.model === "timeout"
              ? "failed"
              : questionBankMatch
                ? questionBankReplyMode(questionBankMatch)
                : "ai";
        }
      }
    }

    lineReplyStatus = await replyToLine({
      accessToken,
      replyToken: event.replyToken,
      messages: [createLineTextMessage(responseText, quickReplyItems)],
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
          console.warn("LINE webhook failed to mark question-bank match clicked", {
            eventKey,
            suggestionId: questionBankMatch?.suggestionId,
            error:
              markClickedError instanceof Error
                ? markClickedError.message
                : "Unknown Convex failure",
          });
        });
    }

    await client.mutation(api.line.completeEvent, {
      eventId: claimed.eventId,
      sessionId: claimed.sessionId,
      ...(userContent ? { userContent } : {}),
      assistantContent: responseText,
      replyMode,
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
