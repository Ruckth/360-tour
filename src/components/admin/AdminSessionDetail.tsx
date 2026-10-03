"use client";

import type { Id } from "convex/_generated/dataModel";
import {
  ArrowLeft,
  BookmarkPlus,
  Bot,
  Clock3,
  Hand,
  Headset,
  Info,
  MessageCircle,
  Send,
  UserRound,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { ChatBubble, ChatBubbleMessage, ChatBubbleTimestamp } from "@/components/ui/chat/chat-bubble";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  ChannelIcon,
  formatDateTime,
  relativeTime,
  truncate,
  visitorLabel,
} from "@/components/admin/admin-chat-format";
import type {
  AdminFacebookEvent,
  AdminInstagramEvent,
  AdminLineEvent,
  AdminMessage,
  AdminSession,
  AdminWhatsAppEvent,
  ChannelReplyWindow,
  LineReplyMode,
  LineWebhookStatus,
} from "@/components/admin/admin-chat-types";
import { sourceLabel } from "@/components/admin/labels";
import { TONES, type Tone } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

export function chronologicalTranscriptMessages<T>(newestFirst: readonly T[]): T[] {
  return [...newestFirst].reverse();
}

function contactLabel(session: AdminSession) {
  const app = session.visitorContactApp ? sourceLabel(session.visitorContactApp) : "Contact";
  return session.visitorContactHandle
    ? `${app}: ${session.visitorContactHandle}`
    : session.visitorPhone
      ? `${sourceLabel("whatsapp")}: ${session.visitorPhone}`
      : "No contact app";
}

type DeliveryEvent = AdminLineEvent | AdminFacebookEvent | AdminWhatsAppEvent | AdminInstagramEvent;

const DELIVERY_STATUS: Record<LineWebhookStatus, { label: string; tone: Tone }> = {
  received: { label: "received", tone: "neutral" },
  processing: { label: "processing", tone: "info" },
  replied: { label: "replied", tone: "success" },
  ignored: { label: "ignored", tone: "muted" },
  failed: { label: "failed", tone: "danger" },
};

/** How the automatic reply was chosen, in words (raw enum values stay out of the UI). */
const REPLY_MODE_LABELS: Partial<Record<LineReplyMode, string>> = {
  exact: "exact match",
  approved_exact: "approved answer",
  question_bank_exact: "question bank",
  question_bank_semantic: "similar question",
  ai: "AI",
  unknown_fallback: "fallback reply",
  postback: "button tap",
  follow: "welcome message",
};

function replyStatusCode(event: DeliveryEvent) {
  if ("lineReplyStatus" in event) return event.lineReplyStatus;
  if ("facebookReplyStatus" in event) return event.facebookReplyStatus;
  if ("whatsappReplyStatus" in event) return event.whatsappReplyStatus;
  if ("instagramReplyStatus" in event) return event.instagramReplyStatus;
  return undefined;
}

/** Label and tone for a channel's latest webhook event, e.g. "LINE replied · AI". */
function deliveryMeta(channel: AdminSession["channel"], event: DeliveryEvent) {
  const status = DELIVERY_STATUS[event.status];
  const code = event.status === "failed" ? replyStatusCode(event) : undefined;
  const mode = event.status === "replied" && event.replyMode ? REPLY_MODE_LABELS[event.replyMode] : undefined;
  return {
    label: `${sourceLabel(channel)} ${status.label}${code ? ` ${code}` : ""}${mode ? ` · ${mode}` : ""}`,
    tone: status.tone,
  };
}

/** Who wrote a transcript message. Guests sit on the left; the AI and staff reply from the right. */
function messageAuthor(message: AdminMessage) {
  if (message.role === "user") return "guest" as const;
  return message.source === "admin" ? ("staff" as const) : ("ai" as const);
}

const BUBBLE_SURFACE = {
  guest: "bg-muted text-foreground",
  ai: cn("border text-foreground", TONES.accent.bg, TONES.accent.border),
  staff: "bg-primary text-primary-foreground",
} as const;

