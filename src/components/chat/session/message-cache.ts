import type { ChatMessage as Message } from "@/components/chat/chat-types";
import type { ChatActionHint } from "@/lib/chat/action-card";
import type { ChatSuggestionId } from "@/lib/chat/suggestions";

/**
 * Transcript / cache reconciliation.
 *
 * Owns: local message-cache persistence (localStorage), restore, normalization,
 * the merge of a server transcript with optimistic/local messages, and dedupe of
 * admin (staff) messages arriving through the live subscription.
 *
 * Everything here is a pure function of its inputs plus (for the storage helpers)
 * `window.localStorage`; there are no timers or subscriptions to own. The hook keeps
 * ownership of React state and of the effects that call these helpers.
 */

export const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
export const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
export const MESSAGE_CACHE_STORAGE_PREFIX = "sv_chat_messages:";
export const LOCAL_MESSAGE_CACHE_ID = "local";
export const MESSAGE_CACHE_VERSION = 1;
export const MAX_CACHED_MESSAGES = 100;

export type LatestExchange = {
  userMessage: string;
  assistantMessage: string;
  clickedSuggestionId?: ChatSuggestionId | null;
};

export type ChatMessageCache = {
  version: number;
  sessionId: string | null;
  messages: Message[];
  latestExchange: LatestExchange | null;
  updatedAt: number;
};

export type TranscriptMessageRow = {
  _id?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatActionHint;
};

export function createAssistantMessage(
  content: string,
  action?: ChatActionHint | null,
): Message {
  return action
    ? { role: "assistant", content, action }
    : { role: "assistant", content };
}

export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Message>;
  return (
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    (item.action === undefined ||
      item.action === "booking" ||
      item.action === "tour" ||
      item.action === "none")
  );
}

export function isLatestExchange(value: unknown): value is LatestExchange {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LatestExchange>;
  return (
    typeof item.userMessage === "string" &&
    typeof item.assistantMessage === "string" &&
    (item.clickedSuggestionId === undefined ||
      item.clickedSuggestionId === null ||
      typeof item.clickedSuggestionId === "string")
  );
}

export function normalizeCachedMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isMessage).slice(-MAX_CACHED_MESSAGES);
}

export function latestExchangeFromMessages(
  items: Message[],
): LatestExchange | null {
  for (
    let assistantIndex = items.length - 1;
    assistantIndex >= 0;
    assistantIndex -= 1
  ) {
    if (items[assistantIndex]?.role !== "assistant") continue;

    for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
      if (items[userIndex]?.role === "user") {
        return {
          userMessage: items[userIndex].content,
          assistantMessage: items[assistantIndex].content,
        };
      }
    }
  }

  return null;
}

export function previousUserMessageFor(items: Message[], assistantIndex: number) {
  for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
    if (items[userIndex]?.role === "user") return items[userIndex].content;
  }

  return "";
}

export function normalizeTranscriptMessages(
  transcript: TranscriptMessageRow[],
): Message[] {
  return transcript.map((message) =>
    message.role === "assistant" && message.action
      ? createAssistantMessage(message.content, message.action)
      : {
          id: message._id,
          role: message.role,
          content: message.content,
        },
  );
}

/** Flags the guest's latest copy of `content` so the "a team member will reply" note shows after it. */
export function withStaffReplyNotice(
  items: Message[],
  content: string,
): Message[] {
  const index = items.findLastIndex(
    (item) => item.role === "user" && item.content === content,
  );
  if (index === -1) return items;
  const next = [...items];
  next[index] = { ...next[index], staffReplyNotice: true };
  return next;
}

/**
 * Merge admin (staff) messages from the live subscription into the optimistic
 * transcript, deduped by server id. Returns the SAME array reference when there is
 * nothing new, so callers can keep React state stable.
 */
export function mergeAdminMessages(
  items: Message[],
  transcript: { _id?: string; source?: string; content: string }[],
): Message[] {
  const adminMessages = transcript.filter(
    (message) => message.source === "admin" && Boolean(message._id),
  );
  if (adminMessages.length === 0) return items;

  const next = [...items];
  for (const message of adminMessages) {
    if (next.some((item) => item.id === message._id)) continue;
    next.push({ id: message._id, role: "assistant", content: message.content });
  }
  return next.length === items.length ? items : next;
}

export function getMessageCacheStorageKey(sessionId: string | null) {
  return `${MESSAGE_CACHE_STORAGE_PREFIX}${sessionId ?? LOCAL_MESSAGE_CACHE_ID}`;
}

export function getStoredSessionId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
}

export function setStoredSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
}

export function clearStoredSessionId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
}

export function getOrCreateVisitorId() {
  if (typeof window === "undefined") return undefined;

  const existing = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, id);
  return id;
}

export function readCachedChatMessages(
  sessionId: string | null,
): ChatMessageCache | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      getMessageCacheStorageKey(sessionId),
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ChatMessageCache>;
    if (parsed.version !== MESSAGE_CACHE_VERSION) return null;

    const messages = normalizeCachedMessages(parsed.messages);
    if (!messages.length) return null;

    return {
      version: MESSAGE_CACHE_VERSION,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      messages,
      latestExchange: isLatestExchange(parsed.latestExchange)
        ? parsed.latestExchange
        : latestExchangeFromMessages(messages),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeCachedChatMessages(
  sessionId: string | null,
  messages: Message[],
  latestExchange: LatestExchange | null,
) {
  if (typeof window === "undefined") return;

  const cachedMessages = normalizeCachedMessages(messages);
  if (!cachedMessages.length) return;

  const cache: ChatMessageCache = {
    version: MESSAGE_CACHE_VERSION,
    sessionId,
    messages: cachedMessages,
    latestExchange:
      latestExchange ?? latestExchangeFromMessages(cachedMessages),
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(
    getMessageCacheStorageKey(sessionId),
    JSON.stringify(cache),
  );
  if (sessionId) {
    window.localStorage.removeItem(getMessageCacheStorageKey(null));
  }
}

export function clearCachedChatMessages(sessionId: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getMessageCacheStorageKey(sessionId));
}

export function clearKnownChatMessageCaches(sessionId: string | null) {
  clearCachedChatMessages(sessionId);
  clearCachedChatMessages(null);
}
