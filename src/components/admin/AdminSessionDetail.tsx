"use client";

import type { Id } from "convex/_generated/dataModel";
import { Loader2, Send } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/ui/chat/chat-input";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
  ChatBubbleTimestamp,
} from "@/components/ui/chat/chat-bubble";
import {
  ChannelIcon,
  channelLabel,
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
} from "@/components/admin/admin-chat-types";
import { cn } from "@/lib/utils";

export function chronologicalTranscriptMessages<T>(newestFirst: readonly T[]): T[] {
  return [...newestFirst].reverse();
}

function contactLabel(session: AdminSession) {
  const app = session.visitorContactApp
    ? session.visitorContactApp === "line"
      ? "LINE"
      : session.visitorContactApp === "facebook"
        ? "Facebook"
        : session.visitorContactApp === "instagram"
          ? "Instagram"
          : "WhatsApp"
    : "Contact";
  return session.visitorContactHandle
    ? `${app}: ${session.visitorContactHandle}`
    : session.visitorPhone
      ? `WhatsApp: ${session.visitorPhone}`
      : "No contact app";
}

function lineEventLabel(event?: AdminLineEvent | null) {
  if (!event) return "";
  const mode = event.replyMode && event.replyMode !== "failed" ? ` · ${event.replyMode}` : "";
  if (event.status === "failed") return `LINE failed${event.lineReplyStatus ? ` ${event.lineReplyStatus}` : ""}`;
  if (event.status === "replied") return `LINE replied${mode}`;
  if (event.status === "ignored") return "LINE ignored";
  if (event.status === "processing") return "LINE processing";
  return "LINE received";
}

function lineEventTone(event?: AdminLineEvent | null) {
  if (!event) return "secondary" as const;
  if (event.status === "replied") return "default" as const;
  if (event.status === "failed") return "outline" as const;
  return "secondary" as const;
}

function facebookEventLabel(event?: AdminFacebookEvent | null) {
  if (!event) return "";
  const mode = event.replyMode && event.replyMode !== "failed" ? ` · ${event.replyMode}` : "";
  if (event.status === "failed") {
    return `Facebook failed${event.facebookReplyStatus ? ` ${event.facebookReplyStatus}` : ""}`;
  }
  if (event.status === "replied") return `Facebook replied${mode}`;
  if (event.status === "ignored") return "Facebook ignored";
  if (event.status === "processing") return "Facebook processing";
  return "Facebook received";
}

function facebookEventTone(event?: AdminFacebookEvent | null) {
  if (!event) return "secondary" as const;
  if (event.status === "replied") return "default" as const;
  if (event.status === "failed") return "outline" as const;
  return "secondary" as const;
}

function whatsappEventLabel(event?: AdminWhatsAppEvent | null) {
  if (!event) return "";
  const mode = event.replyMode && event.replyMode !== "failed" ? ` · ${event.replyMode}` : "";
  if (event.status === "failed") {
    return `WhatsApp failed${event.whatsappReplyStatus ? ` ${event.whatsappReplyStatus}` : ""}`;
  }
  if (event.status === "replied") return `WhatsApp replied${mode}`;
  if (event.status === "ignored") return "WhatsApp ignored";
  if (event.status === "processing") return "WhatsApp processing";
  return "WhatsApp received";
}

function whatsappEventTone(event?: AdminWhatsAppEvent | null) {
  if (!event) return "secondary" as const;
  if (event.status === "replied") return "default" as const;
  if (event.status === "failed") return "outline" as const;
  return "secondary" as const;
}

function instagramEventLabel(event?: AdminInstagramEvent | null) {
  if (!event) return "";
  const mode = event.replyMode && event.replyMode !== "failed" ? ` · ${event.replyMode}` : "";
  if (event.status === "failed") {
    return `Instagram failed${event.instagramReplyStatus ? ` ${event.instagramReplyStatus}` : ""}`;
  }
  if (event.status === "replied") return `Instagram replied${mode}`;
  if (event.status === "ignored") return "Instagram ignored";
  if (event.status === "processing") return "Instagram processing";
  return "Instagram received";
}

