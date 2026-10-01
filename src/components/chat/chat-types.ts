import type { ChatActionCard, ChatActionHint } from "@/lib/chat/action-card";
import type { ChatSuggestionCandidate } from "@/lib/chat/suggestions";

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatActionHint;
  /** Staff has taken over: show "a team member will reply" after this guest message. */
  staffReplyNotice?: boolean;
};
export type ChatSuggestion = ChatSuggestionCandidate & {
  answer: string;
  source: "static";
};
export type ChatMessageActionCard = ChatActionCard;
