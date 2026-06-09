import {
  extractChatBookingContext,
  inferChatPropertySlug,
  type ChatBookingContext,
} from "@/lib/chat/booking-intent";
import type { ChatSuggestionId } from "@/lib/chat/suggestions";

export type ChatActionHint = "booking" | "tour" | "none";

export type ChatActionCard =
  | { type: "booking"; context: ChatBookingContext }
  | { type: "tour"; propertySlug?: string }
  | { type: "none" };
type ChatBookingActionCard = Extract<ChatActionCard, { type: "booking" }>;

type ChatActionInput = {
  latestUserMessage?: string;
  latestAssistantMessage?: string;
  activePropertySlug?: string;
  actionHint?: ChatActionHint | null;
  clickedSuggestionId?: ChatSuggestionId | null;
  rankedSuggestionTopic?: string | null;
};

const TOUR_INTENT_PATTERNS = [
  /\b360(?:°)?\b/i,
  /\b(?:tour|virtual tour|virtual view|hotspot)\b/i,
  /\b(?:see|view|open|explore)\b.{0,36}\b(?:360|tour|virtual)\b/i,
  /\b(?:open|view|see)\b.{0,36}\b(?:villa|room)\s+(?:detail|page)\b/i,
  /(?:ดู|ชม|เปิด).{0,24}(?:360|ทัวร์)/iu,
  /(?:360|ทัวร์).{0,24}(?:วิลล่า|ดู|ชม|เปิด)/iu,
];

const STATIC_SUGGESTION_ACTIONS: Record<ChatSuggestionId, ChatActionHint> = {
  availability: "booking",
  totalPrice: "booking",
  direct: "booking",
  tour: "tour",
  guests: "none",
  contact: "none",
  couple: "none",
  family: "none",
  cancellation: "none",
  airport: "none",
  amenitiesIncluded: "none",
  location: "none",
};

const RANKED_TOPIC_ACTIONS: Record<string, ChatActionHint> = {
  availability: "booking",
  booking: "booking",
  booking_help: "booking",
  direct_booking: "booking",
  pricing: "booking",
  tour: "tour",
  amenities: "none",
  contact: "none",
  property_details: "none",
  villa_fit: "none",
};

export function hasChatTourIntent(text: string) {
  return TOUR_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function getChatActionHintForStaticSuggestion(id?: ChatSuggestionId | null) {
  return id ? STATIC_SUGGESTION_ACTIONS[id] : null;
}

export function getChatActionHintForRankedTopic(topic?: string | null) {
  const normalized = topic?.trim().toLocaleLowerCase();
  return normalized ? RANKED_TOPIC_ACTIONS[normalized] ?? null : null;
}

export function resolveChatActionHint({
  latestUserMessage = "",
  latestAssistantMessage = "",
  activePropertySlug,
  clickedSuggestionId,
  rankedSuggestionTopic,
}: ChatActionInput): ChatActionHint | null {
  const staticHint = getChatActionHintForStaticSuggestion(clickedSuggestionId);
  if (staticHint) return staticHint;

  const combined = `${latestUserMessage}\n${latestAssistantMessage}`;
  const hasTourIntent = hasChatTourIntent(combined);
  const bookingContext = extractChatBookingContext({
    latestUserMessage,
    latestAssistantMessage,
    activePropertySlug,
  });
  const rankedHint = getChatActionHintForRankedTopic(rankedSuggestionTopic);

  if (rankedHint) {
    if (rankedHint !== "booking" && bookingContext.hasBookingIntent && !hasTourIntent) {
      return "booking";
    }
    return rankedHint;
  }

  if (hasTourIntent) return "tour";
  if (bookingContext.hasBookingIntent) return "booking";
  return null;
}

function bookingActionFromText({
  latestUserMessage,
  latestAssistantMessage,
  activePropertySlug,
  forceIntent = false,
}: {
  latestUserMessage: string;
  latestAssistantMessage: string;
  activePropertySlug?: string;
  forceIntent?: boolean;
}): ChatBookingActionCard {
  const context = extractChatBookingContext({
    latestUserMessage,
    latestAssistantMessage,
    activePropertySlug,
  });

  return {
    type: "booking",
    context: forceIntent ? { ...context, hasBookingIntent: true } : context,
  };
}

export function getChatActionCard({
  latestUserMessage = "",
  latestAssistantMessage = "",
  activePropertySlug,
  actionHint,
  clickedSuggestionId,
  rankedSuggestionTopic,
}: ChatActionInput): ChatActionCard {
  const combined = `${latestUserMessage}\n${latestAssistantMessage}`;
  const resolvedActionHint =
    actionHint ??
    resolveChatActionHint({
      latestUserMessage,
      latestAssistantMessage,
      activePropertySlug,
      clickedSuggestionId,
      rankedSuggestionTopic,
    });

  if (resolvedActionHint === "none") return { type: "none" };

  if (resolvedActionHint === "tour") {
    return {
      type: "tour",
      propertySlug: inferChatPropertySlug(combined, activePropertySlug),
    };
  }

  if (resolvedActionHint === "booking") {
    return bookingActionFromText({
      latestUserMessage,
      latestAssistantMessage,
      activePropertySlug,
      forceIntent: true,
    });
  }

  if (hasChatTourIntent(combined)) {
    return {
      type: "tour",
      propertySlug: inferChatPropertySlug(combined, activePropertySlug),
    };
  }

  const bookingAction = bookingActionFromText({
    latestUserMessage,
    latestAssistantMessage,
    activePropertySlug,
  });

  return bookingAction.context.hasBookingIntent ? bookingAction : { type: "none" };
}
