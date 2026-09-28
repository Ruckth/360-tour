"use client";

import { useAuth } from "@clerk/nextjs";
import { CheckCheck, ChevronLeft, ChevronRight, Filter, Keyboard, Search } from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { AnswerFormDialog, type AnswerFormTarget } from "@/components/admin/AnswerFormDialog";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { SetupBanner } from "@/components/admin/SetupChecklist";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { sourceLabel } from "@/components/admin/labels";
import { TONES, statusMeta } from "@/components/admin/status-tones";
import type { AdminKnowledgePropertyScope } from "@/components/admin/admin-knowledge-types";
import {
  ChannelIcon,
  formatDateTime,
  relativeTime,
  truncate,
  visitorLabel,
} from "@/components/admin/admin-chat-format";
import type {
  AdminMessage,
  AdminSessionStatus,
  SessionChannelFilter,
  SessionDetailResult,
  SessionListResult,
  TranscriptPaginationResult,
} from "@/components/admin/admin-chat-types";
import { shortcutKey } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

type SessionStatus = "needs_reply" | "active" | "all" | "inactive";
type EmptyChatFilter = "non_empty" | "empty";

const statusTabs = [
  { value: "needs_reply", label: "Needs reply" },
  { value: "active", label: "Live" },
  { value: "all", label: "All" },
  { value: "inactive", label: "Inactive" },
] satisfies { value: SessionStatus; label: string }[];
const statusOptions = statusTabs.map((tab) => tab.value);
const adminStatusOptions = ["open", "resolved", "archived"] satisfies AdminSessionStatus[];
const adminStatusTabs = adminStatusOptions.map((value) => ({ value, label: statusMeta("chatSession", value).label }));
const emptyFilterOptions = ["non_empty", "empty"] satisfies EmptyChatFilter[];
const channelFilterOptions = ["all", "web", "line", "facebook", "whatsapp", "instagram"] satisfies SessionChannelFilter[];
// URL param defaults; a param equal to its default is left out of the URL.
const FILTER_DEFAULTS = {
  view: "needs_reply",
  state: "open",
  empty: "non_empty",
  channel: "all",
  q: "",
  from: "",
  to: "",
} as const;
type FilterParam = keyof typeof FILTER_DEFAULTS;

function readOption<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useLatestDefined<T>(value: T | undefined, resetKey: string) {
  const [latest, setLatest] = useState<{ resetKey: string; value: T } | null>(
    value === undefined ? null : { resetKey, value },
  );

  useEffect(() => {
    setLatest(null);
  }, [resetKey]);

  useEffect(() => {
    if (value !== undefined) setLatest({ resetKey, value });
  }, [resetKey, value]);

  if (value !== undefined) return value;
  return latest?.resetKey === resetKey ? latest.value : undefined;
}

function dateTimeInputToMillis(value: string, boundary: "start" | "end" = "start") {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return boundary === "end" ? timestamp + 59_999 : timestamp;
}

function dateTimeBadgeLabel(value: string) {
  const timestamp = dateTimeInputToMillis(value);
  return typeof timestamp === "number" ? formatDateTime(timestamp) : value;
}

function emptyFilterLabel(value: EmptyChatFilter) {
  if (value === "empty") return "Empty only";
  return "Not empty";
}

function channelFilterLabel(channel: SessionChannelFilter) {
  return channel === "all" ? "All" : sourceLabel(channel);
}

