"use client";
import type { Id } from 'convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import { getStoredGuestToken } from '@/components/chat/session/credentials';
import { api } from 'convex/_generated/api';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConvex } from 'convex/react';

import { selectChatSuggestions, type ChatSuggestionId } from '@/lib/chat/suggestions';
import type { ChatSuggestion } from '../chat-types';
type StaticChatSuggestion = ChatSuggestion;
const VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT = 2;
export function useChatSuggestions(sessionId: Id<"conversations"> | null, activePropertySlug: string | undefined, latestExchange: { userMessage: string; assistantMessage: string; clickedSuggestionId?: ChatSuggestionId | null } | null) {
 const t = useTranslations('Chat');
 const convex = useConvex();
 const [trackedSuggestionIds, setTrackedSuggestionIds] = useState<ChatSuggestionId[] | null>(null);
  const suggestions = useMemo(
    (): StaticChatSuggestion[] => [
      {
        id: "availability",
        text: t("suggestionAvailability"),
        source: "static",
      },
      {
        id: "totalPrice",
        text: t("suggestionTotalPrice"),
        source: "static",
      },
      {
        id: "direct",
        text: t("suggestionDirect"),
        source: "static",
      },
      {
        id: "tour",
        text: t("suggestion360"),
        source: "static",
      },
      {
        id: "guests",
        text: t("suggestionGuests"),
        source: "static",
      },
      {
        id: "contact",
        text: t("suggestionContact"),
        source: "static",
      },
      {
        id: "couple",
        text: t("suggestionCouple"),
        source: "static",
      },
      {
        id: "family",
        text: t("suggestionFamily"),
        source: "static",
      },
      {
        id: "cancellation",
        text: t("suggestionCancellation"),
        source: "static",
      },
      {
        id: "airport",
        text: t("suggestionAirport"),
        source: "static",
      },
      {
        id: "amenitiesIncluded",
        text: t("suggestionAmenitiesIncluded"),
        source: "static",
      },
      {
        id: "location",
        text: t("suggestionLocation"),
        source: "static",
      },
    ],
    [t],
  );
  const orderedStaticSuggestions = useMemo(
    () =>
      selectChatSuggestions({
        candidates: suggestions,
        activePropertySlug: activePropertySlug || undefined,
        latestUserMessage: latestExchange?.userMessage,
        latestAssistantMessage: latestExchange?.assistantMessage,
        clickedSuggestionId: latestExchange?.clickedSuggestionId,
        limit: suggestions.length,
      }) as StaticChatSuggestion[],
    [activePropertySlug, latestExchange, suggestions],
  );
  const visibleSuggestionLimit = latestExchange?.assistantMessage
    ? VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT
    : 6;
  const fallbackVisibleSuggestions = useMemo(
    () => orderedStaticSuggestions.slice(0, visibleSuggestionLimit),
    [orderedStaticSuggestions, visibleSuggestionLimit],
  );
  const visibleSuggestions = useMemo((): ChatSuggestion[] => {
    if (!trackedSuggestionIds) return fallbackVisibleSuggestions;
    const byId = new Map(
      suggestions.map((suggestion) => [suggestion.id, suggestion]),
    );
    return trackedSuggestionIds
      .map((id) => byId.get(id))
      .filter((suggestion): suggestion is StaticChatSuggestion =>
        Boolean(suggestion),
      );
  }, [fallbackVisibleSuggestions, suggestions, trackedSuggestionIds]);
  useEffect(() => {
    let cancelled = false;

    async function loadTrackedStaticSuggestions() {
      setTrackedSuggestionIds(null);
      if (!sessionId || orderedStaticSuggestions.length === 0)
        return;

      try {
        const candidateIds = orderedStaticSuggestions.map(suggestion => suggestion.id);
        const nextSuggestions: FunctionReturnType<typeof api.messaging.chatSuggestions.nextForSession> = [];
        // The public query admits five candidates; retain ranking across all candidates.
        for (let offset = 0; offset < candidateIds.length && nextSuggestions.length < visibleSuggestionLimit; offset += 5) {
          nextSuggestions.push(...await convex.query(api.messaging.chatSuggestions.nextForSession, {
            sessionId, guestToken: getStoredGuestToken(sessionId),
            candidateSuggestionIds: candidateIds.slice(offset, offset + 5),
            limit: visibleSuggestionLimit - nextSuggestions.length,
          }));
        }
        if (cancelled) return;

        if (nextSuggestions.length > 0) {
          await convex.mutation(api.messaging.chatSuggestions.markShown, {
            sessionId,
            suggestions: nextSuggestions,
            guestToken: getStoredGuestToken(sessionId)!,
          }).catch(() => null);
          if (cancelled) return;
        }

        const validIds = new Set(
          suggestions.map((suggestion) => suggestion.id),
        );
        setTrackedSuggestionIds(
          nextSuggestions
            .map((suggestion) => suggestion.suggestionId)
            .filter((id): id is ChatSuggestionId =>
              validIds.has(id as ChatSuggestionId),
            ),
        );
      } catch {
        if (!cancelled) setTrackedSuggestionIds(null);
      }
    }

    void loadTrackedStaticSuggestions();
    return () => {
      cancelled = true;
    };
  }, [
    convex,
    orderedStaticSuggestions,
    sessionId,
    suggestions,
    visibleSuggestionLimit,
  ]);

return { suggestions, visibleSuggestions, resetSuggestions: () => setTrackedSuggestionIds(null) };
}
