import { hasChatBookingIntent, parseChatDateRange } from "./booking-intent";

const CANCEL_PATTERN = /cancel|ยกเลิก/i;
// Resort services (massage, yoga, private chef, transfers) are booked through the AI too.
const SERVICE_PATTERN = /massage|\bspa\b|yoga|\bchef\b|airport|transfer|treatment|นวด|สปา|โยคะ|เชฟ|รถรับส่ง/i;
// Relative dates ("free this Friday?", "next weekend") that the date parser doesn't turn into a range.
const RELATIVE_DATE_PATTERN =
  /\b(tonight|tomorrow|weekend|next (week|month)|(mon|tues|wednes|thurs|fri|satur|sun)day|vacan\w*)\b|คืนนี้|พรุ่งนี้|สุดสัปดาห์|เสาร์|อาทิตย์หน้า|วันศุกร์/i;

/** Messaging webhooks send these messages to the AI booking flow instead of the unknown-question fallback. */
export function looksLikeBookingMessage(text?: string) {
  if (!text) return false;
  return (
    hasChatBookingIntent(text) ||
    CANCEL_PATTERN.test(text) ||
    SERVICE_PATTERN.test(text) ||
    RELATIVE_DATE_PATTERN.test(text) ||
    Boolean(parseChatDateRange(text).checkIn)
  );
}
