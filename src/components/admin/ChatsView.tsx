"use client";

import {
  type SessionStatus,
  type EmptyChatFilter,
  statusTabs,
  statusOptions,
  type InboxStateFilter,
  type InboxQueue,
  queueTabs,
  queueParams,
  adminStatusOptions,
  adminStatusTabs,
  emptyFilterOptions,
  channelFilterOptions,
  FILTER_DEFAULTS,
  type FilterParam,
  readOption,
  dateTimeInputToMillis,
  dateTimeBadgeLabel,
  emptyFilterLabel,
  channelFilterLabel,
} from "./admin-chat-filters";
import { CHAT_SHORTCUT_KEYS, CHAT_SHORTCUTS, Kbd } from "./chat-shortcuts";
import { useSafeQueueCounts } from "./waiting-chats";
import { CheckCheck, ChevronRight, Filter, Keyboard, Search } from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { isChatSessionActive } from "convex/shared/chatPresence";
import { useMutation, usePaginatedQuery, useQueries, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { RemovableBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminDateTimeFilterField } from "@/components/admin/AdminDateTimeFilterField";
import { AdminSessionActions } from "@/components/admin/AdminSessionActions";
import { AdminSessionDetail, chronologicalTranscriptMessages } from "@/components/admin/AdminSessionDetail";
import { BusinessFactFormDialog, type FactFormTarget } from "@/components/admin/BusinessFactFormDialog";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { sourceLabel } from "@/components/admin/labels";
import { TONES } from "@/components/admin/status-tones";
import { useAdminReplyComposer } from "@/components/admin/useAdminReplyComposer";
import type { AdminFactProperty } from "@/components/admin/business-facts-form";
import {
  ChannelIcon,
  plainText,
  relativeTime,
  truncate,
  visitorLabel,
} from "@/components/admin/admin-chat-format";
import type {
  AdminMessage,
  AdminSession,
  SessionChannelFilter,
  SessionDetailResult,
  SessionListResult,
  TranscriptPaginationResult,
} from "@/components/admin/admin-chat-types";
import { shortcutKey } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

const PRESENCE_CLOCK_MS = 10_000;

function usePresenceClock(intervalMs = PRESENCE_CLOCK_MS) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, intervalMs);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") update();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);

  return now;
}

/** "Live now" follows the local clock, so the queries don't resubscribe on every presence tick. */
function withLivePresence<T extends AdminSession>(session: T, now: number): T {
  const isActive = isChatSessionActive(session, now);
  return session.isActive === isActive ? session : { ...session, isActive };
}

/** `undefined` until the browser has answered, so neither layout is assumed on first paint. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean>();

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** The last defined value for this `resetKey`; a new key starts again from the current value. */
function useLatestDefined<T>(value: T | undefined, resetKey: string) {
  // Defined values must retain identity between updates, as Convex query results do.
  const [latest, setLatest] = useState<{ resetKey: string; value: T | undefined }>({ resetKey, value });
  const next = value !== undefined ? value : latest.resetKey === resetKey ? latest.value : undefined;
  if (latest.resetKey !== resetKey || latest.value !== next) setLatest({ resetKey, value: next });
  return next;
}

