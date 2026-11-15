"use client";
import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { ChatMessage } from '../chat-types';
import type { GuestCredentials } from './useGuestSession';

export function previousUserMessageFor(items: ChatMessage[], index: number) {
  return items.slice(0, index).findLast(message => message.role === 'user')?.content ?? '';
}
export function latestExchangeFromMessages(items: ChatMessage[]) {
  const index = items.findLastIndex(message => message.role === 'assistant');
  return index < 0 ? null : { userMessage: previousUserMessageFor(items, index), assistantMessage: items[index].content };
}
/** The subscription is the transcript. Sends never append a synthetic connected reply. */
export function useChatTranscript(credentials: GuestCredentials | null) {
  const transcript = useQuery(api.messaging.chat.getMessages, credentials ?? 'skip');
  const session = useQuery(api.messaging.chat.getSession, credentials ?? 'skip');
  const messages = useMemo((): ChatMessage[] => (transcript ?? []).map(row => ({ id: row._id, role: row.role, content: row.content,
    ...(row.action ? { action: row.action } : {}), ...(session?.aiPaused && row.role === 'user' && row._id === transcript?.findLast(message => message.role === 'user')?._id ? { staffReplyNotice: true } : {}),
  })), [transcript, session?.aiPaused]);
  const isTyping = !session?.aiPaused && messages.at(-1)?.role === 'user';
  return { messages, isTyping, aiPaused: !!session?.aiPaused, loading: !!credentials && transcript === undefined };
}
