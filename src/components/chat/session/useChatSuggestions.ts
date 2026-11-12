"use client";
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalConvex } from '@/lib/react/convex';
import { getNextChatSuggestions, markChatSuggestionsShown } from '@/lib/react/convex-api';
import { selectChatSuggestions, type ChatSuggestionId } from '@/lib/chat/suggestions';
import type { ChatSuggestion } from '../chat-types';
type StaticChatSuggestion = ChatSuggestion;
const VISIBLE_FOLLOW_UP_SUGGESTION_LIMIT = 2;
export function useChatSuggestions(sessionId: string | null, activePropertySlug: string | undefined, latestExchange: { userMessage: string; assistantMessage: string; clickedSuggestionId?: ChatSuggestionId | null } | null) {
 const t = useTranslations('Chat');
 const convex = useOptionalConvex();
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
      if (!convex || !sessionId || orderedStaticSuggestions.length === 0)
        return;

      try {
        const nextSuggestions = await getNextChatSuggestions(convex, {
          sessionId,
          candidateSuggestionIds: orderedStaticSuggestions.map(
            (suggestion) => suggestion.id,
          ),
          limit: visibleSuggestionLimit,
        });
        if (cancelled) return;

        if (nextSuggestions.length > 0) {
          await markChatSuggestionsShown(convex, {
            sessionId,
            suggestions: nextSuggestions,
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
