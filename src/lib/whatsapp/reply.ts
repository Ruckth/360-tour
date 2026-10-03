import {
  resolveMessagingReply,
  type MessagingClient,
  type MessagingReplyMode,
  type MessagingGeneratedReply,
} from "@/lib/chat/messaging-reply";

/**
 * WhatsApp reply resolution, delegating entirely to the shared messaging seam. The webhook
 * route still owns signature verification, event claim/idempotency, the 24h session reply
 * window, delivery, and staff-takeover checks before/after generation.
 */

export type WhatsAppConvexClient = MessagingClient & {
  mutation: (functionReference: unknown, args: unknown) => Promise<unknown>;
};

type ResolvedWhatsAppReply = {
  outcome?: 'answered' | 'awaiting_guest' | 'needs_staff';
  responseText: string;
  replyMode: MessagingReplyMode;
  model?: string;
  timedOut: boolean;
  /** The late generation to RECORD (never deliver) when a timeout fired. */
  lateResult?: Promise<MessagingGeneratedReply>;
};

export async function resolveWhatsAppReply({
  client,
  messageText,
  sessionId,
  replyToMessageId,
  siteUrl,
  turnId,
}: {
  client: WhatsAppConvexClient;
  messageText: string;
  sessionId: string;
  replyToMessageId?: string;
  siteUrl: string;
  turnId?: string;
}): Promise<ResolvedWhatsAppReply> {
  const result = await resolveMessagingReply(client, {
    channel: "whatsapp",
    sessionId,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    siteUrl,
    kind: "message",
    text: messageText,
    ...(turnId ? { turnId } : {}),
  });

  return {
    responseText: result.responseText,
    ...(result.outcome ? { outcome: result.outcome } : {}),
    replyMode: result.replyMode,
    ...(result.model ? { model: result.model } : {}),
    timedOut: result.timedOut,
    ...(result.lateResult ? { lateResult: result.lateResult } : {}),
  };
}
