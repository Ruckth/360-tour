import type { ChatActionCard, ChatActionHint } from "@/lib/chat/action-card";
import type { ChatSuggestionCandidate } from "@/lib/chat/suggestions";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  action?: ChatActionHint;
};
export type ChatSuggestion = ChatSuggestionCandidate & {
  answer: string;
  source: "static";
};
export type ChatMessageActionCard = ChatActionCard;
