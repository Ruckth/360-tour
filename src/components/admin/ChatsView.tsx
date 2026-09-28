"use client";

import { useAuth } from "@clerk/nextjs";
import { ChevronLeft, ChevronRight, Filter, Loader2, Search, TriangleAlert } from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemovableBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminDateTimeFilterField } from "@/components/admin/AdminDateTimeFilterField";
import { AdminSessionDetail, chronologicalTranscriptMessages } from "@/components/admin/AdminSessionDetail";
import {
  ChannelIcon,
  channelLabel,
  formatDateTime,
  relativeTime,
  truncate,
  visitorLabel,
} from "@/components/admin/admin-chat-format";
import type {
  AdminSession,
  SessionChannelFilter,
  SessionDetailResult,
  SessionListResult,
  TranscriptPaginationResult,
} from "@/components/admin/admin-chat-types";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";
type EmptyChatFilter = "non_empty" | "empty";

const statusOptions: SessionStatus[] = ["active", "all", "inactive"];
const channelFilterOptions = ["all", "web", "line", "facebook", "whatsapp", "instagram"] satisfies SessionChannelFilter[];
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

export function ChatsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const now = usePresenceClock();
  const isLargeViewport = useMediaQuery("(min-width: 1024px)");
  const [status, setStatus] = useState<SessionStatus>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [emptyFilter, setEmptyFilter] = useState<EmptyChatFilter>("non_empty");
  const [channelFilter, setChannelFilter] = useState<SessionChannelFilter>("all");
  const [messageStartAt, setMessageStartAt] = useState("");
  const [messageEndAt, setMessageEndAt] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const selectedSessionId = searchParams.get("session") as Id<"chatSessions"> | null;
  function selectSession(sessionId: Id<"chatSessions"> | null) {
    if (sessionId === selectedSessionId) return;
    const params = new URLSearchParams(searchParams.toString());
    if (sessionId) params.set("session", sessionId);
    else params.delete("session");
    const query = params.toString();
    router.replace(`/admin/chats${query ? `?${query}` : ""}`, { scroll: false });
  }
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
  ) as SessionDetailResult | undefined;
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
            : `Reply accepted by ${channelLabel(result.channel as AdminSession["channel"])}. Delivery is not confirmed.`,
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

  const resetSessionPaging = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, []);

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

  useEffect(() => {
    if (!isLargeViewport || selectedSessionId || !sessionsResult?.sessions.length) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("session", sessionsResult.sessions[0]._id);
    router.replace(`/admin/chats?${params}`, { scroll: false });
  }, [isLargeViewport, router, searchParams, selectedSessionId, sessionsResult]);

  useEffect(() => {
    resetSessionPaging();
  }, [filterResetKey, resetSessionPaging]);

  return (
    <>
      <div className="grid min-h-0 w-full flex-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(300px,24rem)_minmax(0,1fr)]">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-border bg-card">
          <div className="border-b border-border p-3">
            <ToggleGroup value={status} onValueChange={setStatus} aria-label="Chat status">
              {statusOptions.map((option) => (
                <ToggleGroupItem key={option} value={option} className="flex-1 capitalize">
                  {option}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-10 rounded-lg pl-9"
                  placeholder="Search contacts or messages"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={cn(
                      "h-10 w-10 rounded-lg",
                      (emptyFilter !== "non_empty" || channelFilter !== "all" || messageStartAt || messageEndAt) &&
                        "border-gold text-gold",
                    )}
                    aria-label="Open chat filters"
                  >
                    <Filter className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[24rem] max-w-[calc(100vw-2rem)] space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Filters</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Message status
                    </Label>
                    <ToggleGroup
                      value={emptyFilter}
                      onValueChange={setEmptyFilter}
                      aria-label="Message status"
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
                    <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Channel
                    </Label>
                    <ToggleGroup
                      value={channelFilter}
                      onValueChange={setChannelFilter}
                      aria-label="Channel"
                      className="grid grid-cols-4"
                    >
                      {channelFilterOptions.map((option) => (
                        <ToggleGroupItem
                          key={option}
                          value={option}
                          aria-label={`Filter by ${channelLabel(option)} channel`}
                          title={channelLabel(option)}
                          className="px-2"
                        >
                          {option === "all" ? null : (
                            <ChannelIcon channel={option} className="h-3.5 w-3.5" />
                          )}
                          <span className={option === "all" ? undefined : "sr-only"}>{channelLabel(option)}</span>
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
                      onClick={() => {
                        setEmptyFilter("non_empty");
                        setChannelFilter("all");
                        setMessageStartAt("");
                        setMessageEndAt("");
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {trimmedSearchQuery || emptyFilter !== "non_empty" || channelFilter !== "all" || messageStartAt || messageEndAt ? (
              <div className="mt-3 flex flex-wrap gap-2">
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
                    <span className="sr-only">{channelLabel(channelFilter)}</span>
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

          <div className="min-h-0 overflow-y-auto">
            {settleError ? (
              <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
                {settleError}
              </p>
            ) : null}
            {invalidMessageDateRange ? (
              <div className="p-5 text-sm leading-6 text-red-200">
                Latest message start must be before latest message end.
              </div>
            ) : null}
            {loadingSessions && sessions.length === 0 ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sessions
              </div>
            ) : null}
            {!invalidMessageDateRange && !loadingSessions && sessions.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No chat sessions match this filter yet.
              </div>
            ) : null}
            {sessions.map((session) => {
              const unansweredMessage = session.needsReply ? session.latestMessage : undefined;
              return (
                <div
                  key={session._id}
                  className={cn(
                    "flex items-center border-b border-border transition hover:bg-muted/60",
                    selectedSessionId === session._id && "bg-gold/10",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectSession(session._id)}
                    className="min-w-0 flex-1 px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {visitorLabel(session)}
                        </p>
                        {session.isActive ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Active now">
                            <span className="sr-only">Active now</span>
                          </span>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(session.latestMessageAt, now)}
                      </span>
                    </div>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ChannelIcon channel={session.channel} className="h-3.5 w-3.5 shrink-0" />
                      <span className="sr-only">{channelLabel(session.channel)} ·</span>
                      <span className="truncate">
                        {session.propertyName ?? session.propertySlug ?? "General site"}
                      </span>
                    </p>
                  </button>
                  {unansweredMessage ? (
                    <button
                      type="button"
                      onClick={() => settleGuestMessage(session._id, unansweredMessage._id)}
                      disabled={settlingMessageId === unansweredMessage._id}
                      aria-label={`Unanswered guest message from ${visitorLabel(session)}. Mark as settled`}
                      title="Unanswered guest message. Click to mark as settled."
                      className="mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-amber-400 transition hover:bg-amber-500/15 disabled:opacity-50"
                    >
                      <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    </button>
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
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Page {pageIndex + 1}</p>
              <p>10 per page</p>
            </div>
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
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </aside>

        <section className="hidden min-h-0 border border-border bg-card lg:block">
          <AdminSessionDetail
            canLoadOlderMessages={transcriptPagination.status === "CanLoadMore"}
            facebookEvents={sessionDetail?.facebookEvents}
            instagramEvents={sessionDetail?.instagramEvents}
            lineEvents={sessionDetail?.lineEvents}
            whatsappEvents={sessionDetail?.whatsappEvents}
            loadOlderMessages={() => transcriptPagination.loadMore(20)}
            loadingTranscript={loadingTranscript}
            loadingOlderMessages={transcriptPagination.status === "LoadingMore"}
            messages={transcriptMessages}
            now={now}
            selectedSession={selectedSession}
            replyDraft={replyDraft}
            onReplyDraftChange={setReplyDraft}
            onSendReply={sendAdminReply}
            replyPending={replyPending}
            replyError={replyError}
            replyStatus={replyStatus}
          />
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
          <AdminSessionDetail
            compact
            canLoadOlderMessages={transcriptPagination.status === "CanLoadMore"}
            facebookEvents={sessionDetail?.facebookEvents}
            instagramEvents={sessionDetail?.instagramEvents}
            lineEvents={sessionDetail?.lineEvents}
            whatsappEvents={sessionDetail?.whatsappEvents}
            loadOlderMessages={() => transcriptPagination.loadMore(20)}
            loadingTranscript={loadingTranscript}
            loadingOlderMessages={transcriptPagination.status === "LoadingMore"}
            messages={transcriptMessages}
            now={now}
            selectedSession={selectedSession}
            replyDraft={replyDraft}
            onReplyDraftChange={setReplyDraft}
            onSendReply={sendAdminReply}
            replyPending={replyPending}
            replyError={replyError}
            replyStatus={replyStatus}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
