"use client";

import { forwardRef, type CSSProperties } from "react";
import { ChatBookingCard } from "@/components/chat/ChatBookingCard";
import { ChatVillaTourCard } from "@/components/chat/ChatVillaTourCard";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat/chat-bubble";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import type {
  ChatMessage,
  ChatMessageActionCard,
  ChatSuggestion,
} from "@/components/chat/chat-types";
import { cn } from "@/lib/utils";

export function SuggestionChips({
  suggestions,
  onSelect,
  disabled = false,
  variant = "compact",
}: {
  suggestions: ChatSuggestion[];
  onSelect: (suggestion: ChatSuggestion) => void;
  disabled?: boolean;
  variant?: "compact" | "initial";
}) {
  if (!suggestions.length) return null;

  return (
    <div
      data-testid="chat-suggestions"
      className={cn(
        "mt-2 flex flex-wrap",
        variant === "initial" ? "justify-center gap-3" : "gap-2",
      )}
    >
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-suggestion-id={item.id}
          disabled={disabled}
          onClick={() => onSelect(item)}
          className={cn(
            "max-w-full rounded-full border border-border bg-background/85 font-medium text-slate-700 shadow-sm shadow-black/5 transition hover:border-gold/60 hover:bg-gold/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 dark:border-white/15 dark:bg-background/60 dark:text-slate-300 dark:hover:text-white",
            variant === "initial"
              ? "min-h-11 px-4 py-2.5 text-center text-sm leading-snug sm:px-5 sm:text-[15px]"
              : "px-3 py-1.5 text-left text-[11px] leading-tight",
          )}
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}

function renderMessage(content: string) {
  const lines = content.split("\n");
  return lines.map((line, lineIndex) => (
    <span key={`${line}-${lineIndex}`}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={`${part}-${partIndex}`} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={`${part}-${partIndex}`}>{part}</span>
        ),
      )}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

export const ChatMessages = forwardRef<
  HTMLDivElement,
  {
    messages: ChatMessage[];
    messageActionCards: ChatMessageActionCard[];
    latestAssistantIndex: number;
    canShowMessageSuggestions: boolean;
    visibleSuggestions: ChatSuggestion[];
    onSuggestionSelect: (suggestion: ChatSuggestion) => void;
    chatInputDisabled: boolean;
    isTyping: boolean;
    initialPrompt: string;
    thinkingLabel: string;
    mode: "overlay" | "page";
    style?: CSSProperties;
  }
>(function ChatMessages(
  {
    messages,
    messageActionCards,
    latestAssistantIndex,
    canShowMessageSuggestions,
    visibleSuggestions,
    onSuggestionSelect,
    chatInputDisabled,
    isTyping,
    initialPrompt,
    thinkingLabel,
    mode,
    style,
  },
  ref,
) {
  return (
    <ChatMessageList
      ref={ref}
      contentKey={`${messages.length}-${isTyping}-${visibleSuggestions.map((item) => item.id).join(",")}`}
      data-testid="chat-messages"
      className={cn(
        "px-5 py-5 md:px-4 md:py-4",
        mode === "page" && "overscroll-contain pb-6",
      )}
      style={style}
    >
      {messages.length === 0 ? (
        <div
          data-testid="chat-initial-prompts"
          className="mx-auto flex w-full max-w-4xl flex-col items-center px-1 pt-7 text-center sm:pt-10"
        >
          {!isTyping ? (
            <>
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
                {initialPrompt}
              </h2>
              <SuggestionChips
                suggestions={visibleSuggestions}
                onSelect={onSuggestionSelect}
                disabled={chatInputDisabled}
                variant="initial"
              />
            </>
          ) : null}
        </div>
      ) : null}
      {messages.map((message, index) => {
        const actionCard = messageActionCards[index] ?? { type: "none" };
        const hasActionCard =
          message.role === "assistant" && actionCard.type !== "none";
        return (
          <ChatBubble
            key={`${message.role}-${index}`}
            variant={message.role === "user" ? "sent" : "received"}
            className={
              hasActionCard ? "w-full max-w-[96%] md:max-w-[85%]" : undefined
            }
          >
            {message.role === "assistant" ? (
              <ChatBubbleAvatar label="✦" />
            ) : null}
            <div className={cn("min-w-0", hasActionCard && "flex-1")}>
              <ChatBubbleMessage
                variant={message.role === "user" ? "sent" : "received"}
              >
                {renderMessage(message.content)}
              </ChatBubbleMessage>
              {actionCard.type === "booking" ? (
                <ChatBookingCard context={actionCard.context} />
              ) : null}
              {actionCard.type === "tour" ? (
                <ChatVillaTourCard propertySlug={actionCard.propertySlug} />
              ) : null}
              {message.role === "assistant" &&
              index === latestAssistantIndex &&
              canShowMessageSuggestions ? (
                <SuggestionChips
                  suggestions={visibleSuggestions}
                  onSelect={onSuggestionSelect}
                  disabled={chatInputDisabled}
                />
              ) : null}
            </div>
          </ChatBubble>
        );
      })}
      {isTyping ? (
        <ChatBubble variant="received">
          <ChatBubbleAvatar label="✦" />
          <ChatBubbleMessage isLoading loadingLabel={thinkingLabel} />
        </ChatBubble>
      ) : null}
    </ChatMessageList>
  );
});
