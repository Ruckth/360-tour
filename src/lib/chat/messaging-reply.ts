import { api } from 'convex/_generated/api';
import { looksLikeBookingMessage } from '@/lib/chat/ai-booking-route';
import { detectQuickAnswerLocale, localizedTimeoutFallbackReply, localizedUnknownFallbackReply, parseLineLocaleFromPostback, questionFromLinePostback } from '@/lib/line/quick-answers';

export type MessagingClient = {
  query: (reference: unknown, args: unknown) => Promise<unknown>;
  action: (reference: unknown, args: unknown) => Promise<unknown>;
};

/** Channel adapters own events/delivery; every question uses the same server concierge. */
export async function resolveMessagingReply(args: {
  client: MessagingClient;
  channel: 'line' | 'facebook' | 'instagram' | 'whatsapp';
  sessionId: string;
  siteUrl: string;
  eventType?: 'message' | 'postback' | 'follow';
  messageText?: string;
  postbackData?: string;
}) {
  const locale = args.eventType === 'postback'
    ? parseLineLocaleFromPostback(args.postbackData)
    : detectQuickAnswerLocale(args.messageText);
  const message = args.eventType === 'postback'
    ? questionFromLinePostback(args.postbackData)
    : args.eventType === 'follow' ? 'Hello, what can you help me with?' : args.messageText?.trim();
  if (!message) return { responseText: localizedUnknownFallbackReply(locale), replyMode: 'unknown_fallback' as const };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = { responseText: localizedTimeoutFallbackReply(locale), replyMode: 'failed' as const };
  try {
    const generate = async () => {
      const bookingFlow = looksLikeBookingMessage(message) || Boolean(await args.client.query(api.bookings.isChatBookingFlowActive, { sessionId: args.sessionId }));
      const reply = await args.client.action(api.chatAi.generateReply, {
        sessionId: args.sessionId, userMessage: message, channel: args.channel, siteUrl: args.siteUrl,
        ...(locale ? { locale } : {}), ...(bookingFlow ? { bookingFlow: true } : {})
      }) as { response: string; model: string };
      return {
        responseText: reply.response,
        replyMode: reply.model === 'unknown_fallback' ? 'unknown_fallback' as const : reply.model === 'tool_fallback' ? 'failed' as const : 'ai' as const
      };
    };
    return await Promise.race([generate(), new Promise<typeof fallback>(resolve => { timer = setTimeout(() => resolve(fallback), 25_000); })]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
