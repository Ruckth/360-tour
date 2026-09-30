import type { Id } from "convex/_generated/dataModel";
import type { SessionChannelFilter } from "@/components/admin/admin-chat-types";

export type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
export type KnowledgeAnswerFilter = KnowledgeAnswerStatus | "all";
export type UnknownQuestionStatus = "new" | "resolved" | "ignored";
export type UnknownQuestionFilter = UnknownQuestionStatus | "all";
export const KNOWLEDGE_VIEW_MODES = ["answers", "unknown", "variants", "suggestions"] as const;
export type KnowledgeViewMode = (typeof KNOWLEDGE_VIEW_MODES)[number];

export type AdminKnowledgeQuestion = {
  _id: Id<"chatQuestions">;
  answerId: Id<"chatAnswers">;
  questionText: string;
  normalizedQuestion: string;
  isPrimary: boolean;
  isAiTrigger: boolean;
  createdBy: "admin" | "ai";
  status: "approved" | "suggested" | "rejected";
  createdAt: number;
  updatedAt: number;
};

export type AdminKnowledgeTopic = {
  _id: Id<"chatTopics">;
  name: string;
  description: string;
};

export type AdminKnowledgePropertyScope = {
  slug: string;
  normalizedSlug: string;
  label: string;
  source: "property" | "custom";
  propertyId?: Id<"properties">;
  canDelete?: boolean;
};

export type AdminKnowledgeAnswer = {
  _id: Id<"chatAnswers">;
  propertyName?: string;
  propertySlug?: string;
  propertySlugs?: string[];
  propertyScopes?: { propertySlug: string; label: string }[];
  title: string;
  answer: string;
  status: KnowledgeAnswerStatus;
  createdAt: number;
  updatedAt: number;
  /** List rows: a preview (primary always included). Edit detail: every approved question. */
  questions: AdminKnowledgeQuestion[];
  /** List rows only: which statuses have more questions than the preview shows. */
  questionsTruncated?: { approved: boolean; suggested: boolean; rejected: boolean };
  /** Edit detail only: false when there are too many approved questions to edit in the dialog. */
  questionsEditable?: boolean;
  topics: AdminKnowledgeTopic[];
};

export type AdminUnknownQuestion = {
  _id: Id<"chatUnknownQuestions">;
  sessionId?: Id<"chatSessions">;
  propertyName?: string;
  propertySlug?: string;
  userQuestion: string;
  normalizedQuestion: string;
  detectedTopic?: string;
  userId?: string;
  pageUrl?: string;
  status: UnknownQuestionStatus;
  adminNotified: boolean;
  resolvedAnswerTitle?: string;
  createdAt: number;
  updatedAt: number;
};

/** Identical unknown questions (same normalized text) shown as one row. */
export type AdminUnknownGroup = {
  normalizedQuestion: string;
  count: number;
  counts: Record<UnknownQuestionStatus, number>;
  latestAt: number;
  channels: Exclude<SessionChannelFilter, "all">[];
  latest: AdminUnknownQuestion;
};

/** Best existing answer for an unknown group (adminSuggestAnswersForUnknownGroups), keyed by normalizedQuestion. */
export type AdminUnknownGroupSuggestion = { answerId: Id<"chatAnswers">; title: string; score: number };

export type AdminPendingVariant = {
  _id: Id<"chatQuestions">;
  questionText: string;
  createdAt: number;
  answerId: Id<"chatAnswers">;
  answerTitle: string;
};

export type CuratedSuggestionStatus = "active" | "archived";
export type CuratedAnswerMode = "static" | "dynamic";
export const CURATED_TOPICS = [
  "villa_fit",
  "direct_booking",
  "tour",
  "availability",
  "booking",
  "amenities",
  "contact",
] as const;
export const CURATED_DYNAMIC_INTENTS = [
  "availability",
  "pricing",
  "property_details",
  "booking_help",
  "contact",
] as const;
export type CuratedDynamicIntent = (typeof CURATED_DYNAMIC_INTENTS)[number];

export type AdminCuratedSuggestion = {
  _id: Id<"curatedChatQuestions">;
  question: string;
  translations?: Record<string, string>;
  answer?: string;
  answerTranslations?: Record<string, string>;
  answerMode?: CuratedAnswerMode;
  dynamicIntent?: CuratedDynamicIntent;
  propertySlug?: string;
  topic: string;
  score: number;
  status: CuratedSuggestionStatus;
  createdAt: number;
  updatedAt: number;
};