function instagramEventTone(event?: AdminInstagramEvent | null) {
  if (!event) return "secondary" as const;
  if (event.status === "replied") return "default" as const;
  if (event.status === "failed") return "outline" as const;
  return "secondary" as const;
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
    pendingOlderScrollRef.current = { height: node.scrollHeight, top: node.scrollTop };
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
      previousMessageCountRef.current !== messages.length ||
      previousLatestMessageIdRef.current !== latestMessageId;

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
      <div className="grid h-full min-h-[420px] place-items-center p-6 text-center text-muted-foreground">
        Select a visitor session to inspect the transcript.
      </div>
    );
  }

  const latestLineEvent = lineEvents?.[0] ?? selectedSession.latestLineEvent;
  const latestFacebookEvent = facebookEvents?.[0] ?? selectedSession.latestFacebookEvent;
  const latestWhatsAppEvent = whatsappEvents?.[0] ?? selectedSession.latestWhatsAppEvent;
  const latestInstagramEvent = instagramEvents?.[0] ?? selectedSession.latestInstagramEvent;
  const propertyLabel = selectedSession.propertyName ?? selectedSession.propertySlug ?? "General site";
  const delivery =
    selectedSession.channel === "line" && latestLineEvent
      ? { event: latestLineEvent, label: lineEventLabel(latestLineEvent), tone: lineEventTone(latestLineEvent) }
      : selectedSession.channel === "facebook" && latestFacebookEvent
        ? {
            event: latestFacebookEvent,
            label: facebookEventLabel(latestFacebookEvent),
            tone: facebookEventTone(latestFacebookEvent),
          }
        : selectedSession.channel === "whatsapp" && latestWhatsAppEvent
          ? {
              event: latestWhatsAppEvent,
              label: whatsappEventLabel(latestWhatsAppEvent),
              tone: whatsappEventTone(latestWhatsAppEvent),
            }
          : selectedSession.channel === "instagram" && latestInstagramEvent
            ? {
                event: latestInstagramEvent,
                label: instagramEventLabel(latestInstagramEvent),
                tone: instagramEventTone(latestInstagramEvent),
              }
            : null;
  const deliveryText = delivery
    ? delivery.event.messageText ??
      ("postbackData" in delivery.event ? delivery.event.postbackData : undefined) ??
      delivery.event.eventType
    : "";

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="max-h-[40svh] min-h-0 overflow-y-auto border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            className={cn(
              "min-w-0 truncate font-serif font-semibold text-foreground",
              compact ? "text-xl" : "text-2xl",
            )}
          >
            {visitorLabel(selectedSession)}
          </h2>
          {selectedSession.isActive ? (
            <Badge className="rounded-full bg-emerald-600 text-white">Active now</Badge>
          ) : (
            <Badge variant="outline" className="rounded-full">
              Inactive
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span className="truncate">{propertyLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <ChannelIcon channel={selectedSession.channel} className="h-3.5 w-3.5" />
            {channelLabel(selectedSession.channel)}
          </span>
          <span aria-hidden="true">·</span>
          <span>Last seen {relativeTime(selectedSession.lastSeenAt ?? selectedSession.createdAt, now)}</span>
        </p>

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold uppercase tracking-[0.14em] text-gold">
            Contact & details
          </summary>
          <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[max-content_minmax(0,1fr)]">
            <DetailRow label="Email">{selectedSession.visitorEmail ?? "None"}</DetailRow>
            <DetailRow label="Contact">{contactLabel(selectedSession)}</DetailRow>
            <DetailRow label="Started">{formatDateTime(selectedSession.createdAt)}</DetailRow>
            <DetailRow label="Visitor ID">{selectedSession.visitorId ?? "None"}</DetailRow>
            <DetailRow label="Session ID">{selectedSession._id}</DetailRow>
            {selectedSession.currentPath ? (
              <DetailRow label="Page">{selectedSession.currentPath}</DetailRow>
            ) : null}
            {delivery ? (
              <DetailRow label="Delivery">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={delivery.tone}
                    className={cn(
                      "rounded-full",
                      delivery.event.status === "failed" && "border-red-500/50 text-red-200",
                    )}
                  >
                    {delivery.label}
                  </Badge>
                  {formatDateTime(delivery.event.updatedAt)}
                </span>
                <span className="mt-1 block">{truncate(deliveryText, 120)}</span>
                {delivery.event.error ? (
                  <span className="mt-1 block leading-5 text-red-200">
                    {truncate(delivery.event.error, 260)}
                  </span>
                ) : null}
              </DetailRow>
            ) : null}
            {selectedSession.channel === "web" ? (
              <>
                <DetailRow label="Timezone">{selectedSession.timeZone ?? "Unknown"}</DetailRow>
                <DetailRow label="Language">{selectedSession.browserLanguage ?? "Unknown"}</DetailRow>
                <DetailRow label="Viewport">{selectedSession.viewportSize ?? "Unknown"}</DetailRow>
                <DetailRow label="Screen">{selectedSession.screenSize ?? "Unknown"}</DetailRow>
                <DetailRow label="Platform">{selectedSession.platform ?? "Unknown"}</DetailRow>
                <DetailRow label="Referrer">{selectedSession.referrer ?? "None"}</DetailRow>
                <DetailRow label="User agent">{truncate(selectedSession.userAgent, 160) || "None"}</DetailRow>
              </>
            ) : null}
          </dl>
        </details>
      </div>

      <div
        ref={transcriptScrollRef}
        onScroll={handleTranscriptScroll}
        className="min-h-0 overflow-y-auto bg-background/50 p-4"
      >
        {loadingTranscript ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading transcript
          </div>
        ) : null}
        <div className="space-y-3">
          {loadingOlderMessages ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading older messages
            </div>
          ) : null}
          {canLoadOlderMessages && !loadingOlderMessages && !loadingTranscript ? (
            <button
              type="button"
              className="block w-full py-2 text-center text-xs text-muted-foreground hover:text-foreground"
              onClick={requestOlderMessages}
            >
              Load older messages
            </button>
          ) : null}
          {messages.map((message) => (
            <ChatBubble
              key={message._id}
              className={cn(
                compact ? "max-w-[92%]" : "max-w-[78%]",
              )}
              variant={message.role === "user" ? "sent" : "received"}
            >
              <ChatBubbleAvatar label={message.role === "user" ? "V" : message.source === "admin" ? "A" : "✦"} />
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {message.role === "user" ? "Visitor" : message.source === "admin" ? "Admin" : "Assistant"}
                </span>
                <ChatBubbleMessage
                  className="whitespace-pre-wrap shadow-sm"
                  variant={message.role === "user" ? "sent" : "received"}
                >
                  {message.content}
                </ChatBubbleMessage>
                <ChatBubbleTimestamp dateTime={new Date(message.timestamp).toISOString()}>
                  {formatDateTime(message.timestamp)}
                </ChatBubbleTimestamp>
              </div>
            </ChatBubble>
          ))}
          {!loadingTranscript && messages.length === 0 ? (
            <div className="border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
              {latestLineEvent
                ? `No transcript message is stored yet. Latest LINE event: ${lineEventLabel(latestLineEvent)}.`
                : latestFacebookEvent
                  ? `No transcript message is stored yet. Latest Facebook event: ${facebookEventLabel(latestFacebookEvent)}.`
                  : latestWhatsAppEvent
                    ? `No transcript message is stored yet. Latest WhatsApp event: ${whatsappEventLabel(latestWhatsAppEvent)}.`
                    : latestInstagramEvent
                      ? `No transcript message is stored yet. Latest Instagram event: ${instagramEventLabel(latestInstagramEvent)}.`
                      : "This visitor opened chat but has not sent a message yet."}
            </div>
          ) : null}
        </div>
      </div>
      <form
        className="border-t border-border bg-card p-3 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSendReply();
        }}
      >
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground" htmlFor={compact ? "admin-reply-mobile" : "admin-reply-desktop"}>
          Reply via {channelLabel(selectedSession.channel)}
        </label>
        <div className="flex items-end gap-2">
          <ChatInput
            id={compact ? "admin-reply-mobile" : "admin-reply-desktop"}
            aria-label="Type an admin reply"
            className="min-h-11"
            value={replyDraft}
            onChange={(event) => onReplyDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={1000}
            disabled={replyPending}
            placeholder="Type a reply…"
          />
          <Button type="submit" disabled={replyPending || !replyDraft.trim()}>
            {replyPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
        {replyError ? <p role="alert" className="mt-2 text-xs text-red-300">{replyError}</p> : null}
        {replyStatus ? <p role="status" className="mt-2 text-xs text-muted-foreground">{replyStatus}</p> : null}
      </form>
    </div>
  );
}
