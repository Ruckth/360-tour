import type { Id } from "convex/_generated/dataModel";

export type AdminSessionStatus = "open" | "resolved" | "archived";

export type SessionChannelFilter = "all" | "web" | "line" | "facebook" | "whatsapp" | "instagram";

export type AdminMessage = {
  _id: Id<"chatMessages">;
  role: "user" | "assistant";
  source?: "admin";
  content: string;
  timestamp: number;
};

export type LineWebhookStatus = "received" | "processing" | "replied" | "ignored" | "failed";
export type LineReplyMode =
  | "exact"
  | "approved_exact"
  | "question_bank_exact"
  | "question_bank_semantic"
  | "ai"
  | "unknown_fallback"
  | "postback"
  | "follow"
  | "ignored"
  | "failed";

export type AdminLineEvent = {
  _id: Id<"lineWebhookEvents">;
  eventType: "message" | "follow" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: LineReplyMode;
  lineReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

export type AdminFacebookEvent = {
  _id: Id<"facebookWebhookEvents">;
  eventType: "message" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow">;
  facebookReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

export type AdminWhatsAppEvent = {
  _id: Id<"whatsappWebhookEvents">;
  eventType: "message" | "unsupported";
  messageText?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow" | "postback">;
  whatsappReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

export type AdminInstagramEvent = {
  _id: Id<"instagramWebhookEvents">;
  eventType: "message" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow">;
  instagramReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

export type AdminSession = {
  _id: Id<"chatSessions">;
  visitorId?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
  visitorContactApp?: "whatsapp" | "line" | "facebook" | "instagram";
  visitorContactHandle?: string;
  propertySlug?: string;
  propertyName?: string;
  currentPath?: string;
  referrer?: string;
  userAgent?: string;
  timeZone?: string;
  browserLanguage?: string;
  screenSize?: string;
  viewportSize?: string;
  platform?: string;
  channel: "web" | "whatsapp" | "line" | "facebook" | "instagram";
  createdAt: number;
  lastSeenAt?: number;
  lastOpenedAt?: number;
  lastClosedAt?: number;
  messageCount?: number;
  latestMessageAt?: number;
  adminSortAt?: number;
  isActive: boolean;
  adminStatus?: AdminSessionStatus;
  resolvedAt?: number;
  archivedAt?: number;
  aiPaused?: boolean;
  assignedAdminEmail?: string;
  latestMessage?: AdminMessage;
  needsReply?: boolean;
  latestLineEvent?: AdminLineEvent | null;
  latestFacebookEvent?: AdminFacebookEvent | null;
  latestWhatsAppEvent?: AdminWhatsAppEvent | null;
  latestInstagramEvent?: AdminInstagramEvent | null;
};

export type SessionListResult = {
  sessions: AdminSession[];
  continueCursor: string | null;
  nextCursor?: string | null;
  isDone: boolean;
};

/** 24-hour free-text window on WhatsApp, Messenger and Instagram. */
export type ChannelReplyWindow =
  | { applies: false }
  | { applies: true; lastGuestMessageAt?: number; closesAt?: number };

export type SessionDetailResult = {
  session: AdminSession;
  replyWindow: ChannelReplyWindow;
  lineEvents?: AdminLineEvent[];
  facebookEvents?: AdminFacebookEvent[];
  whatsappEvents?: AdminWhatsAppEvent[];
  instagramEvents?: AdminInstagramEvent[];
};

export type TranscriptPaginationResult = {
  results: AdminMessage[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
};
