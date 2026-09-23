import { hasChatBookingIntent, parseChatDateRange } from "./booking-intent";

/** Messaging webhooks send these messages to the AI booking flow instead of the unknown-question fallback. */
export function looksLikeBookingMessage(text?: string) {
  if (!text) return false;
  return hasChatBookingIntent(text) || Boolean(parseChatDateRange(text).checkIn);
}
