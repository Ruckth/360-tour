"use client";

import { useAuth } from "@clerk/nextjs";
import { CheckCheck, ChevronLeft, ChevronRight, Filter, Keyboard, Search } from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { isChatSessionActive } from "convex/lib/chatPresence";
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
import { BusinessFactFormDialog, type FactFormTarget } from "@/components/admin/BusinessFactFormDialog";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { sourceLabel } from "@/components/admin/labels";
import { TONES, statusMeta } from "@/components/admin/status-tones";
import type { AdminFactProperty } from "@/components/admin/business-facts-form";
import {
  ChannelIcon,
  formatDateTime,
  relativeTime,
  truncate,
  visitorLabel,
} from "@/components/admin/admin-chat-format";
import type {
  AdminMessage,
  AdminSession,
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
  { value: "active", label: "Live" },
  { value: "all", label: "All" },
  { value: "inactive", label: "Inactive" },
] satisfies { value: SessionStatus; label: string }[];
const statusOptions: SessionStatus[] = ["needs_reply", "active", "all", "inactive"];
type InboxStateFilter = AdminSessionStatus | "done";
type InboxQueue = "waiting" | "open" | "done";
const queueTabs = [
  { value: "waiting", label: "Waiting" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
] satisfies { value: InboxQueue; label: string }[];
const adminStatusOptions: InboxStateFilter[] = ["open", "done", "resolved", "archived"];
const adminStatusTabs = adminStatusOptions.map((value) => ({
  value,
  label: value === "done" ? "All done" : statusMeta("chatSession", value).label,
}));
const emptyFilterOptions = ["non_empty", "empty"] satisfies EmptyChatFilter[];
const channelFilterOptions = [
  "all",
  "web",
  "line",
  "facebook",
  "whatsapp",
  "instagram",
] satisfies SessionChannelFilter[];
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

/** "Live now" follows the local clock, so the queries don't resubscribe on every presence tick. */
function withLivePresence<T extends AdminSession>(session: T, now: number): T {
  const isActive = isChatSessionActive(session, now);
  return session.isActive === isActive ? session : { ...session, isActive };
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
  const presenceMinute = Math.floor(now / 60_000) * 60_000;
  const isLargeViewport = useMediaQuery("(min-width: 1024px)");
  // Filters and the open chat live in the URL so views can be shared and deep-linked (?session=<id>).
  const updateParams = useCallback(
    (patch: Partial<Record<FilterParam | "session", string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      // A filter change must not leave a conversation from the previous queue open.
      if (!Object.hasOwn(patch, "session") && Object.keys(patch).some((key) => key in FILTER_DEFAULTS))
        params.delete("session");
      for (const [key, value] of Object.entries(patch)) {
        const fallback = key in FILTER_DEFAULTS ? FILTER_DEFAULTS[key as FilterParam] : "";
        if (!value || value === fallback) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(`/admin/chats${query ? `?${query}` : ""}`, {
        scroll: false,
      });
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
  const setAdminStatus = (value: InboxStateFilter) => updateParams({ state: value, view: "all" });
  const queue: InboxQueue = adminStatus !== "open" ? "done" : status === "needs_reply" ? "waiting" : "open";
  const setQueue = (value: InboxQueue) =>
    updateParams({
      view: value === "waiting" ? "needs_reply" : "all",
      state: value === "done" ? "done" : "open",
    });
  const setEmptyFilter = (value: EmptyChatFilter) => updateParams({ empty: value });
  const setChannelFilter = (value: SessionChannelFilter) => updateParams({ channel: value });
  const setMessageStartAt = (value: string) => updateParams({ from: value });
  const setMessageEndAt = (value: string) => updateParams({ to: value });
  // Typing stays local; the URL follows after a short pause.
  const urlSearchQuery = searchParams.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(urlSearchQuery);
  const lastWrittenSearchQuery = useRef(urlSearchQuery);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const selectedSessionId = searchParams.get("session") as Id<"chatSessions"> | null;
  function selectSession(sessionId: Id<"chatSessions"> | null) {
    if (sessionId === selectedSessionId) return;
    updateParams({ session: sessionId });
  }
  // Saved answers are retired: a guest question can seed a draft business fact instead.
  const [factTarget, setFactTarget] = useState<FactFormTarget | null>(null);
  const factProperties = useQuery(api.properties.adminList, factTarget ? {} : "skip") as
    | AdminFactProperty[]
    | undefined;
  const selectedSessionIdRef = useRef<Id<"chatSessions"> | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyFeedback, setReplyFeedback] = useState<Record<string, { error?: string; status?: string }>>({});
  const replyDraft = selectedSessionId ? (replyDrafts[selectedSessionId] ?? "") : "";
  const replyError = selectedSessionId ? (replyFeedback[selectedSessionId]?.error ?? null) : null;
  const replyStatus = selectedSessionId ? (replyFeedback[selectedSessionId]?.status ?? null) : null;
  function setReplyDraft(value: string) {
    if (selectedSessionId) setReplyDrafts((drafts) => ({ ...drafts, [selectedSessionId]: value }));
  }
  const [replyPending, setReplyPending] = useState(false);
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
          // Only the Live/Inactive filters need the server's clock; a coarse minute keeps the subscription stable.
          now: status === "active" || status === "inactive" ? presenceMinute : undefined,
        },
  ) as SessionListResult | undefined;
  const sessionsResult = useLatestDefined(liveSessionsResult, sessionsResetKey);
  const sessions = useMemo(
    () =>
      invalidMessageDateRange ? [] : (sessionsResult?.sessions ?? []).map((session) => withLivePresence(session, now)),
    [invalidMessageDateRange, sessionsResult, now],
  );
  const liveSessionDetail = useQuery(
    api.adminChat.getSessionDetail,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip",
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
  const loadingSessions = !invalidMessageDateRange && liveSessionsResult === undefined && sessionsResult === undefined;
  const loadingTranscript =
    Boolean(selectedSessionId) &&
    (liveSessionDetail === undefined || transcriptPagination.status === "LoadingFirstPage") &&
    sessionDetail === undefined &&
    transcriptMessages.length === 0;
  const selectedSession = useMemo(() => {
    if (!loadingSessions && sessions.length === 0) return null;
    const candidate =
      sessions.find((session) => session._id === selectedSessionId) ??
      (sessionDetail?.session ? withLivePresence(sessionDetail.session, now) : null);
    if (!candidate) return null;
    const candidateStatus = candidate.adminStatus ?? "open";
    if (adminStatus === "done" ? candidateStatus === "open" : candidateStatus !== adminStatus) return null;
    if (status === "needs_reply" && !candidate.needsReply) return null;
    return candidate;
  }, [selectedSessionId, sessions, sessionDetail, now, loadingSessions, adminStatus, status]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  async function sendAdminReply() {
    const sessionId = selectedSessionId;
    const content = replyDraft.trim();
    if (!sessionId || !content || replyPending) return;
    setReplyPending(true);
    setReplyFeedback((feedback) => ({ ...feedback, [sessionId]: {} }));
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
      const result = (await response.json()) as {
        error?: string;
        channel?: string;
      };
      if (!response.ok) throw new Error(result.error || "Unable to send reply");
      setReplyDrafts((drafts) => ({
        ...drafts,
        [sessionId]: drafts[sessionId]?.trim() === content ? "" : (drafts[sessionId] ?? ""),
      }));
      setReplyFeedback((feedback) => ({
        ...feedback,
        [sessionId]: {
          status:
            result.channel === "web"
              ? "Reply sent"
              : `Reply accepted by ${sourceLabel(result.channel)}. Delivery is not confirmed.`,
        },
      }));
      // A reply leaves Waiting. Keep it visible in Open, including its delivery feedback.
      if (selectedSessionIdRef.current === sessionId && status === "needs_reply")
        updateParams({ view: "all", state: "open", session: sessionId });
    } catch (error) {
      setReplyFeedback((feedback) => ({
        ...feedback,
        [sessionId]: {
          error: error instanceof Error ? error.message : "Unable to send reply",
        },
      }));
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
    setPageCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
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
    onAddBusinessFact: (message: AdminMessage) => setFactTarget({ fromMessage: { question: message.content } }),
    actions: selectedSession ? (
      <AdminSessionActions
        session={selectedSession}
        onDeleted={() => selectSession(null)}
        onStatusChanged={(nextStatus) => {
          if (nextStatus === "open")
            updateParams({
              view: "all",
              state: "open",
              session: selectedSession._id,
            });
          else if (adminStatus === "open" || (adminStatus === "resolved" && nextStatus === "archived")) {
            const next = sessions.find((session) => session._id !== selectedSession._id);
            selectSession(isLargeViewport ? (next?._id ?? null) : null);
          }
        }}
      />
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
    sessionsResult && !sessionsResult.isDone && sessions.length === 0
      ? {
          message: "No matching conversations on this page.",
          action: (
            <Button type="button" size="sm" onClick={handleNextPage}>
              Check older conversations
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
                    view: queue === "waiting" ? "needs_reply" : "all",
                    state: queue === "done" ? "done" : "open",
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
                message: adminStatus === "done" ? "No completed conversations yet." : `No ${adminStatus} chats here.`,
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
                  message: "No chats yet. Guest conversations from every channel appear here.",
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
      <div className="min-h-0 flex-1 p-3 sm:p-5">
        <div className="grid h-full min-h-0 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside
            aria-label="Chat list"
            className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-card lg:border-r lg:border-border/60"
          >
            <div className="grid gap-3 p-4 pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Conversations</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="Keyboard shortcuts"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <Keyboard className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <SegmentedTabs
                tabs={queueTabs}
                value={queue}
                onValueChange={setQueue}
                label="Conversation queue"
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
                    placeholder="Search conversations"
                    aria-label="Search conversations"
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
                      <p className="admin-eyebrow">Conversation status</p>
                      <SegmentedTabs
                        tabs={adminStatusTabs}
                        value={adminStatus}
                        onValueChange={setAdminStatus}
                        label="Conversation status"
                        fill
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="admin-eyebrow">Guest activity</p>
                      <SegmentedTabs
                        tabs={statusTabs}
                        value={status === "needs_reply" ? "all" : status}
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
                            view: queue === "waiting" ? "needs_reply" : "all",
                            state: queue === "done" ? "done" : "open",
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
                      "group relative mb-1 flex items-center rounded-lg border border-transparent transition hover:bg-muted/60",
                      selected &&
                        "border-gold/15 bg-gold/10 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-full before:bg-gold-text",
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
                      <span className="mt-1 block truncate text-sm text-muted-foreground">
                        {session.latestMessage?.content ?? "No messages yet"}
                      </span>
                      <span className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {session.needsReply && (session.adminStatus ?? "open") === "open" ? (
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-gold-text"
                            aria-label="Waiting for reply"
                          />
                        ) : null}
                        <ChannelIcon channel={session.channel} className="h-3.5 w-3.5 shrink-0" />
                        <span className="sr-only">{sourceLabel(session.channel)} ·</span>
                        <span className="truncate">
                          {session.propertyName ?? session.propertySlug ?? "General site"}
                        </span>
                      </span>
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
                        className={cn(
                          "mr-1 size-8 shrink-0 rounded-full opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
                          TONES.warning.text,
                        )}
                      >
                        <CheckCheck className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {pageIndex > 0 || (!sessionsResult?.isDone && !loadingSessions) ? (
              <div className="flex items-center justify-between gap-3 border-t border-border/60 p-3">
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
                <p className="text-center text-xs text-muted-foreground">Page {pageIndex + 1}</p>
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
            ) : (
              <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                {loadingSessions
                  ? "Loading conversations…"
                  : `${sessions.length} ${sessions.length === 1 ? "conversation" : "conversations"} in this view`}
              </div>
            )}
          </aside>

          <section aria-label="Selected chat" className="hidden min-h-0 bg-card lg:block">
            <AdminSessionDetail key={selectedSession?._id ?? "none"} {...detailProps} />
          </section>
        </div>
      </div>
      <Dialog
        open={!isLargeViewport && Boolean(selectedSession)}
        onOpenChange={(isOpen) => {
          if (!isOpen) selectSession(null);
        }}
      >
        <DialogContent
          data-testid="admin-chat-detail-dialog"
          className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {selectedSession ? `Chat details for ${visitorLabel(selectedSession)}` : "Chat details"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visitor context and transcript for the selected chat session.
          </DialogDescription>
          <AdminSessionDetail
            key={selectedSession?._id ?? "none"}
            compact
            onBack={() => selectSession(null)}
            {...detailProps}
          />
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
