import { api } from "convex/_generated/api";
import { looksLikeBookingMessage } from "@/lib/chat/ai-booking-route";
import {
  buildLineQuickReplyItems,
  detectQuickAnswerLocale,
  localizedGreetingReply,
  localizedTimeoutFallbackReply,
  localizedUnknownFallbackReply,
  parseLineLocaleFromPostback,
  questionFromLinePostback,
  type LineQuickReplyItem,
} from "@/lib/line/quick-answers";

/**
 * Single typed reply seam shared by every messaging channel.
 *
 * Channel adapters own signature verification, event claim/idempotency, staff-takeover
 * checks (before AND after generation), channel reply windows, delivery, delivery status
 * and server capabilities. This module owns ONLY the reply content: booking-flow detection,
 * concierge generation (which applies guardrail/policy replies first) and the timeout fallback. There is
 * no exact/semantic question-bank routing here any more — every typed fact question goes
 * to the concierge.
 */

export type MessagingChannel = "line" | "facebook" | "instagram" | "whatsapp";

export type MessagingEventKind = "message" | "postback" | "follow";

/** A normalized incoming message, built by a channel adapter from its own webhook payload. */
export type IncomingMessage = {
  channel: MessagingChannel;
  sessionId: string;
  siteUrl: string;
  kind: MessagingEventKind;
  text?: string;
  postbackData?: string;
  /** Explicit locale hint (e.g. a stored session preference). Falls back to detection. */
  locale?: string;
  /** Optional correlation id; generated here when absent so one turn is traceable end to end. */
  turnId?: string;
};

/**
 * replyMode is persisted on event rows. Old literals (approved_exact, question_bank_exact,
 * question_bank_semantic, exact, postback) are intentionally still accepted by the Convex
 * validators for historical rows, but this seam never PRODUCES them any more.
 */
export type MessagingReplyMode =
  | "ai"
  | "guardrail"
  | "unknown_fallback"
  | "failed"
  | "follow"
  | "ai_paused";

/** A model's committed write outcome, surfaced so a timeout fallback cannot claim it failed. */
export type CommittedOutcome = {
  tool: string;
  reference?: string;
};

export type MessagingReplyMetrics = {
  turnId: string;
  channel: MessagingChannel;
  kind: MessagingEventKind;
  /** How long the concierge generation (or guardrail) took, in ms. */
  generationMs: number;
  guardrail: boolean;
  bookingFlow: boolean;
};

export type MessagingReplyResult = {
  responseText: string;
  replyMode: MessagingReplyMode;
  model?: string;
  timedOut: boolean;
  /** Set when a committed booking write survived (so the adapter must not report failure). */
  committed?: CommittedOutcome;
  /** LINE-only quick-reply menu (never policy copy — only generic labels). */
  quickReplyItems?: LineQuickReplyItem[];
  /**
   * When a timeout fired, the still-running generation can resolve later. The adapter must
   * NOT deliver this; it should only record it on the event. Awaiting it is optional.
   */
  lateResult?: Promise<GeneratedReply>;
  metrics: MessagingReplyMetrics;
};

export type MessagingClient = {
  query: (reference: unknown, args: unknown) => Promise<unknown>;
  action: (reference: unknown, args: unknown) => Promise<unknown>;
};

/**
 * Map a seam reply mode to the literal stored on event rows. The stored schema predates the
 * seam and has no 'guardrail' literal, so a guardrail/policy reply is persisted as 'ai' (it
 * is a server-produced reply either way). 'ai_paused' is never produced by the messaging
 * seam. Every other value is already a valid stored literal.
 */
export function storedReplyMode(mode: MessagingReplyMode): "ai" | "unknown_fallback" | "failed" | "follow" {
  switch (mode) {
    case "guardrail":
      return "ai";
    case "ai_paused":
      return "failed";
    default:
      return mode;
  }
}

type GeneratedReply = {
  response?: string;
  model?: string;
  committed?: CommittedOutcome;
};
export type { GeneratedReply as MessagingGeneratedReply };

/**
 * Outer adapter timeout. The concierge turn has its own 20s internal deadline
 * (generateConciergeReply deadlineAt); this sits just above it so the model is given its
 * full budget before the adapter gives up, while staying well under the LINE reply-token
 * expiry. A single shared constant keeps every channel aligned.
 */
export const MESSAGING_REPLY_TIMEOUT_MS = 22_000;

/**
 * Record a late concierge result (one that resolved AFTER the outer timeout fallback was
 * already delivered) WITHOUT delivering it. We log only its model and committed outcome —
 * never the guest-derived response text — so a committed booking write stays visible for
 * reconciliation while exactly-once delivery is preserved. Errors are swallowed.
 */
export async function recordLateMessagingResult(
  late: Promise<GeneratedReply>,
  context: { eventKey: string; channel: MessagingChannel },
): Promise<void> {
  try {
    const result = await late;
    console.info(
      JSON.stringify({
        event: "messaging_late_result",
        channel: context.channel,
        eventKey: context.eventKey,
        model: result.model ?? "unknown",
        committedTool: result.committed?.tool,
        delivered: false,
      }),
    );
  } catch {
    // A late failure after a delivered fallback is not actionable; ignore.
  }
}