const WINDOW_WARNING_MS = 3 * 60 * 60 * 1000;

function durationLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-foreground/80">{label}</dt>
      <dd className="mb-1 break-all sm:mb-0">{children}</dd>
    </>
  );
}

export function AdminSessionDetail({
  canLoadOlderMessages,
  compact = false,
  facebookEvents,
  instagramEvents,
  lineEvents,
  whatsappEvents,
  loadOlderMessages,
  loadingTranscript,
  loadingOlderMessages,
  messages,
  now,
  selectedSession,
  replyDraft,
  onReplyDraftChange,
  onSendReply,
  replyPending,
  replyError,
  replyStatus,
  replyWindow,
  onAddBusinessFact,
  actions,
  onBack,
}: {
  canLoadOlderMessages: boolean;
  compact?: boolean;
  facebookEvents?: AdminFacebookEvent[];
  instagramEvents?: AdminInstagramEvent[];
  lineEvents?: AdminLineEvent[];
  whatsappEvents?: AdminWhatsAppEvent[];
  loadOlderMessages: () => void;
  loadingTranscript: boolean;
  loadingOlderMessages: boolean;
  messages: AdminMessage[];
  now: number;
  selectedSession: AdminSession | null;
  replyDraft: string;
  onReplyDraftChange: (value: string) => void;
  onSendReply: () => Promise<void>;
  replyPending: boolean;
  replyError: string | null;
  replyStatus: string | null;
  replyWindow?: ChannelReplyWindow;
  onAddBusinessFact?: (message: AdminMessage) => void;
  /** Primary status action and the occasional-action menu, rendered inside the header. */
  actions?: ReactNode;
  onBack?: () => void;
}) {
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const previousSessionIdRef = useRef<Id<"chatSessions"> | null>(null);
  const previousMessageCountRef = useRef(0);
  const previousLatestMessageIdRef = useRef<Id<"chatMessages"> | null>(null);
  const pendingOlderScrollRef = useRef<{ height: number; top: number } | null>(null);
  const nearBottomRef = useRef(true);
  const lastLoadRequestCountRef = useRef<number | null>(null);

  const requestOlderMessages = useCallback(() => {
    const node = transcriptScrollRef.current;
    if (
      !node ||
      !canLoadOlderMessages ||
      loadingOlderMessages ||
      loadingTranscript ||
      lastLoadRequestCountRef.current === messages.length
    ) {
      return;
    }
    pendingOlderScrollRef.current = {
      height: node.scrollHeight,
      top: node.scrollTop,
    };
    lastLoadRequestCountRef.current = messages.length;
    loadOlderMessages();
  }, [canLoadOlderMessages, loadOlderMessages, loadingOlderMessages, loadingTranscript, messages.length]);

  const handleTranscriptScroll = useCallback(() => {
    const node = transcriptScrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) {
      nearBottomRef.current = true;
    } else {
      nearBottomRef.current = false;
    }
    if (node.scrollTop <= 96) requestOlderMessages();
  }, [requestOlderMessages]);

  useLayoutEffect(() => {
    const node = transcriptScrollRef.current;
    if (!node) {
      previousSessionIdRef.current = null;
      previousMessageCountRef.current = 0;
      previousLatestMessageIdRef.current = null;
      pendingOlderScrollRef.current = null;
      lastLoadRequestCountRef.current = null;
      nearBottomRef.current = true;
      return;
    }
    const sessionId = selectedSession?._id ?? null;
    const latestMessageId = messages[messages.length - 1]?._id ?? null;
    const sessionChanged = previousSessionIdRef.current !== sessionId;
    const messagesChanged =
      previousMessageCountRef.current !== messages.length || previousLatestMessageIdRef.current !== latestMessageId;

    if (sessionChanged) {
      pendingOlderScrollRef.current = null;
      lastLoadRequestCountRef.current = null;
      node.scrollTop = node.scrollHeight;
      nearBottomRef.current = true;
    } else if (pendingOlderScrollRef.current && messagesChanged) {
      const previous = pendingOlderScrollRef.current;
      node.scrollTop = node.scrollHeight - previous.height + previous.top;
      pendingOlderScrollRef.current = null;
    } else if (messagesChanged && nearBottomRef.current) {
      // The first page may arrive after the conversation panel mounts.
      node.scrollTop = node.scrollHeight;
    }
    previousSessionIdRef.current = sessionId;
    previousMessageCountRef.current = messages.length;
    previousLatestMessageIdRef.current = latestMessageId;
  }, [messages, selectedSession?._id]);

  if (!selectedSession) {
    return (
      <div className="grid h-full min-h-0 place-items-center p-6 text-center">
        <div className="max-w-xs">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageCircle className="size-5" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold">Your conversations, in one place</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose a conversation to read the messages and reply.
          </p>
        </div>
      </div>
    );
  }

  const session = selectedSession;
  const guestName = visitorLabel(session);
  const windowClosesAt = replyWindow?.applies ? replyWindow.closesAt : undefined;
  const replyWindowClosed =
    replyWindow?.applies === true && (typeof windowClosesAt !== "number" || now > windowClosesAt);
  const replyWindowClosingSoon =
    !replyWindowClosed && typeof windowClosesAt === "number" && windowClosesAt - now < WINDOW_WARNING_MS;

  const latestEvent: DeliveryEvent | null | undefined =
    session.channel === "line"
      ? (lineEvents?.[0] ?? session.latestLineEvent)
      : session.channel === "facebook"
        ? (facebookEvents?.[0] ?? session.latestFacebookEvent)
        : session.channel === "whatsapp"
          ? (whatsappEvents?.[0] ?? session.latestWhatsAppEvent)
          : session.channel === "instagram"
            ? (instagramEvents?.[0] ?? session.latestInstagramEvent)
            : null;
  const propertyLabel = session.propertyName ?? session.propertySlug ?? "General site";
  const delivery = latestEvent ? { event: latestEvent, ...deliveryMeta(session.channel, latestEvent) } : null;
  const deliveryText = delivery
    ? (delivery.event.messageText ??
      ("postbackData" in delivery.event ? delivery.event.postbackData : undefined) ??
      delivery.event.eventType)
    : "";
  const replyInputId = compact ? "admin-reply-mobile" : "admin-reply-desktop";
  const replyHintId = `${replyInputId}-hint`;

  return (
    <Sheet>
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className="border-b border-border/60">
          <div className="flex items-center justify-between gap-2 p-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              {compact && onBack ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 shrink-0"
                  aria-label="Back to conversations"
                  onClick={onBack}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
              <span
                aria-hidden="true"
                className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground sm:flex"
              >
                {guestName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">{guestName}</h2>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <ChannelIcon channel={session.channel} className="size-3 shrink-0" />
                  <span className="shrink-0">{sourceLabel(session.channel)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{propertyLabel}</span>
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  aria-label="Contact & details"
                >
                  <Info className="size-4" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              {actions}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-4 py-2 text-xs text-muted-foreground sm:px-6">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {session.aiPaused ? (
                <Hand className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Bot className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              {session.adminStatus === "archived"
                ? "Archived conversation"
                : session.adminStatus === "resolved"
                  ? "Conversation completed"
                  : session.aiPaused
                    ? "Staff is replying · AI paused"
                    : "AI is active · Your reply takes over"}
            </span>
            <StatusBadge
              tone={
                session.adminStatus === "archived"
                  ? "muted"
                  : session.adminStatus === "resolved"
                    ? "success"
                    : session.needsReply
                      ? "warning"
                      : "info"
              }
              label={
                session.adminStatus === "archived"
                  ? "Archived"
                  : session.adminStatus === "resolved"
                    ? "Done"
                    : session.needsReply
                      ? "Waiting"
                      : "Open"
              }
            />
          </div>
        </div>

        <div
          ref={transcriptScrollRef}
          onScroll={handleTranscriptScroll}
          aria-busy={loadingTranscript}
          className="min-h-0 overflow-y-auto bg-background/30 px-4 py-5 sm:px-6"
        >
          {loadingTranscript ? (
            <div role="status" className="space-y-4">
              <span className="sr-only">Loading transcript</span>
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-16 w-3/5" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          ) : null}
          <div className="space-y-3">
            {loadingOlderMessages ? (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Spinner label="Loading older messages" className="h-3.5 w-3.5" />
                Loading older messages
              </div>
            ) : null}
            {canLoadOlderMessages && !loadingOlderMessages && !loadingTranscript ? (
              <button
                type="button"
                className="block w-full rounded py-2 text-center text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={requestOlderMessages}
              >
                Load older messages
              </button>
            ) : null}
            {messages.map((message) => {
              const author = messageAuthor(message);
              const fromGuest = author === "guest";
              const variant = fromGuest ? "received" : "sent";
              return (
                <ChatBubble
                  key={message._id}
                  data-author={author}
                  className={cn("group", compact ? "max-w-[92%]" : "max-w-[78%]")}
                  variant={variant}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      author === "guest" && "bg-muted text-muted-foreground",
                      author === "ai" && cn(TONES.accent.bg, TONES.accent.text),
                      author === "staff" && "bg-primary text-primary-foreground",
                    )}
                  >
                    {author === "ai" ? (
                      <Bot className="size-4" />
                    ) : author === "staff" ? (
                      <Headset className="size-4" />
                    ) : (
                      <UserRound className="size-4" />
                    )}
                  </span>
                  <div className={cn("min-w-0", !fromGuest && "text-right")}>
                    <span className="mb-1 block truncate text-xs font-medium text-muted-foreground">
                      {author === "ai" ? "AI" : author === "staff" ? "Staff" : guestName}
                    </span>
                    <ChatBubbleMessage
                      className={cn("whitespace-pre-wrap text-left shadow-sm", BUBBLE_SURFACE[author])}
                      variant={variant}
                    >
                      {message.content}
                    </ChatBubbleMessage>
                    <ChatBubbleTimestamp
                      className={fromGuest ? "text-left" : undefined}
                      dateTime={new Date(message.timestamp).toISOString()}
                    >
                      {formatDateTime(message.timestamp)}
                    </ChatBubbleTimestamp>
                    {fromGuest && onAddBusinessFact ? (
                      <button
                        type="button"
                        onClick={() => onAddBusinessFact(message)}
                        className="mt-1 inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground opacity-0 underline-offset-2 hover:text-foreground hover:underline focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add as business fact
                      </button>
                    ) : null}
                  </div>
                </ChatBubble>
              );
            })}
            {!loadingTranscript && messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
                {delivery
                  ? `No transcript message is stored yet. Latest ${sourceLabel(session.channel)} event: ${delivery.label}.`
                  : "This visitor opened chat but has not sent a message yet."}
              </div>
            ) : null}
          </div>
        </div>
        {replyWindowClosed ? (
          <div className="border-t border-border/60 bg-card p-3 sm:p-5">
            <div
              role="status"
              className={cn("flex items-start gap-3 rounded-lg border p-4", TONES.warning.bg, TONES.warning.border)}
            >
              <Clock3 aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", TONES.warning.text)} />
              <div>
                <p className="text-sm font-semibold">{sourceLabel(session.channel)} reply window has ended</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Free-text replies are available for 24 hours after the guest’s last message. You can reply when they
                  message again.
                </p>
                {replyWindow?.applies && replyWindow.lastGuestMessageAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last guest message {relativeTime(replyWindow.lastGuestMessageAt, now)}.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <form
            className="border-t border-border/60 bg-card p-3 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void onSendReply();
            }}
          >
            <label className="mb-2 block text-xs text-muted-foreground" htmlFor={replyInputId}>
              Reply via {sourceLabel(session.channel)}
            </label>
            <div className="flex items-end gap-2">
              <ChatInput
                id={replyInputId}
                aria-label="Type an admin reply"
                aria-describedby={replyHintId}
                className="min-h-11"
                value={replyDraft}
                onChange={(event) => onReplyDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  } else if (event.key === "Escape") {
                    event.currentTarget.blur();
                  }
                }}
                maxLength={1000}
                disabled={replyPending || loadingTranscript || !replyWindow}
                placeholder="Type a reply…"
              />
              <Button
                type="submit"
                disabled={replyPending || loadingTranscript || !replyWindow || !replyDraft.trim()}
                aria-describedby={replyHintId}
              >
                {replyPending ? (
                  <Spinner label="Sending reply" className="text-current" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
                Send
              </Button>
            </div>
            <div id={replyHintId}>
              {replyWindowClosingSoon && typeof windowClosesAt === "number" ? (
                <p role="status" className={cn("mt-2 text-xs font-medium", TONES.warning.text)}>
                  The {sourceLabel(session.channel)} reply window closes in {durationLabel(windowClosesAt - now)}.
                </p>
              ) : null}
            </div>
            {replyError ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {replyError}
              </p>
            ) : null}
            {replyStatus ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {replyStatus}
              </p>
            ) : null}
          </form>
        )}
      </div>
      <SheetContent className="w-[26rem] overflow-y-auto sm:max-w-[calc(100vw-2rem)]">
        <SheetHeader>
          <SheetTitle>Contact & details</SheetTitle>
          <SheetDescription>
            {guestName} · {sourceLabel(session.channel)}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-2 border-t border-border pt-5">
          <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[max-content_minmax(0,1fr)]">
            <DetailRow label="Handled by">
              {session.aiPaused ? (session.assignedAdminEmail ?? "Staff") : "AI assistant"}
            </DetailRow>
            <DetailRow label="Email">{session.visitorEmail ?? "None"}</DetailRow>
            <DetailRow label="Contact">{contactLabel(session)}</DetailRow>
            <DetailRow label="Started">{formatDateTime(session.createdAt)}</DetailRow>
            <DetailRow label="Visitor ID">{session.visitorId ?? "None"}</DetailRow>
            <DetailRow label="Session ID">{session._id}</DetailRow>
            {session.currentPath ? <DetailRow label="Page">{session.currentPath}</DetailRow> : null}
            {delivery ? (
              <DetailRow label="Delivery">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={delivery.tone} label={delivery.label} />
                  {formatDateTime(delivery.event.updatedAt)}
                </span>
                <span className="mt-1 block">{truncate(deliveryText, 120)}</span>
                {delivery.event.error ? (
                  <span className="mt-1 block leading-5 text-destructive">{truncate(delivery.event.error, 260)}</span>
                ) : null}
              </DetailRow>
            ) : null}
            {session.channel === "web" ? (
              <>
                <DetailRow label="Timezone">{session.timeZone ?? "Unknown"}</DetailRow>
                <DetailRow label="Language">{session.browserLanguage ?? "Unknown"}</DetailRow>
                <DetailRow label="Viewport">{session.viewportSize ?? "Unknown"}</DetailRow>
                <DetailRow label="Screen">{session.screenSize ?? "Unknown"}</DetailRow>
                <DetailRow label="Platform">{session.platform ?? "Unknown"}</DetailRow>
                <DetailRow label="Referrer">{session.referrer ?? "None"}</DetailRow>
                <DetailRow label="User agent">{truncate(session.userAgent, 160) || "None"}</DetailRow>
              </>
            ) : null}
          </dl>
        </div>
        <details className="mt-2 border-t border-border pt-4 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">Presence</summary>
          <p className="mt-2 text-muted-foreground">
            {session.isActive ? "Online" : "Offline"} · Last seen{" "}
            {relativeTime(session.lastSeenAt ?? session.createdAt, now)}
          </p>
        </details>
      </SheetContent>
    </Sheet>
  );
}
