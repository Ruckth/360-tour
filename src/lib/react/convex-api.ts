import { api } from "convex/_generated/api";
import type { ConvexReactClient } from "convex/react";
import type { BookingProperty } from "@/lib/booking/booking";
import type { ChatActionHint } from "@/lib/chat/action-card";

const CONVEX_TIMEOUT_MS = 8_000;
const AI_CONVEX_TIMEOUT_MS = 45_000;

async function withConvexTimeout<T>(promise: Promise<T>, label: string, timeoutMs = CONVEX_TIMEOUT_MS) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out. Please try again.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export type LivePropertyRow = Omit<BookingProperty, "id" | "source"> & {
  _id: string;
  slug: string;
};

export type CreateBookingResult = {
  bookingId: string;
  accessToken: string;
};

export type PublicBooking = {
  _id?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  nights?: number;
  subtotal?: number;
  discountAmount?: number;
  total: number;
  currency: string;
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  status: "pending" | "confirmed" | "cancelled" | "completed";
  confirmationCode?: string;
  invoiceNumber?: string;
  receiptNumber?: string;
};

export type LiveBookingQuote = {
  pricePerNight: number;
  nights: number;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  directTotal: number;
  currency: string;
};

export type ChatTranscriptMessage = {
  _id?: string;
  sessionId?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatActionHint;
  timestamp?: number;
};

export type RankedChatSuggestion = {
  _id: string;
  source: "generated" | "curated";
  suggestionId: string;
  question: string;
  translations?: Record<string, string>;
  answer?: string;
  answerTranslations?: Record<string, string>;
  answerMode?: "static" | "dynamic";
  dynamicIntent?: "availability" | "pricing" | "property_details" | "booking_help" | "contact";
  topic: string;
  score: number;
  locale: string;
  status: "active" | "clicked" | "archived";
  createdAt: number;
  shownAt?: number;
  clickedAt?: number;
};

export type RankedChatSuggestionRef = Pick<RankedChatSuggestion, "source" | "suggestionId">;

export type ReusableChatSession = {
  _id: string;
  visitorId?: string;
  createdAt: number;
};

export async function listLiveProperties(client: ConvexReactClient) {
  return (await withConvexTimeout(
    client.query(api.properties.list, {} as never),
    "Loading live villas",
  )) as LivePropertyRow[];
}

export async function getBlockedDatesByProperty(
  client: ConvexReactClient,
  args: { startDate: string; endDate: string },
) {
  return (await withConvexTimeout(
    client.query(api.availability.getBlockedDatesByProperty, args as never),
    "Loading blocked dates",
  )) as Record<string, string[]>;
}

export async function isPropertyAvailable(
  client: ConvexReactClient,
  args: { propertyId: string; checkIn: string; checkOut: string },
) {
  return (await withConvexTimeout(
    client.query(api.availability.isAvailable, args as never),
    "Checking availability",
  )) as boolean;
}

export async function createBooking(
  client: ConvexReactClient,
  args: {
    propertySlug: string;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    checkIn: string;
    checkOut: string;
    guests: number;
  },
) {
  return (await withConvexTimeout(
    client.mutation(api.bookings.create, args as never),
    "Creating booking",
  )) as CreateBookingResult;
}

export async function quoteStay(
  client: ConvexReactClient,
  args: { propertySlug: string; checkIn: string; checkOut: string; guests?: number },
) {
  return (await withConvexTimeout(
    client.query(api.bookings.quoteStay, args as never),
    "Quoting stay",
  )) as LiveBookingQuote;
}

export async function getPublicBooking(
  client: ConvexReactClient,
  args: { id: string; accessToken: string },
) {
  return (await withConvexTimeout(
    client.query(api.bookings.getById, args as never),
    "Loading booking",
  )) as PublicBooking | null;
}

export async function saveLead(
  client: ConvexReactClient,
  args: { propertySlug: string; email: string; source: "tour_completion" | "chat" | "booking_abandonment" },
) {
  return (await withConvexTimeout(
    client.mutation(api.leads.save, args as never),
    "Saving lead",
  )) as string;
}