function makeTurnId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The guest-visible message for this event. For postbacks it is the label/question the guest
 * saw themselves tap (no fixed answer); for follows there is no message (handled upstream).
 */
function resolveIncomingMessage(incoming: IncomingMessage): string | undefined {
  if (incoming.kind === "postback") return questionFromLinePostback(incoming.postbackData);
  if (incoming.kind === "follow") return undefined;
  return incoming.text?.trim() || undefined;
}

function resolveLocale(incoming: IncomingMessage): string | undefined {
  if (incoming.locale) return incoming.locale;
  if (incoming.kind === "postback") return parseLineLocaleFromPostback(incoming.postbackData);
  return detectQuickAnswerLocale(incoming.text);
}

/** LINE keeps its generic quick-reply menu; other channels have no menu. */
function menuFor(channel: MessagingChannel, locale?: string): LineQuickReplyItem[] | undefined {
  return channel === "line" ? buildLineQuickReplyItems(locale) : undefined;
}

export async function resolveMessagingReply(
  client: MessagingClient,
  incoming: IncomingMessage,
): Promise<MessagingReplyResult> {
  const turnId = incoming.turnId ?? makeTurnId();
  const locale = resolveLocale(incoming);
  const quickReplyItems = menuFor(incoming.channel, locale);

  const baseMetrics = {
    turnId,
    channel: incoming.channel,
    kind: incoming.kind,
    guardrail: false,
    bookingFlow: false,
  };

  // A follow/greeting is a fixed, policy-free welcome; no model call.
  if (incoming.kind === "follow") {
    return {
      responseText: localizedGreetingReply(locale),
      replyMode: "follow",
      timedOut: false,
      ...(quickReplyItems ? { quickReplyItems } : {}),
      metrics: { ...baseMetrics, generationMs: 0 },
    };
  }

  const message = resolveIncomingMessage(incoming);
  if (!message) {
    return {
      responseText: localizedUnknownFallbackReply(locale),
      replyMode: "unknown_fallback",
      timedOut: false,
      ...(quickReplyItems ? { quickReplyItems } : {}),
      metrics: { ...baseMetrics, generationMs: 0 },
    };
  }

  const startedAt = Date.now();

  // generateReply applies the deterministic guardrail/policy replies itself before any model
  // call, so there is no separate guardrail round trip (it used to be a second action call).
  const bookingFlow =
    looksLikeBookingMessage(message) ||
    Boolean(await client.query(api.bookings.isChatBookingFlowActive, { sessionId: incoming.sessionId }));

  // The concierge generation. A Promise.race timeout does NOT cancel this action, so the
  // live promise is captured and exposed as `lateResult` when the timeout wins — the adapter
  // records that late result on the event WITHOUT delivering it (exactly-once delivery).
  const generation = client.action(api.chatAi.generateReply, {
    sessionId: incoming.sessionId,
    userMessage: message,
    channel: incoming.channel,
    siteUrl: incoming.siteUrl,
    ...(locale ? { locale } : {}),
    ...(bookingFlow ? { bookingFlow: true } : {}),
  }) as Promise<GeneratedReply>;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMEOUT = Symbol("timeout");
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), MESSAGING_REPLY_TIMEOUT_MS);
  });

  try {
    const raced = await Promise.race([generation.catch((error) => ({ __error: error })), timeout]);

    if (raced === TIMEOUT) {
      // Timed out: deliver the localized "still checking / host will confirm" text — NOT a
      // failure claim, because a booking write may already have committed. The live generation
      // is handed back so the adapter can record (never deliver) the late result.
      return {
        responseText: localizedTimeoutFallbackReply(locale),
        replyMode: "failed",
        timedOut: true,
        ...(quickReplyItems ? { quickReplyItems } : {}),
        lateResult: generation.then(
          (value) => value,
          (error) => ({ model: "late_error", response: error instanceof Error ? error.message : "late failure" }),
        ),
        metrics: { ...baseMetrics, bookingFlow, generationMs: Date.now() - startedAt },
      };
    }

    if (raced && typeof raced === "object" && "__error" in raced) {
      // The action threw. One failure path, no committed outcome to preserve.
      return {
        responseText: localizedTimeoutFallbackReply(locale),
        replyMode: "failed",
        timedOut: false,
        ...(quickReplyItems ? { quickReplyItems } : {}),
        metrics: { ...baseMetrics, bookingFlow, generationMs: Date.now() - startedAt },
      };
    }

    const reply = (raced ?? {}) as GeneratedReply;
    const replyMode: MessagingReplyMode =
      reply.model === "guardrail"
        ? "guardrail"
        : reply.model === "unknown_fallback"
          ? "unknown_fallback"
          : reply.model === "tool_fallback"
            ? "failed"
            : "ai";

    return {
      responseText: reply.response ?? localizedTimeoutFallbackReply(locale),
      replyMode,
      ...(reply.model ? { model: reply.model } : {}),
      timedOut: false,
      ...(reply.committed ? { committed: reply.committed } : {}),
      ...(quickReplyItems ? { quickReplyItems } : {}),
      metrics: { ...baseMetrics, guardrail: replyMode === "guardrail", bookingFlow, generationMs: Date.now() - startedAt },
    };
  } finally {
    clearTimeout(timer);
  }
}
