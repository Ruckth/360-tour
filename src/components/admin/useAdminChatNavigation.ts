"use client";

import type { Id } from "convex/_generated/dataModel";
import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { FILTER_DEFAULTS, type FilterParam } from "./admin-chat-filters";

/** Keeps the queue URL and draft guard in sync with the phone conversation dialog. */
export function useAdminChatNavigation(compact: boolean) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQueryRef = useRef(searchParams.toString());
  const queueHistory = useRef<string | null>(null);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const closingQueue = useRef(false);
  useEffect(() => {
    navigationQueryRef.current = searchParams.toString();
    closingQueue.current = false;
    if (!searchParams.has("session")) queueHistory.current = null;
  }, [searchParams]);
  // Filters and the open chat live in the URL so views can be shared and deep-linked (?session=<id>).
  const leaveReply = useRef<() => Promise<boolean>>(async () => true);
  const setLeaveReply = useCallback((guard: () => Promise<boolean>) => { leaveReply.current = guard; }, []);
  const isCurrentQuery = useCallback((query: string) => navigationQueryRef.current === query, []);
  const updateParams = useCallback(
    (patch: Partial<Record<FilterParam | "session", string | null>>, push = false) => {
      // Compose rapid filter changes against the latest requested URL, including an uncommitted navigation.
      const params = new URLSearchParams(navigationQueryRef.current);
      // A filter change must not leave a conversation from the previous queue open.
      // Search is the exception: typing in it keeps the open chat (and its reply draft) where it is.
      if (!Object.hasOwn(patch, "session") && Object.keys(patch).some((key) => key in FILTER_DEFAULTS && key !== "q"))
        params.delete("session");
      for (const [key, value] of Object.entries(patch)) {
        const fallback = key in FILTER_DEFAULTS ? FILTER_DEFAULTS[key as FilterParam] : "";
        if (!value || value === fallback) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      const commit = () => {
        navigationQueryRef.current = query;
        const navigate = push ? router.push : router.replace;
        navigate(`/admin/chats${query ? `?${query}` : ""}`, { scroll: false });
      };
      if (params.get("session") !== new URLSearchParams(navigationQueryRef.current).get("session")) {
        void leaveReply.current().then(leave => { if (leave) commit(); });
      } else commit();
    },
    [router],
  );
  const selectedSessionId = searchParams.get("session") as Id<"conversations"> | null;
  function selectSession(sessionId: Id<"conversations"> | null) {
    if (sessionId === selectedSessionId) return;
    updateParams({ session: sessionId });
  }
  function openQueueSession(sessionId: Id<"conversations">, trigger: HTMLButtonElement) {
    if (!compact || selectedSessionId) {
      selectSession(sessionId);
      return;
    }
    if (new URLSearchParams(navigationQueryRef.current).has("session")) return;
    queueHistory.current = navigationQueryRef.current;
    queueTrigger.current = trigger;
    updateParams({ session: sessionId }, true);
  }
  async function closeQueueSession() {
    if (closingQueue.current) return;
    const current = navigationQueryRef.current;
    const query = new URLSearchParams(current);
    query.delete("session");
    if (queueHistory.current !== query.toString()) {
      selectSession(null);
      return;
    }
    closingQueue.current = true;
    if (await leaveReply.current() && navigationQueryRef.current === current) {
      window.history.back();
    } else {
      closingQueue.current = false;
    }
  }
  function restoreQueueFocus(event: Event) {
    if (!queueTrigger.current?.isConnected) return;
    event.preventDefault();
    queueTrigger.current.focus({ preventScroll: true });
  }
  return { searchParams, isCurrentQuery, setLeaveReply, selectedSessionId, updateParams, selectSession, openQueueSession, closeQueueSession, restoreQueueFocus };
}
