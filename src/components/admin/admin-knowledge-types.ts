import type { Id } from "convex/_generated/dataModel";
import type { SessionChannelFilter } from "@/components/admin/admin-chat-types";

export type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
export type UnknownQuestionStatus = "new" | "resolved" | "ignored";

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

/**
 * A missing-information report: a question the concierge could not answer. Resolved by linking an
 * approved business fact or a structured source (see MissingInformationPanel).
 */
export type AdminUnknownQuestion = {
  _id: Id<"chatUnknownQuestions">;
  sessionId?: Id<"chatSessions">;
  propertyId?: Id<"properties">;
  propertyName?: string;
  propertySlug?: string;
  userQuestion: string;
  normalizedQuestion: string;
  detectedTopic?: string;
  userId?: string;
  pageUrl?: string;
  status: UnknownQuestionStatus;
  adminNotified: boolean;
  /** How a handled report was resolved (set by businessFacts.adminResolveUnknownGroups / adminSave). */
  resolvedFactTitle?: string;
  resolvedSource?: string;
  createdAt: number;
  updatedAt: number;
};

/** Identical missing-information reports (same normalized text) shown as one row. */
export type AdminUnknownGroup = {
  normalizedQuestion: string;
  count: number;
  counts: Record<UnknownQuestionStatus, number>;
  latestAt: number;
  channels: Exclude<SessionChannelFilter, "all">[];
  latest: AdminUnknownQuestion;
};

export type CuratedSuggestionStatus = "active" | "archived";
export type CuratedAnswerMode = "static" | "dynamic";

/** Retired curated suggestion, shown read-only in the Legacy archive. */
export type AdminCuratedSuggestion = {
  _id: Id<"curatedChatQuestions">;
  question: string;
  translations?: Record<string, string>;
  answer?: string;
  answerTranslations?: Record<string, string>;
  answerMode?: CuratedAnswerMode;
  dynamicIntent?: string;
  propertySlug?: string;
  topic: string;
  score: number;
  status: CuratedSuggestionStatus;
  createdAt: number;
  updatedAt: number;
};
