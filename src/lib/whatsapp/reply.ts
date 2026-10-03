import { resolveMessagingReply, type MessagingClient } from '@/lib/chat/messaging-reply';

export type WhatsAppConvexClient = MessagingClient & { mutation: (reference: unknown, args: unknown) => Promise<unknown> };

export async function resolveWhatsAppReply(args: { client: WhatsAppConvexClient; messageText: string; sessionId: string; siteUrl: string }) {
  return await resolveMessagingReply({ ...args, channel: 'whatsapp' });
}
