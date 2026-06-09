export type LineIntent =
  | "availability"
  | "pricing"
  | "direct_booking"
  | "villa_details"
  | "tour"
  | "contact"
  | "airport"
  | "cancellation"
  | "location"
  | "amenities"
  | "welcome";

export type LineReplyMode = "exact" | "postback" | "follow";

export type LinePropertySummary = {
  slug: string;
  name: string;
  tagline: string;
  pricePerNight: number;
  currency: string;
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  area: number;
  amenities: string[];
  directDiscountPercent: number;
};

export type LineQuickReplyItem = {
  type: "action";
  action: {
    type: "postback";
    label: string;
    data: string;
    displayText: string;
  };
};

export type LineQuickAnswer = {
  intent: LineIntent;
  mode: LineReplyMode;
  text: string;
  quickReplyItems: LineQuickReplyItem[];
};

const quickReplyButtons = [
  { label: "Check dates", intent: "availability" },
  { label: "See prices", intent: "pricing" },
  { label: "View 360 tour", intent: "tour" },
  { label: "Contact host", intent: "contact" },
] satisfies Array<{ label: string; intent: LineIntent }>;

const exactQuestionIntents = new Map<string, LineIntent>([
  ["check dates", "availability"],
  ["check availability", "availability"],
  ["availability", "availability"],
  ["can i check availability", "availability"],
  ["ห้องว่าง", "availability"],
  ["เช็คห้องว่าง", "availability"],
  ["ตรวจสอบห้องว่าง", "availability"],

  ["see prices", "pricing"],
  ["price", "pricing"],
  ["prices", "pricing"],
  ["pricing", "pricing"],
  ["how much is it", "pricing"],
  ["ราคา", "pricing"],
  ["ดูราคา", "pricing"],
  ["ราคาเท่าไหร่", "pricing"],

  ["direct booking", "direct_booking"],
  ["direct booking discount", "direct_booking"],
  ["book direct", "direct_booking"],
  ["จองตรง", "direct_booking"],
  ["ส่วนลดจองตรง", "direct_booking"],

  ["villa details", "villa_details"],
  ["property details", "villa_details"],
  ["which villas do you have", "villa_details"],
  ["รายละเอียดวิลล่า", "villa_details"],
  ["มีวิลล่าอะไรบ้าง", "villa_details"],

  ["view 360 tour", "tour"],
  ["360 tour", "tour"],
  ["virtual tour", "tour"],
  ["ดูทัวร์ 360", "tour"],
  ["ทัวร์ 360", "tour"],

  ["contact host", "contact"],
  ["contact", "contact"],
  ["message host", "contact"],
  ["ติดต่อโฮสต์", "contact"],
  ["ติดต่อ", "contact"],

  ["airport pickup", "airport"],
  ["airport transfer", "airport"],
  ["pickup from airport", "airport"],
  ["รับสนามบิน", "airport"],
  ["รถรับส่งสนามบิน", "airport"],

  ["cancellation", "cancellation"],
  ["cancellation policy", "cancellation"],
  ["refund policy", "cancellation"],
  ["ยกเลิกการจอง", "cancellation"],
  ["นโยบายยกเลิก", "cancellation"],

  ["location", "location"],
  ["where are you located", "location"],
  ["where is the resort", "location"],
  ["ที่ตั้ง", "location"],
  ["อยู่ที่ไหน", "location"],

  ["amenities", "amenities"],
  ["what is included", "amenities"],
  ["facilities", "amenities"],
  ["สิ่งอำนวยความสะดวก", "amenities"],
  ["มีอะไรให้บ้าง", "amenities"],
]);

function normalizeSiteUrl(siteUrl: string) {
  const fallback = "https://tour.helpgueststay.com";
  const trimmed = siteUrl.trim();
  if (!trimmed) return fallback;

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, "") || fallback;
  }
}

function formatBaht(value: number) {
  return `฿${Math.round(value).toLocaleString("en-US")}`;
}

function directRate(property: LinePropertySummary) {
  return property.pricePerNight * (1 - property.directDiscountPercent / 100);
}

function bookingUrl(siteUrl: string) {
  return `${normalizeSiteUrl(siteUrl)}/booking`;
}

function villaUrl(siteUrl: string, slug: string) {
  return `${normalizeSiteUrl(siteUrl)}/rooms/${slug}`;
}

function propertyLines(properties: LinePropertySummary[]) {
  return properties
    .map(
      (property) =>
        `${property.name}: ${formatBaht(property.pricePerNight)}/night (${formatBaht(
          directRate(property),
        )} direct)`,
    )
    .join("\n");
}

function fallbackProperties(properties: LinePropertySummary[]) {
  return properties.length > 0 ? properties : [];
}

export function normalizeLineQuestion(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!。！？]+$/u, "")
    .toLocaleLowerCase();
}

