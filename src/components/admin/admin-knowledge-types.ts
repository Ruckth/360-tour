import type { Id } from "convex/_generated/dataModel";

export type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
export type KnowledgeAnswerFilter = KnowledgeAnswerStatus | "all";
export type UnknownQuestionStatus = "new" | "resolved" | "ignored";
export type UnknownQuestionFilter = UnknownQuestionStatus | "all";
export const KNOWLEDGE_VIEW_MODES = ["answers", "unknown", "suggestions"] as const;
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
  questions: AdminKnowledgeQuestion[];
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
