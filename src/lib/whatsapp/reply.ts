import { api } from "convex/_generated/api";
import { looksLikeBookingMessage } from "@/lib/chat/ai-booking-route";
import {
  detectQuickAnswerLocale,
  localizedTimeoutFallbackReply,
  resolveLineQuickAnswer,
  type LinePropertySummary,
} from "@/lib/line/quick-answers";

const AI_REPLY_TIMEOUT_MS = 25_000;
const GUARDRAIL_REPLY_TIMEOUT_MS = 3_000;
const QUESTION_BANK_SEMANTIC_TIMEOUT_MS = 8_000;

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

export type WhatsAppConvexClient = {
  query: (functionReference: unknown, args: unknown) => Promise<unknown>;
  mutation: (functionReference: unknown, args: unknown) => Promise<unknown>;
  action: (functionReference: unknown, args: unknown) => Promise<unknown>;
};

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

export async function resolveWhatsAppReply({
  client,
  messageText,
  sessionId,
  siteUrl,
}: {
  client: WhatsAppConvexClient;
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

  if (
    messageText &&
    (looksLikeBookingMessage(messageText) ||
      (await client.query(api.bookings.isChatBookingFlowActive, { sessionId } as never)))
  ) {
    const generated = await timeout(
      client.action(api.chatAi.generateReply, {
        sessionId,
        userMessage: messageText,
        channel: "whatsapp",
        siteUrl,
        bookingFlow: true,
        ...(locale ? { locale } : {}),
      } as never) as Promise<GeneratedReply>,
      AI_REPLY_TIMEOUT_MS,
      () => timeoutFallbackReply(locale),
    );

    return {
      responseText: generated.response ?? timeoutFallbackReply(locale).response,
      replyMode: generated.model === "timeout" ? "failed" : "ai",
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

  const generated = await timeout(
    client.action(api.chatAi.generateReply, {
      sessionId,
      userMessage: messageText,
      channel: "whatsapp",
      siteUrl,
      ...(locale ? { locale } : {}),
    } as never) as Promise<GeneratedReply>,
    AI_REPLY_TIMEOUT_MS,
    () => timeoutFallbackReply(locale),
  );
  return {
    responseText: generated.response ?? timeoutFallbackReply(locale).response,
    replyMode: generated.model === "timeout" ? "failed" : generated.model === "unknown_fallback" ? "unknown_fallback" : "ai",
    questionBankMatch: null,
  };
}
