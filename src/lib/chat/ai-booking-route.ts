import { hasChatBookingIntent, parseChatDateRange } from "./booking-intent";

const CANCEL_PATTERN = /cancel|ยกเลิก/i;

/** Messaging webhooks send these messages to the AI booking flow instead of the unknown-question fallback. */
export function looksLikeBookingMessage(text?: string) {
  if (!text) return false;
  return (
    hasChatBookingIntent(text) ||
    CANCEL_PATTERN.test(text) ||
    Boolean(parseChatDateRange(text).checkIn)
  );
}