export function buildLineQuickReplyItems(): LineQuickReplyItem[] {
  return quickReplyButtons.map((button) => ({
    type: "action",
    action: {
      type: "postback",
      label: button.label,
      data: `intent=${button.intent}`,
      displayText: button.label,
    },
  }));
}

export function parseLineIntentFromPostback(data?: string) {
  if (!data?.trim()) return null;
  const params = new URLSearchParams(data);
  const intent = params.get("intent");
  return isLineIntent(intent) ? intent : null;
}

function isLineIntent(value: string | null): value is LineIntent {
  return (
    value === "availability" ||
    value === "pricing" ||
    value === "direct_booking" ||
    value === "villa_details" ||
    value === "tour" ||
    value === "contact" ||
    value === "airport" ||
    value === "cancellation" ||
    value === "location" ||
    value === "amenities" ||
    value === "welcome"
  );
}

function answerForIntent({
  intent,
  mode,
  properties,
  siteUrl,
}: {
  intent: LineIntent;
  mode: LineReplyMode;
  properties: LinePropertySummary[];
  siteUrl: string;
}): LineQuickAnswer {
  const activeProperties = fallbackProperties(properties);
  const discount = activeProperties[0]?.directDiscountPercent ?? 15;
  const quickReplyItems = buildLineQuickReplyItems();
  const propertyList = activeProperties.length
    ? propertyLines(activeProperties)
    : "Open the booking page to see current villa pricing.";
  const firstVillaLink = activeProperties[0]
    ? villaUrl(siteUrl, activeProperties[0].slug)
    : `${normalizeSiteUrl(siteUrl)}/#villas`;

  const answers: Record<LineIntent, string> = {
    welcome:
      `Thanks for adding Auralis Cove Retreat. I can help with availability, prices, 360 tours, and direct booking. Tap a quick option or send your question here.`,
    availability:
      `You can check live availability and total price here: ${bookingUrl(siteUrl)}\n\nIf you already have dates, reply with villa name, check-in, and checkout.`,
    pricing:
      `Current direct booking prices:\n${propertyList}\n\nUse ${bookingUrl(
        siteUrl,
      )} to calculate the total for your dates.`,
    direct_booking:
      `Book direct and save ${discount}% compared with the listed nightly rate. Direct booking also avoids OTA service fees and includes the resort's direct-booking benefits.\n\nStart here: ${bookingUrl(siteUrl)}`,
    villa_details:
      activeProperties.length
        ? `Our villas:\n${activeProperties
            .map(
              (property) =>
                `${property.name}: ${property.bedrooms} bed, ${property.bathrooms} bath, up to ${property.maxGuests} guests. ${villaUrl(siteUrl, property.slug)}`,
            )
            .join("\n")}`
        : `View villa details here: ${normalizeSiteUrl(siteUrl)}/#villas`,
    tour:
      `You can open the 360 tour from each villa page. Start here: ${firstVillaLink}\n\nThe tour lets you inspect rooms before choosing dates.`,
    contact:
      `You can message us here in LINE. Send your dates, guest count, and preferred villa, and the host can help confirm the best option.`,
    airport:
      `Direct booking includes free airport pickup as part of the direct-booking benefits. Share your arrival time after booking so the host can coordinate pickup.`,
    cancellation:
      `Free cancellation is available up to 48 hours before check-in. For unusual travel changes, message the host here and we will help review the best option.`,
    location:
      `Auralis Cove Retreat is a boutique luxury villa resort in Koh Samui, Thailand. For booking and villa details, start here: ${normalizeSiteUrl(siteUrl)}`,
    amenities:
      activeProperties.length
        ? `Amenities vary by villa. Highlights include ${Array.from(
            new Set(activeProperties.flatMap((property) => property.amenities)),
          )
            .slice(0, 10)
            .join(", ")}.`
        : `Amenities are listed on each villa page: ${normalizeSiteUrl(siteUrl)}/#villas`,
  };

  return {
    intent,
    mode,
    text: answers[intent],
    quickReplyItems,
  };
}

export function resolveLineQuickAnswer({
  eventType,
  messageText,
  postbackData,
  properties,
  siteUrl,
}: {
  eventType: "message" | "follow" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  properties: LinePropertySummary[];
  siteUrl: string;
}) {
  if (eventType === "follow") {
    return answerForIntent({ intent: "welcome", mode: "follow", properties, siteUrl });
  }

  if (eventType === "postback") {
    const intent = parseLineIntentFromPostback(postbackData);
    return intent ? answerForIntent({ intent, mode: "postback", properties, siteUrl }) : null;
  }

  if (eventType !== "message" || !messageText) return null;

  const intent = exactQuestionIntents.get(normalizeLineQuestion(messageText));
  return intent ? answerForIntent({ intent, mode: "exact", properties, siteUrl }) : null;
}
