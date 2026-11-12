import type { Id } from "convex/_generated/dataModel";
import type { SessionChannelFilter } from "@/components/admin/admin-chat-types";

export type UnknownQuestionStatus = "new" | "resolved" | "ignored";

/**
 * A missing-information report: a question the concierge could not answer. Resolved by linking an
 * approved business fact or a structured source (see MissingInformationPanel).
 */
export type AdminUnknownQuestion = {
  _id: Id<"chatUnknownQuestions">;
  sessionId?: Id<"conversations">;
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