export function ChatsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQueryRef = useRef(searchParams.toString());
  useEffect(() => {
    navigationQueryRef.current = searchParams.toString();
  }, [searchParams]);
  const now = usePresenceClock();
  const presenceMinute = Math.floor(now / 60_000) * 60_000;
  const largeViewport = useMediaQuery("(min-width: 1024px)");
  const isLargeViewport = largeViewport === true;
  // Filters and the open chat live in the URL so views can be shared and deep-linked (?session=<id>).
  const leaveReply = useRef<() => Promise<boolean>>(async () => true);
  const updateParams = useCallback(
    (patch: Partial<Record<FilterParam | "session", string | null>>) => {
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
        router.replace(`/admin/chats${query ? `?${query}` : ""}`, { scroll: false });
      };
      if (params.get("session") !== new URLSearchParams(navigationQueryRef.current).get("session")) {
        void leaveReply.current().then(leave => { if (leave) commit(); });
      } else commit();
    },
    [router],
  );
  const adminStatus = readOption(searchParams.get("state"), adminStatusOptions, FILTER_DEFAULTS.state);
  // Older Done links omitted activity because All used to be the default.
  const status = readOption(
    searchParams.get("view"),
    statusOptions,
    adminStatus === "open" ? FILTER_DEFAULTS.view : "all",
  );
  const emptyFilter = readOption(searchParams.get("empty"), emptyFilterOptions, FILTER_DEFAULTS.empty);
  const channelFilter = readOption(searchParams.get("channel"), channelFilterOptions, FILTER_DEFAULTS.channel);
  const messageStartAt = searchParams.get("from") ?? "";
  const messageEndAt = searchParams.get("to") ?? "";
  const setStatus = (value: SessionStatus) => updateParams({ view: value });
  const setAdminStatus = (value: InboxStateFilter) => updateParams({ state: value, view: "all" });
  const queue: InboxQueue = adminStatus !== "open" ? "done" : status === "needs_reply" ? "waiting" : "open";
  const setQueue = (value: InboxQueue) => updateParams(queueParams(value));
  const setEmptyFilter = (value: EmptyChatFilter) => updateParams({ empty: value });
  const setChannelFilter = (value: SessionChannelFilter) => updateParams({ channel: value });
  const setMessageStartAt = (value: string) => updateParams({ from: value });
  const setMessageEndAt = (value: string) => updateParams({ to: value });
  // Typing stays local; the URL follows after a short pause.
  const urlSearchQuery = searchParams.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(urlSearchQuery);
  const lastWrittenSearchQuery = useRef(urlSearchQuery);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageDepth, setPageDepth] = useState(1);
  const [retryKeys, setRetryKeys] = useState<Record<number, string>>({});
  const selectedSessionId = searchParams.get("session") as Id<"conversations"> | null;
  const [incomingSessionId, setIncomingSessionId] = useState(() =>
    !searchParams.has("view") && !searchParams.has("state") ? selectedSessionId : null,
  );
  function selectSession(sessionId: Id<"conversations"> | null) {
    if (sessionId === selectedSessionId) return;
    updateParams({ session: sessionId });
  }
  // Saved answers are retired: a guest question can seed a draft business fact instead.
  const [factTarget, setFactTarget] = useState<FactFormTarget | null>(null);
  const factProperties = useQuery(api.catalog.properties.adminList, factTarget ? {} : "skip") as
    | AdminFactProperty[]
    | undefined;
  const settleGuestMessageMutation = useMutation(api.messaging.adminChat.settleGuestMessage);
  // The ref guards repeat clicks and `e` before React commits; the state drives the buttons.
  const settlingRef = useRef(new Set<Id<"messages">>());
  const [settlingMessageIds, setSettlingMessageIds] = useState<ReadonlySet<Id<"messages">>>(() => new Set());
  const [settleError, setSettleError] = useState<string | null>(null);
  // Who was just marked No reply needed, confirmed briefly in the list once the next chat opens.
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (!cleared) return;
    const timeout = window.setTimeout(() => setCleared(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [cleared]);
  const trimmedSearchQuery = searchQuery.trim();
  const parsedMessageStartAt = dateTimeInputToMillis(messageStartAt, "start");
  const parsedMessageEndAt = dateTimeInputToMillis(messageEndAt, "end");
  const invalidMessageDateRange =
    typeof parsedMessageStartAt === "number" &&
    typeof parsedMessageEndAt === "number" &&
    parsedMessageStartAt > parsedMessageEndAt;
  const filterResetKey = [
    status,
    adminStatus,
    urlSearchQuery.trim(),
    emptyFilter,
    channelFilter,
    messageStartAt,
    messageEndAt,
  ].join(":");
  // A new filter starts again from the first page.
  const [pagedFilterKey, setPagedFilterKey] = useState(filterResetKey);
  if (pagedFilterKey !== filterResetKey) {
    setPagedFilterKey(filterResetKey);
    setPageCursors([null]);
    setPageDepth(1);
    setRetryKeys({});
  }
  const queueCounts = useSafeQueueCounts();
  const queryText = urlSearchQuery.trim();
  const listRequests = useMemo(() => Object.fromEntries(
    (invalidMessageDateRange ? [] : pageCursors).map((cursor, index) => [String(index), {
      query: api.messaging.adminChat.listSessions,
      args: {
        paginationOpts: { numItems: 10, cursor },
        ...(retryKeys[index] ? { retryKey: retryKeys[index] } : {}),
        status,
        adminStatus,
        empty: emptyFilter,
        channel: channelFilter,
        ...(queryText ? { searchQuery: queryText } : {}),
        ...(parsedMessageStartAt === undefined ? {} : { messageStartAt: parsedMessageStartAt }),
        ...(parsedMessageEndAt === undefined ? {} : { messageEndAt: parsedMessageEndAt }),
        ...(status === "active" || status === "inactive" ? { now: presenceMinute } : {}),
      },
    }]),
  ), [invalidMessageDateRange, pageCursors, retryKeys, status, adminStatus, emptyFilter, channelFilter, queryText, parsedMessageStartAt, parsedMessageEndAt, presenceMinute]);
  const listResults = useQueries(listRequests) as Record<string, SessionListResult | Error | undefined>;
  const firstPage = listResults["0"];
  const { sessions, lastPage, failedPage, replacementCursors, loadingOlder } = useMemo(() => {
    const loadedPages: SessionListResult[] = [];
    let failedPage: number | undefined;
    let replacementCursors: Array<string | null> | undefined;
    // A later page is valid only while its input matches the preceding live boundary.
    for (let index = 0; index < pageCursors.length; index++) {
      const page = listResults[String(index)];
      if (page instanceof Error) {
        failedPage = index;
        break;
      }
      if (!page) break;
      loadedPages.push(page);
      const next = page.continueCursor ?? page.nextCursor ?? null;
      if (page.isDone || !next) {
        if (index + 1 < pageCursors.length) replacementCursors = pageCursors.slice(0, index + 1);
        break;
      }
      if (next !== pageCursors[index + 1]) {
        if (index + 1 < pageDepth) replacementCursors = [...pageCursors.slice(0, index + 1), next];
        break;
      }
    }
    const byId = new Map<Id<"conversations">, AdminSession>();
    for (const page of loadedPages) {
      for (const session of page.sessions) {
        if (!byId.has(session._id)) byId.set(session._id, withLivePresence(session, now));
      }
    }
    return {
      sessions: [...byId.values()],
      lastPage: loadedPages.at(-1),
      failedPage,
      replacementCursors,
      loadingOlder: failedPage === undefined && (
        replacementCursors !== undefined || loadedPages.length < pageCursors.length
      ),
    };
  }, [listResults, pageCursors, pageDepth, now]);
  useEffect(() => {
    if (!replacementCursors) return;
    let live = true;
    queueMicrotask(() => {
      if (live) setPageCursors(current => current === pageCursors ? replacementCursors : current);
    });
    return () => { live = false; };
  }, [pageCursors, replacementCursors]);
  const liveSessionDetail = useQuery(
    api.messaging.adminChat.getSessionDetail,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip",
  ) as SessionDetailResult | null | undefined;
  const transcriptPagination = usePaginatedQuery(
    api.messaging.adminChat.listTranscriptMessages,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip",
    { initialNumItems: 10 },
  ) as TranscriptPaginationResult;
  const sessionDetail = useLatestDefined(liveSessionDetail, selectedSessionId ?? "none");
  const reply = useAdminReplyComposer(selectedSessionId, sessionDetail?.session.latestGuestMessageId);
  useEffect(() => { leaveReply.current = reply.confirmLeave; }, [reply.confirmLeave]);
  const unqualifiedDeepLink =
    Boolean(selectedSessionId) &&
    incomingSessionId === selectedSessionId &&
    !searchParams.has("view") &&
    !searchParams.has("state");
  // Once the URL names a queue (or another chat), the incoming deep link is spent.
  if (!unqualifiedDeepLink && incomingSessionId) setIncomingSessionId(null);
  useEffect(() => {
    // Links from staff alerts and Missing Information have no queue. Open their actual conversation.
    if (!unqualifiedDeepLink || !sessionDetail?.session || navigationQueryRef.current !== searchParams.toString())
      return;
    const selectedStatus = sessionDetail.session.adminStatus ?? "open";
    if (selectedStatus === "open" && sessionDetail.session.needsReply) {
      // Consume a Waiting link once. Later live replies must stay in the chosen queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- gated on the in-flight navigation ref, which render can't read
      setIncomingSessionId(null);
      return;
    }
    // Keep the incoming transcript visible until the matching queue URL commits.
    updateParams({
      view: selectedStatus === "open" && sessionDetail.session.inboxState === "processing" ? "in_progress" : "all",
      state: selectedStatus === "open" ? "open" : "done",
      session: selectedSessionId,
    });
  }, [incomingSessionId, unqualifiedDeepLink, sessionDetail, searchParams, selectedSessionId, updateParams]);
  const transcriptMessages = useMemo(
    () => chronologicalTranscriptMessages(transcriptPagination.results),
    [transcriptPagination.results],
  );
  const loadingSessions = !invalidMessageDateRange && firstPage === undefined;
  const loadingTranscript =
    Boolean(selectedSessionId) &&
    (sessionDetail === undefined || transcriptPagination.status === "LoadingFirstPage") &&
    transcriptMessages.length === 0;
  const selectedSession = useMemo(() => {
    const candidate =
      (sessionDetail?.session && sessionDetail.session._id === selectedSessionId ? withLivePresence(sessionDetail.session, now) : null) ??
      sessions.find((session) => session._id === selectedSessionId);
    if (!candidate) return null;
    if (unqualifiedDeepLink || candidate.inboxState) return candidate;
    const candidateStatus = candidate.adminStatus ?? "open";
    if (adminStatus === "done" ? candidateStatus === "open" : candidateStatus !== adminStatus) return null;
    if (status === "needs_reply" && !candidate.needsReply && !reply.pending) return null;
    return candidate;
  }, [
    selectedSessionId,
    sessions,
    sessionDetail,
    now,
    adminStatus,
    status,
    unqualifiedDeepLink,
    reply.pending,
  ]);

  function sendAdminReply() {
    // The transcript stays on screen while the backend moves the conversation to its new queue.
    return reply.send();
  }

  async function settleGuestMessage(session: AdminSession, messageId: Id<"messages">, onSettled?: () => void) {
    const sessionId = session._id;
    if (session.inboxReason === "sending" || (sessionId === selectedSessionId && reply.pending)) return;
    if (settlingRef.current.has(messageId)) return;
    settlingRef.current.add(messageId);
    setSettlingMessageIds(new Set(settlingRef.current));
    setSettleError(null);
    try {
      const discard = sessionId === selectedSessionId ? await reply.prepareDiscard() : undefined;
      if (discard === null) return;
      await settleGuestMessageMutation({ sessionId, messageId, expectedAssignedEmail: session.assignedAdminEmail ?? null });
      discard?.();
      onSettled?.();
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : "Unable to mark the message as settled.");
    } finally {
      settlingRef.current.delete(messageId);
      setSettlingMessageIds(new Set(settlingRef.current));
    }
  }

  function handleNextPage() {
    const nextCursor = lastPage?.continueCursor ?? lastPage?.nextCursor ?? null;
    if (!nextCursor || lastPage?.isDone) return;
    setPageDepth(pageCursors.length + 1);
    setPageCursors(current => current.includes(nextCursor) ? current : [...current, nextCursor]);
  }

  const detailProps = {
    canLoadOlderMessages: transcriptPagination.status === "CanLoadMore",
    facebookEvents: sessionDetail?.facebookEvents,
    instagramEvents: sessionDetail?.instagramEvents,
    lineEvents: sessionDetail?.lineEvents,
    whatsappEvents: sessionDetail?.whatsappEvents,
    loadOlderMessages: () => transcriptPagination.loadMore(20),
    loadingTranscript,
    loadingOlderMessages: transcriptPagination.status === "LoadingMore",
    messages: transcriptMessages,
    now,
    selectedSession,
    replyDraft: reply.draft,
    onReplyDraftChange: reply.setDraft,
    onSendReply: sendAdminReply,
    replyPending: reply.pending,
    replyError: reply.error,
    replyStatus: reply.status,
    replyWindow: sessionDetail?.replyWindow,
    linkedStay: sessionDetail?.linkedStay,
    onAddBusinessFact: (message: AdminMessage) => setFactTarget({ fromMessage: { question: message.content, propertySlug: selectedSession?.propertySlug } }),
  };

  function renderDetail(compact = false) {
    const detail = (actions?: ReactNode, followUp?: ReactNode, actionError?: ReactNode, replyAction?: ReactNode, handoff?: ReactNode) => (
      <AdminSessionDetail
        key={selectedSession?._id ?? "none"}
        {...detailProps}
        compact={compact}
        emptyList={!loadingSessions && failedPage === undefined && sessions.length === 0}
        onBack={compact ? () => selectSession(null) : undefined}
        actions={actions}
        replyAction={replyAction}
        actionError={actionError}
        followUp={followUp}
        handoff={handoff}
      />
    );
    return selectedSession ? (
      <AdminSessionActions
        key={selectedSession._id}
        now={now}
        session={{ ...selectedSession, latestGuestMessageId:
          selectedSession.latestGuestMessageId ?? sessionDetail?.session.latestGuestMessageId }}
        beforeLeave={reply.confirmLeave}
        onDeleted={() => {
          if (navigationQueryRef.current === searchParams.toString()) selectSession(null);
        }}
        onStatusChanged={(nextStatus) => {
          // A completed mutation must not replace navigation requested while it was pending.
          if (navigationQueryRef.current !== searchParams.toString()) return;
          if (nextStatus === "open") {
            updateParams({ ...queueParams("open"), session: selectedSession._id });
            return;
          }
          const index = sessions.findIndex((session) => session._id === selectedSession._id);
          const next = sessions[index + 1] ?? sessions[index - 1];
          if (nextStatus === "resolved") {
            // No reply needed: the chat is handled, so open the next one at every size.
            setCleared(visitorLabel(selectedSession));
            selectSession(next?._id ?? null);
          } else selectSession(isLargeViewport ? (next?._id ?? null) : null);
        }}
      >
        {({ actions, followUp, actionError, replyAction, handoff }) => detail(actions, followUp, actionError, replyAction, handoff)}
      </AdminSessionActions>
    ) : detail();
  }

  useEffect(() => {
    if (!isLargeViewport || selectedSessionId || !sessions.length) return;
    updateParams({ session: sessions[0]._id });
  }, [isLargeViewport, selectedSessionId, sessions, updateParams]);

  // When ?q changes from outside (back/forward, a link, clearing filters), adopt it instead of
  // writing the old text back. Our own writes are recognised by the last value we sent.
  useEffect(() => {
    if (urlSearchQuery === lastWrittenSearchQuery.current) return;
    lastWrittenSearchQuery.current = urlSearchQuery;
    setSearchQuery(urlSearchQuery);
  }, [urlSearchQuery]);

  useEffect(() => {
    if (urlSearchQuery === trimmedSearchQuery) return;
    const timeout = window.setTimeout(() => {
      lastWrittenSearchQuery.current = trimmedSearchQuery;
      updateParams({ q: trimmedSearchQuery });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [urlSearchQuery, trimmedSearchQuery, updateParams]);

  const activeFilterCount = [
    status === "active" || status === "inactive",
    adminStatus === "resolved" || adminStatus === "archived",
    emptyFilter !== "non_empty",
    channelFilter !== "all",
    messageStartAt,
    messageEndAt,
  ].filter(Boolean).length;
  const emptyList: { message: string; action?: ReactNode } =
    lastPage && !lastPage.isDone && sessions.length === 0
      ? {
          message: "No matching chats on this page.",
          action: (
            <Button type="button" size="sm" onClick={handleNextPage}>
              Check older chats
            </Button>
          ),
        }
      : trimmedSearchQuery || activeFilterCount > 0
        ? {
            message: "No chats match this search and these filters.",
            action: (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  updateParams({
                    q: null,
                    empty: null,
                    channel: null,
                    from: null,
                    to: null,
                    ...queueParams(queue),
                  });
                }}
              >
                Clear search and filters
              </Button>
            ),
          }
        : status === "needs_reply" && adminStatus === "open"
          ? {
              message: "You’re all caught up. No chats are waiting for your reply.",
              action: (
                <Button type="button" size="sm" onClick={() => setStatus("all")}>
                  Show all open chats
                </Button>
              ),
            }
          : adminStatus !== "open"
            ? {
                message: adminStatus === "done" ? "No completed chats yet." : `No ${adminStatus} chats here.`,
                action: (
                  <Button type="button" size="sm" onClick={() => setQueue("open")}>
                    Show open chats
                  </Button>
                ),
              }
            : status !== "all"
              ? {
                  message: "No open chats match this activity filter.",
                  action: (
                    <Button type="button" size="sm" onClick={() => setStatus("all")}>
                      Show all open chats
                    </Button>
                  ),
                }
              : {
                  message: "No chats yet. Guest chats from every channel appear here.",
                };

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const selectedIndex = sessions.findIndex((session) => session._id === selectedSessionId);

  function moveSelection(step: 1 | -1) {
    if (sessions.length === 0) return;
    const next = selectedIndex === -1 ? 0 : Math.min(Math.max(selectedIndex + step, 0), sessions.length - 1);
    selectSession(sessions[next]._id);
    document.querySelector(`[data-session-id="${sessions[next]._id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  const onShortcut = useEffectEvent((key: string) => {
    if (key === "?") setShortcutsOpen(true);
    else if (key === "/") document.getElementById("admin-chat-search")?.focus();
    else if (key === "j") moveSelection(1);
    else if (key === "k") moveSelection(-1);
    else if (key === "r")
      document.getElementById(isLargeViewport ? "admin-reply-desktop" : "admin-reply-mobile")?.focus();
    else if (key === "e") {
      const session = sessions[selectedIndex];
      if (!session?.needsReply) return;
      const messageId = session.latestGuestMessageId ?? (session.latestMessage?.role === "user" ? session.latestMessage._id : undefined);
      if (!messageId) return;
      void settleGuestMessage(session, messageId, () => {
        if (status === "needs_reply" && navigationQueryRef.current === searchParams.toString()) {
          moveSelection(selectedIndex < sessions.length - 1 ? 1 : -1);
        }
      });
    }
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = shortcutKey(
        {
          key: event.key,
          target: event.target instanceof HTMLElement ? event.target : null,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        CHAT_SHORTCUT_KEYS,
      );
      // Open dialogs and popovers own the keyboard.
      if (!key || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      event.preventDefault();
      onShortcut(key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="min-h-0 flex-1 p-3 sm:p-5">
        <div className="grid h-full min-h-0 overflow-hidden max-lg:rounded-none max-lg:border-0 rounded-xl border border-border/60 bg-card shadow-sm lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside
            aria-label="Chat list"
            className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-card lg:border-r lg:border-border/60"
          >
            <div className="grid gap-3 p-4 pb-3">
              {/* Phones show the page title only; shortcuts are offered where there's a mouse and keyboard. */}
              <div className="flex items-center justify-between max-md:contents">
                <h2 className="font-serif text-2xl font-semibold max-md:sr-only">Chats</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden h-8 gap-1.5 px-2 text-xs font-medium text-muted-foreground pointer-fine:inline-flex pointer-coarse:hidden"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <Keyboard className="size-4" aria-hidden="true" />
                  Shortcuts
                </Button>
              </div>
              <SegmentedTabs
                tabs={queueTabs.map(tab => {
                  const count = tab.value === "waiting" ? queueCounts?.waiting : tab.value === "open" ? queueCounts?.inProgress : undefined;
                  return { ...tab, label: count === undefined ? tab.label : `${tab.label} · ${count >= 100 ? "99+" : count}` };
                })}
                value={queue}
                onValueChange={setQueue}
                label="Chat queue"
                controls="admin-chat-list"
                fill
              />
              <div className="mt-1 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="admin-chat-search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") event.currentTarget.blur();
                    }}
                    className="h-9 rounded-lg pl-9"
                    placeholder="Search chats"
                    aria-label="Search chats"
                    aria-keyshortcuts="/"
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn("h-9 shrink-0 rounded-lg px-3", activeFilterCount > 0 && "border-ring")}
                      aria-label={activeFilterCount > 0 ? `Filters ${activeFilterCount} active` : "Filters"}
                    >
                      <Filter aria-hidden="true" className="h-4 w-4" />
                      Filters{" "}
                      {activeFilterCount > 0 ? (
                        <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                          {activeFilterCount}
                        </span>
                      ) : null}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[24rem] max-w-[calc(100vw-2rem)] space-y-4">
                    <p className="text-sm font-semibold text-foreground">Filters</p>
                    <div className="space-y-2">
                      <p className="admin-eyebrow">Chat status</p>
                      <SegmentedTabs
                        tabs={adminStatusTabs}
                        value={adminStatus}
                        onValueChange={setAdminStatus}
                        label="Chat status"
                        fill
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="admin-eyebrow">Guest activity</p>
                      <SegmentedTabs
                        tabs={statusTabs}
                        value={status === "active" || status === "inactive" ? status : "all"}
                        onValueChange={setStatus}
                        label="Guest activity"
                        fill
                      />
                    </div>
                    <div className="space-y-2">
                      <p id="admin-chat-empty-filter" className="admin-eyebrow">
                        Message status
                      </p>
                      <ToggleGroup
                        value={emptyFilter}
                        onValueChange={setEmptyFilter}
                        aria-labelledby="admin-chat-empty-filter"
                        className="grid grid-cols-2"
                      >
                        {(["non_empty", "empty"] satisfies EmptyChatFilter[]).map((option) => (
                          <ToggleGroupItem key={option} value={option} className="px-2">
                            {option === "non_empty" ? "Not empty" : "Empty"}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                    <div className="space-y-2">
                      <p id="admin-chat-channel-filter" className="admin-eyebrow">
                        Channel
                      </p>
                      <ToggleGroup
                        value={channelFilter}
                        onValueChange={setChannelFilter}
                        aria-labelledby="admin-chat-channel-filter"
                        className="grid grid-cols-2"
                      >
                        {channelFilterOptions.map((option) => (
                          <ToggleGroupItem key={option} value={option} className="min-w-0 justify-start px-2">
                            {option === "all" ? null : (
                              <ChannelIcon channel={option} className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span className="truncate">{channelFilterLabel(option)}</span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                    <div className="grid gap-3">
                      <AdminDateTimeFilterField
                        id="admin-message-start"
                        label="Latest message start"
                        value={messageStartAt}
                        onChange={setMessageStartAt}
                        defaultHour="00"
                        defaultMinute="00"
                      />
                      <AdminDateTimeFilterField
                        id="admin-message-end"
                        label="Latest message end"
                        value={messageEndAt}
                        onChange={setMessageEndAt}
                        defaultHour="23"
                        defaultMinute="59"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activeFilterCount === 0}
                        onClick={() => {
                          updateParams({
                            empty: null,
                            channel: null,
                            from: null,
                            to: null,
                            ...queueParams(queue),
                          });
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              {trimmedSearchQuery || activeFilterCount > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {trimmedSearchQuery ? (
                    <RemovableBadge removeLabel="Clear search" onRemove={() => setSearchQuery("")}>
                      Search: {truncate(trimmedSearchQuery, 24)}
                    </RemovableBadge>
                  ) : null}
                  {status === "active" || status === "inactive" ? (
                    <RemovableBadge removeLabel="Clear guest activity filter" onRemove={() => setStatus(queueParams(queue).view)}>
                      {status === "active" ? "Live guests" : "Inactive guests"}
                    </RemovableBadge>
                  ) : null}
                  {adminStatus === "resolved" || adminStatus === "archived" ? (
                    <RemovableBadge removeLabel="Clear chat status filter" onRemove={() => setAdminStatus("done")}>
                      {adminStatusTabs.find(({ value }) => value === adminStatus)?.label}
                    </RemovableBadge>
                  ) : null}
                  {emptyFilter !== "non_empty" ? (
                    <RemovableBadge removeLabel="Clear empty filter" onRemove={() => setEmptyFilter("non_empty")}>
                      {emptyFilterLabel(emptyFilter)}
                    </RemovableBadge>
                  ) : null}
                  {channelFilter !== "all" ? (
                    <RemovableBadge removeLabel="Clear channel filter" onRemove={() => setChannelFilter("all")}>
                      <ChannelIcon channel={channelFilter} className="h-3.5 w-3.5" />
                      {channelFilterLabel(channelFilter)}
                    </RemovableBadge>
                  ) : null}
                  {messageStartAt ? (
                    <RemovableBadge removeLabel="Clear message start" onRemove={() => setMessageStartAt("")}>
                      From {dateTimeBadgeLabel(messageStartAt)}
                    </RemovableBadge>
                  ) : null}
                  {messageEndAt ? (
                    <RemovableBadge removeLabel="Clear message end" onRemove={() => setMessageEndAt("")}>
                      To {dateTimeBadgeLabel(messageEndAt)}
                    </RemovableBadge>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div id="admin-chat-list" aria-busy={loadingSessions} className="min-h-0 overflow-y-auto px-2 pb-2">
              {cleared ? (
                <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                  No reply needed · {cleared}
                </p>
              ) : null}
              {settleError ? (
                <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
                  {settleError}
                </p>
              ) : null}
              {invalidMessageDateRange ? (
                <p role="alert" className="p-5 text-sm leading-6 text-destructive">
                  Latest message start must be before latest message end.
                </p>
              ) : null}
              {loadingSessions && sessions.length === 0 ? <SkeletonRows label="Loading chats" rows={6} /> : null}
              {!invalidMessageDateRange && !loadingSessions && failedPage === undefined && !loadingOlder && sessions.length === 0 ? (
                <EmptyState action={emptyList.action}>{emptyList.message}</EmptyState>
              ) : null}
              {sessions.map((session) => {
                const unansweredMessageId = session.needsReply && session.inboxReason !== "sending" ? (session.latestGuestMessageId ?? (session.latestMessage?.role === "user" ? session.latestMessage._id : undefined)) : undefined;
                const selected = selectedSessionId === session._id;
                const preview = session.latestMessage ? plainText(session.latestMessage.content) : "No messages yet";
                const overdue = session.staffTask && session.staffTaskDueAt !== undefined && session.staffTaskDueAt <= now;
                const waiting = session.needsReply && (session.adminStatus ?? "open") === "open";
                const place = session.propertyName ?? session.propertySlug;
                return (
                  <div
                    key={session._id}
                    data-session-id={session._id}
                    className={cn(
                      "group relative mb-0.5 flex items-center rounded-xl border border-transparent transition hover:bg-muted/60",
                      selected &&
                        "border-gold/15 bg-gold/10 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-full before:bg-gold-text",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectSession(session._id)}
                      aria-current={selected ? "true" : undefined}
                      className="min-w-0 flex-1 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {/* Two lines, so the landscape iPad shows about ten: who, where and how long; then what they said. */}
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChannelIcon channel={session.channel} className="h-3.5 w-3.5 shrink-0" />
                        <span className="sr-only">{sourceLabel(session.channel)} ·</span>
                        <span className="min-w-0 truncate text-[15px] font-medium text-foreground" title={visitorLabel(session)}>
                          {visitorLabel(session)}
                        </span>
                        <span className={cn("ml-auto shrink-0 pl-2 text-xs", waiting ? "font-semibold text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                          {waiting ? `Waiting ${relativeTime(session.latestMessageAt, now).replace(/ ago$/, "")}` : relativeTime(session.latestMessageAt, now)}
                        </span>
                      </span>
                      {place ? <span className="mt-1 block text-xs text-muted-foreground">{place}</span> : null}
                      <span className="mt-0.5 flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={preview}>
                          {preview}
                        </span>
                        {/* In the Needs-you queue every row needs you; elsewhere (search, other tabs) say so. */}
                        {overdue ? <span className="text-xs text-destructive">Follow-up overdue</span> : null}
                        {waiting && queue !== "waiting" ? (
                          <span className={cn("shrink-0 rounded-full px-1.5 text-xs font-medium", TONES.warning.bg, TONES.warning.text)}>
                            Needs you
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {unansweredMessageId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => settleGuestMessage(session, unansweredMessageId)}
                        disabled={settlingMessageIds.has(unansweredMessageId) || (selected && reply.pending)}
                        aria-label={`No reply needed for ${visitorLabel(session)}`}
                        title="No reply needed (e)"
                        className={cn(
                          "mr-1 size-8 shrink-0 rounded-full opacity-0 pointer-coarse:h-11 pointer-coarse:w-auto focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
                          TONES.warning.text,
                        )}
                      >
                        <CheckCheck className="h-4 w-4 pointer-coarse:hidden" aria-hidden="true" />
                        <span className="hidden pointer-coarse:inline">No reply needed</span>
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <span>{loadingSessions ? "Loading chats…" : `${sessions.length} ${sessions.length === 1 ? "chat" : "chats"} loaded`}</span>
              {failedPage !== undefined ? (
                <>
                  <span role="status">{failedPage === 0 ? "Couldn’t load chats." : "Couldn’t load older chats."}</span>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => {
                      const failure = listResults[String(failedPage)];
                      const expiredCursor = failedPage > 0 && failure instanceof Error && failure.message.includes("InvalidCursor");
                      const retryKey = crypto.randomUUID();
                      if (expiredCursor) setPageCursors([null]);
                      setRetryKeys(current => expiredCursor ? { 0: retryKey } : { ...current, [failedPage]: retryKey });
                    }}>
                    {failedPage === 0 ? "Retry chats" : "Retry older chats"}
                  </Button>
                </>
              ) : !invalidMessageDateRange && !loadingSessions && (loadingOlder || !lastPage?.isDone) ? (
                <Button type="button" variant="outline" size="sm" onClick={handleNextPage}
                  disabled={loadingOlder || !lastPage || !(lastPage.continueCursor ?? lastPage.nextCursor)}>
                  {loadingOlder ? "Loading older chats…" : "Load older chats"}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
          </aside>

          <section aria-label="Selected chat" className="hidden min-h-0 bg-card lg:block">
            {/* Mobile uses the dialog below. Until the viewport is known, CSS keeps this hidden on small screens. */}
            {largeViewport !== false ? renderDetail() : null}
          </section>
        </div>
      </div>
      <Dialog
        open={largeViewport === false && Boolean(selectedSession)}
        onOpenChange={(isOpen) => {
          if (!isOpen) selectSession(null);
        }}
      >
        <DialogContent
          data-testid="admin-chat-detail-dialog"
          className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 max-md:rounded-none max-md:border-0 max-md:max-h-dvh max-md:pb-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {selectedSession ? `Chat details for ${visitorLabel(selectedSession)}` : "Chat details"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visitor context and transcript for the selected chat session.
          </DialogDescription>
          {renderDetail(true)}
        </DialogContent>
      </Dialog>
      <BusinessFactFormDialog
        target={factTarget}
        properties={factProperties ?? []}
        onClose={() => setFactTarget(null)}
      />
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>They work when the cursor is not in a text box.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {CHAT_SHORTCUTS.map(([keys, label]) => (
              <div key={label} className="contents">
                <dt className="flex gap-1">
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