export function ChatsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const now = usePresenceClock();
  const isLargeViewport = useMediaQuery("(min-width: 1024px)");
  // Filters and the open chat live in the URL so views can be shared and deep-linked (?session=<id>).
  const updateParams = useCallback(
    (patch: Partial<Record<FilterParam | "session", string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        const fallback = key in FILTER_DEFAULTS ? FILTER_DEFAULTS[key as FilterParam] : "";
        if (!value || value === fallback) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(`/admin/chats${query ? `?${query}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );
  const status = readOption(searchParams.get("view"), statusOptions, FILTER_DEFAULTS.view);
  const adminStatus = readOption(searchParams.get("state"), adminStatusOptions, FILTER_DEFAULTS.state);
  const emptyFilter = readOption(searchParams.get("empty"), emptyFilterOptions, FILTER_DEFAULTS.empty);
  const channelFilter = readOption(searchParams.get("channel"), channelFilterOptions, FILTER_DEFAULTS.channel);
  const messageStartAt = searchParams.get("from") ?? "";
  const messageEndAt = searchParams.get("to") ?? "";
  const setStatus = (value: SessionStatus) => updateParams({ view: value });
  const setAdminStatus = (value: AdminSessionStatus) => updateParams({ state: value });
  const setEmptyFilter = (value: EmptyChatFilter) => updateParams({ empty: value });
  const setChannelFilter = (value: SessionChannelFilter) => updateParams({ channel: value });
  const setMessageStartAt = (value: string) => updateParams({ from: value });
  const setMessageEndAt = (value: string) => updateParams({ to: value });
  // Typing stays local; the URL follows after a short pause.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const selectedSessionId = searchParams.get("session") as Id<"chatSessions"> | null;
  function selectSession(sessionId: Id<"chatSessions"> | null) {
    if (sessionId === selectedSessionId) return;
    updateParams({ session: sessionId });
  }
  const [answerTarget, setAnswerTarget] = useState<AnswerFormTarget | null>(null);
  const propertyScopes = useQuery(
    api.chatKnowledge.adminListPropertyScopes,
    answerTarget ? {} : "skip",
  ) as AdminKnowledgePropertyScope[] | undefined;
  const selectedSessionIdRef = useRef<Id<"chatSessions"> | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState<string | null>(null);
  const settleGuestMessageMutation = useMutation(api.adminChat.settleGuestMessage);
  const [settlingMessageId, setSettlingMessageId] = useState<Id<"chatMessages"> | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const trimmedSearchQuery = searchQuery.trim();
  const parsedMessageStartAt = dateTimeInputToMillis(messageStartAt, "start");
  const parsedMessageEndAt = dateTimeInputToMillis(messageEndAt, "end");
  const invalidMessageDateRange =
    typeof parsedMessageStartAt === "number" &&
    typeof parsedMessageEndAt === "number" &&
    parsedMessageStartAt > parsedMessageEndAt;
  const currentCursor = pageCursors[pageIndex] ?? null;
  const filterResetKey = [
    status,
    adminStatus,
    trimmedSearchQuery,
    emptyFilter,
    channelFilter,
    messageStartAt,
    messageEndAt,
  ].join(":");
  const sessionsResetKey = `${filterResetKey}:${currentCursor ?? "first"}`;
  const liveSessionsResult = useQuery(
    api.adminChat.listSessions,
    invalidMessageDateRange
      ? "skip"
      : {
          paginationOpts: { numItems: 10, cursor: currentCursor },
          status,
          adminStatus,
          empty: emptyFilter,
          channel: channelFilter,
          searchQuery: trimmedSearchQuery || undefined,
          messageStartAt: parsedMessageStartAt,
          messageEndAt: parsedMessageEndAt,
          now,
        },
  ) as SessionListResult | undefined;
  const sessionsResult = useLatestDefined(liveSessionsResult, sessionsResetKey);
  const sessions = useMemo(
    () => (invalidMessageDateRange ? [] : sessionsResult?.sessions ?? []),
    [invalidMessageDateRange, sessionsResult],
  );
  const liveSessionDetail = useQuery(
    api.adminChat.getSessionDetail,
    selectedSessionId ? { sessionId: selectedSessionId, now } : "skip",
  ) as SessionDetailResult | null | undefined;
  const transcriptPagination = usePaginatedQuery(
    api.adminChat.listTranscriptMessages,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip",
    { initialNumItems: 10 },
  ) as TranscriptPaginationResult;
  const sessionDetail = useLatestDefined(liveSessionDetail, selectedSessionId ?? "none");
  const transcriptMessages = useMemo(
    () => chronologicalTranscriptMessages(transcriptPagination.results),
    [transcriptPagination.results],
  );
  const loadingSessions =
    !invalidMessageDateRange && liveSessionsResult === undefined && sessionsResult === undefined;
  const loadingTranscript =
    Boolean(selectedSessionId) &&
    (liveSessionDetail === undefined || transcriptPagination.status === "LoadingFirstPage") &&
    sessionDetail === undefined &&
    transcriptMessages.length === 0;
  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session._id === selectedSessionId) ??
      sessionDetail?.session ??
      null,
    [selectedSessionId, sessions, sessionDetail],
  );

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
    setReplyDraft("");
    setReplyError(null);
    setReplyStatus(null);
  }, [selectedSessionId]);

  async function sendAdminReply() {
    const sessionId = selectedSessionId;
    const content = replyDraft.trim();
    if (!sessionId || !content || replyPending) return;
    setReplyPending(true);
    setReplyError(null);
    setReplyStatus(null);
    try {
      const token = await getToken({ template: "convex" });
      if (!token) throw new Error("Admin sign-in has expired. Sign in again.");
      const response = await fetch("/api/admin/chat/reply", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          requestId: crypto.randomUUID(),
          content,
        }),
      });
      const result = (await response.json()) as { error?: string; channel?: string };
      if (!response.ok) throw new Error(result.error || "Unable to send reply");
      if (selectedSessionIdRef.current === sessionId) {
        setReplyDraft("");
        setReplyStatus(
          result.channel === "web"
            ? "Reply sent"
            : `Reply accepted by ${sourceLabel(result.channel)}. Delivery is not confirmed.`,
        );
      }
    } catch (error) {
      if (selectedSessionIdRef.current === sessionId) {
        setReplyError(error instanceof Error ? error.message : "Unable to send reply");
      }
    } finally {
      setReplyPending(false);
    }
  }

  async function settleGuestMessage(sessionId: Id<"chatSessions">, messageId: Id<"chatMessages">) {
    setSettlingMessageId(messageId);
    setSettleError(null);
    try {
      await settleGuestMessageMutation({ sessionId, messageId });
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : "Unable to mark the message as settled.");
    } finally {
      setSettlingMessageId(null);
    }
  }

  function handleNextPage() {
    const nextCursor = sessionsResult?.continueCursor ?? sessionsResult?.nextCursor ?? null;
    if (!nextCursor || sessionsResult?.isDone) return;
    setPageCursors((current) => [
      ...current.slice(0, pageIndex + 1),
      nextCursor,
    ]);
    setPageIndex((current) => current + 1);
    selectSession(null);
  }

  function handlePreviousPage() {
    if (pageIndex <= 0) return;
    setPageIndex((current) => Math.max(0, current - 1));
    selectSession(null);
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
    replyDraft,
    onReplyDraftChange: setReplyDraft,
    onSendReply: sendAdminReply,
    replyPending,
    replyError,
    replyStatus,
    replyWindow: sessionDetail?.replyWindow,
    onSaveAsAnswer: (message: AdminMessage) => setAnswerTarget({ question: message.content }),
    actions: selectedSession ? (
      <AdminSessionActions session={selectedSession} onDeleted={() => selectSession(null)} />
    ) : null,
  };

  useEffect(() => {
    if (!isLargeViewport || selectedSessionId || !sessionsResult?.sessions.length) return;
    updateParams({ session: sessionsResult.sessions[0]._id });
  }, [isLargeViewport, selectedSessionId, sessionsResult, updateParams]);

  // A new filter starts again from the first page.
  useEffect(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, [filterResetKey]);

  useEffect(() => {
    if ((searchParams.get("q") ?? "") === trimmedSearchQuery) return;
    const timeout = window.setTimeout(() => updateParams({ q: trimmedSearchQuery }), 300);
    return () => window.clearTimeout(timeout);
  }, [searchParams, trimmedSearchQuery, updateParams]);

  const activeFilterCount = [emptyFilter !== "non_empty", channelFilter !== "all", messageStartAt, messageEndAt].filter(
    Boolean,
  ).length;
  const emptyList: { message: string; action?: ReactNode } =
    trimmedSearchQuery || activeFilterCount > 0
      ? {
          message: "No chats match this search and these filters.",
          action: (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                updateParams({ q: null, empty: null, channel: null, from: null, to: null });
              }}
            >
              Clear search and filters
            </Button>
          ),
        }
      : status === "needs_reply" && adminStatus === "open"
        ? {
            message: "No open chats are waiting for a reply.",
            action: (
              <Button type="button" size="sm" onClick={() => setStatus("all")}>
                Show all open chats
              </Button>
            ),
          }
        : adminStatus !== "open"
          ? {
              message: `No ${adminStatus} chats here.`,
              action: (
                <Button type="button" size="sm" onClick={() => setAdminStatus("open")}>
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
            : { message: "No chats yet. Guest conversations from every channel appear here." };

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
    else if (key === "r") document.getElementById(isLargeViewport ? "admin-reply-desktop" : "admin-reply-mobile")?.focus();
    else if (key === "e") {
      const session = sessions[selectedIndex];
      if (!session?.needsReply || !session.latestMessage) return;
      // Settled chats leave the "Needs reply" list, so move on to the next one.
      if (status === "needs_reply") moveSelection(selectedIndex < sessions.length - 1 ? 1 : -1);
      void settleGuestMessage(session._id, session.latestMessage._id);
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
      if (!key || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      onShortcut(key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <SetupBanner className="mx-4 mt-4 shrink-0 sm:mx-6" />
      <div className="grid min-h-0 w-full flex-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(300px,24rem)_minmax(0,1fr)]">
        <aside
          aria-label="Chat list"
          className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-border bg-card"
        >
          <div className="grid gap-2 border-b border-border p-3">
            <SegmentedTabs
              tabs={statusTabs}
              value={status}
              onValueChange={setStatus}
              label="Chat activity"
              controls="admin-chat-list"
              fill
            />
            <SegmentedTabs
              tabs={adminStatusTabs}
              value={adminStatus}
              onValueChange={setAdminStatus}
              label="Chat status"
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
                  placeholder="Search contacts or messages"
                  aria-label="Search contacts or messages"
                  aria-keyshortcuts="/"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("h-9 shrink-0 rounded-lg px-3", activeFilterCount > 0 && "border-ring")}
                    aria-label={activeFilterCount > 0 ? `Chat filters, ${activeFilterCount} active` : "Chat filters"}
                  >
                    <Filter aria-hidden="true" className="h-4 w-4" />
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
                          {option === "all" ? null : <ChannelIcon channel={option} className="h-3.5 w-3.5 shrink-0" />}
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
                        updateParams({ empty: null, channel: null, from: null, to: null });
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
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setShortcutsOpen(true)}
              className="hidden w-fit items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>r</Kbd> reply · <Kbd>e</Kbd> settle · <Kbd>?</Kbd> all shortcuts
              </span>
            </button>
          </div>

          <div id="admin-chat-list" aria-busy={loadingSessions} className="min-h-0 overflow-y-auto">
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
            {!invalidMessageDateRange && !loadingSessions && sessions.length === 0 ? (
              <EmptyState action={emptyList.action}>{emptyList.message}</EmptyState>
            ) : null}
            {sessions.map((session) => {
              const unansweredMessage = session.needsReply ? session.latestMessage : undefined;
              const selected = selectedSessionId === session._id;
              return (
                <div
                  key={session._id}
                  data-session-id={session._id}
                  className={cn(
                    "flex items-center border-b border-border transition hover:bg-muted/60",
                    selected && "bg-gold/10",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectSession(session._id)}
                    aria-current={selected ? "true" : undefined}
                    className="min-w-0 flex-1 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {visitorLabel(session)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(session.latestMessageAt, now)}
                      </span>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ChannelIcon channel={session.channel} className="h-3.5 w-3.5 shrink-0" />
                      <span className="sr-only">{sourceLabel(session.channel)} ·</span>
                      <span className="truncate">
                        {session.propertyName ?? session.propertySlug ?? "General site"}
                      </span>
                    </span>
                    {session.needsReply || session.isActive || session.aiPaused ? (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {session.needsReply ? <StatusBadge {...statusMeta("chatSession", "needs_reply")} /> : null}
                        {session.isActive ? <StatusBadge tone="success" label="Live now" /> : null}
                        {session.aiPaused ? <StatusBadge {...statusMeta("chatSession", "ai_paused")} /> : null}
                      </span>
                    ) : null}
                  </button>
                  {unansweredMessage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => settleGuestMessage(session._id, unansweredMessage._id)}
                      disabled={settlingMessageId === unansweredMessage._id}
                      aria-label={`Mark the message from ${visitorLabel(session)} as settled`}
                      title="Mark as settled: no reply needed (e)"
                      className={cn("mr-2 size-9 shrink-0 rounded-full", TONES.warning.text)}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreviousPage}
              disabled={pageIndex === 0 || loadingSessions}
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Previous
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <span className="block font-semibold text-foreground">Page {pageIndex + 1}</span>
              10 per page
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={
                loadingSessions ||
                !sessionsResult ||
                sessionsResult.isDone ||
                !(sessionsResult.continueCursor ?? sessionsResult.nextCursor)
              }
            >
              Next
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </aside>

        <section aria-label="Selected chat" className="hidden min-h-0 border border-border bg-card lg:block">
          <AdminSessionDetail key={selectedSession?._id ?? "none"} {...detailProps} />
        </section>
      </div>
      <Dialog
        open={!isLargeViewport && Boolean(selectedSession)}
        onOpenChange={(isOpen) => {
          if (!isOpen) selectSession(null);
        }}
      >
        <DialogContent
          data-testid="admin-chat-detail-dialog"
          className="flex h-[calc(100svh-2rem)] max-h-[calc(100svh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">
            {selectedSession ? `Chat details for ${visitorLabel(selectedSession)}` : "Chat details"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visitor context and transcript for the selected chat session.
          </DialogDescription>
          <AdminSessionDetail key={selectedSession?._id ?? "none"} compact {...detailProps} />
        </DialogContent>
      </Dialog>
      <AnswerFormDialog
        target={answerTarget}
        propertyScopes={propertyScopes ?? []}
        onClose={() => setAnswerTarget(null)}
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

const CHAT_SHORTCUT_KEYS = ["j", "k", "r", "e", "/", "?"] as const;
const CHAT_SHORTCUTS: Array<[string[], string]> = [
  [["j"], "Next chat"],
  [["k"], "Previous chat"],
  [["r"], "Reply to this chat"],
  [["e"], "Mark the guest's message settled and move on"],
  [["/"], "Search chats"],
  [["?"], "Show these shortcuts"],
  [["Esc"], "Leave a text box or close a dialog"],
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-xs leading-5 text-foreground">
      {children}
    </kbd>
  );
}
