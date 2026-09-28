import type { Id } from "convex/_generated/dataModel";

export type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
export type KnowledgeAnswerFilter = KnowledgeAnswerStatus | "all";
export type UnknownQuestionStatus = "new" | "resolved" | "ignored";
export type UnknownQuestionFilter = UnknownQuestionStatus | "all";
export type KnowledgeViewMode = "answers" | "unknown";

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
  propertyScopes?: AdminKnowledgePropertyScope[];
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