export async function createChatSession(
  client: ConvexReactClient,
  args: {
    propertySlug?: string;
    channel: "web";
    visitorId?: string;
    currentPath?: string;
    referrer?: string;
    userAgent?: string;
    timeZone?: string;
    browserLanguage?: string;
    screenSize?: string;
    viewportSize?: string;
    platform?: string;
  },
) {
  return (await withConvexTimeout(
    client.mutation(api.chat.createSession, args as never),
    "Creating chat session",
  )) as string;
}

export async function getReusableChatSession(
  client: ConvexReactClient,
  args: { visitorId: string; messageLimit?: number },
) {
  return (await withConvexTimeout(
    client.query(api.chat.getReusableSession, args as never),
    "Loading previous chat session",
  )) as ReusableChatSession | null;
}

export async function touchChatSession(
  client: ConvexReactClient,
  args: {
    sessionId: string;
    propertySlug?: string;
    currentPath?: string;
    referrer?: string;
    userAgent?: string;
    timeZone?: string;
    browserLanguage?: string;
    screenSize?: string;
    viewportSize?: string;
    platform?: string;
    isOpen?: boolean;
  },
) {
  return await withConvexTimeout(
    client.mutation(api.chat.touchSession, args as never),
    "Updating chat session",
  );
}

export async function closeChatSession(
  client: ConvexReactClient,
  args: { sessionId: string },
) {
  return await withConvexTimeout(
    client.mutation(api.chat.closeSession, args as never),
    "Closing chat session",
  );
}

export async function createChatBrowserHandoff(
  client: ConvexReactClient,
  args: { sessionId: string },
) {
  return (await withConvexTimeout(
    client.mutation(api.chat.createBrowserHandoff, args as never),
    "Preparing browser handoff",
  )) as string;
}

export async function claimChatBrowserHandoff(
  client: ConvexReactClient,
  args: { token: string },
) {
  return (await withConvexTimeout(
    client.mutation(api.chat.claimBrowserHandoff, args as never),
    "Restoring browser handoff",
  )) as string | null;
}

export async function addChatMessage(
  client: ConvexReactClient,
  args: { sessionId: string; role: "user" | "assistant"; content: string; action?: ChatActionHint },
) {
  const persistedArgs = {
    sessionId: args.sessionId,
    role: args.role,
    content: args.content,
  };
  return (await withConvexTimeout(
    client.mutation(api.chat.addMessage, persistedArgs as never),
    "Saving chat message",
  )) as string;
}

export async function getChatMessages(
  client: ConvexReactClient,
  args: { sessionId: string; limit?: number },
) {
  return (await withConvexTimeout(
    client.query(api.chat.getMessages, args as never),
    "Loading chat messages",
  )) as ChatTranscriptMessage[];
}

export async function identifyChatVisitor(
  client: ConvexReactClient,
  args: {
    sessionId: string;
    name?: string;
    email?: string;
    phone?: string;
    contactApp?: "whatsapp" | "line";
    contactHandle?: string;
  },
) {
  return await withConvexTimeout(
    client.mutation(api.chat.identifyVisitor, args as never),
    "Saving chat contact",
  );
}

export async function askConcierge(
  client: ConvexReactClient,
  args: {
    sessionId: string;
    userMessage: string;
    propertySlug?: string;
    locale?: string;
    actionHint?: ChatActionHint;
  },
) {
  return (await withConvexTimeout(
    client.action(api.chatAi.respond, args as never),
    "Asking concierge",
    AI_CONVEX_TIMEOUT_MS,
  )) as { response?: string };
}

export async function getNextChatSuggestions(
  client: ConvexReactClient,
  args: { sessionId: string; locale?: string; limit?: number },
) {
  return (await withConvexTimeout(
    client.query(api.chatSuggestions.nextForSession, args as never),
    "Loading suggested questions",
  )) as RankedChatSuggestion[];
}

export async function markChatSuggestionsShown(
  client: ConvexReactClient,
  args: { sessionId: string; suggestions: RankedChatSuggestionRef[] },
) {
  return await withConvexTimeout(
    client.mutation(api.chatSuggestions.markShown, args as never),
    "Marking suggested questions shown",
  );
}

export async function markChatSuggestionClicked(
  client: ConvexReactClient,
  args: { sessionId: string; suggestion: RankedChatSuggestionRef },
) {
  return await withConvexTimeout(
    client.mutation(api.chatSuggestions.markClicked, args as never),
    "Marking suggested question clicked",
  );
}
