"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Clock,
  ExternalLink,
  Globe2,
  HelpCircle,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MonitorSmartphone,
  Phone,
  Search,
  Shield,
  UserRound,
} from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { defaultLocale, localeLabels, locales, type Locale } from "@/i18n/routing";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";
type SessionMessageFilter = "withMessages" | "empty" | "all";
type AdminDashboardView = "chats" | "questions";

type AdminMessage = {
  _id: Id<"chatMessages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type AdminSession = {
  _id: Id<"chatSessions">;
  visitorId?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
  visitorContactApp?: "whatsapp" | "line";
  visitorContactHandle?: string;
  propertySlug?: string;
  propertyName?: string;
  currentPath?: string;
  referrer?: string;
  userAgent?: string;
  timeZone?: string;
  browserLanguage?: string;
  screenSize?: string;
  viewportSize?: string;
  platform?: string;
  channel: "web" | "whatsapp" | "line";
  createdAt: number;
  lastSeenAt?: number;
  lastOpenedAt?: number;
  lastClosedAt?: number;
  isActive: boolean;
  latestMessage?: AdminMessage;
};

type SessionListResult = {
  sessions: AdminSession[];
  nextCursor: number | null;
};

type TranscriptResult = {
  session: AdminSession;
  messages: AdminMessage[];
};

type AdminSuggestedQuestion = {
  _id: Id<"chatSuggestedQuestions">;
  sessionId: Id<"chatSessions">;
  question: string;
  translations?: Record<string, string>;
  locale: string;
  propertySlug?: string;
  topic: string;
  score: number;
  status: "active" | "clicked" | "archived";
  shownAt?: number;
  clickedAt?: number;
  createdAt: number;
  visitorId?: string;
  currentPath?: string;
};

const statusOptions: SessionStatus[] = ["active", "all", "inactive"];
const messageFilterLabels: Record<SessionMessageFilter, string> = {
  withMessages: "With messages",
  empty: "Empty threads",
  all: "All threads",
};
const messageFilterOptions: SessionMessageFilter[] = ["withMessages", "empty", "all"];
const PRESENCE_CLOCK_MS = 10_000;

function resetSelection(setSelectedSessionId: (sessionId: Id<"chatSessions"> | null) => void) {
  setSelectedSessionId(null);
}

function visitorLabel(session?: AdminSession | null) {
  if (!session) return "Visitor";
  if (session.visitorName) return session.visitorName;
  if (session.visitorEmail) return session.visitorEmail;
  return `Visitor ${session.visitorId?.slice(0, 8) ?? session._id.slice(-6)}`;
}

function relativeTime(timestamp?: number, now = Date.now()) {
  if (!timestamp) return "Unknown";
  const seconds = Math.max(1, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function truncate(value?: string, max = 96) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function contactLabel(session: AdminSession) {
  const app = session.visitorContactApp
    ? session.visitorContactApp === "line"
      ? "LINE"
      : "WhatsApp"
    : "Contact";
  return session.visitorContactHandle
    ? `${app}: ${session.visitorContactHandle}`
    : session.visitorPhone
      ? `WhatsApp: ${session.visitorPhone}`
      : "No contact app";
}

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

function getQuestionForLocale(question: AdminSuggestedQuestion, locale: Locale) {
  if (locale === defaultLocale) return question.question;
  return question.translations?.[locale]?.trim() || question.question;
}

function AdminQueryError({ error }: { error: Error }) {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <section className="max-w-lg border border-border bg-card p-7 shadow-xl">
        <Shield className="mb-5 h-8 w-8 text-gold" />
        <h1 className="font-serif text-3xl font-semibold">
          Unable to load admin chat
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error.message || "Check admin authorization and try again."}
        </p>
      </section>
    </div>
  );
}

type AdminChatQueryBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type AdminChatQueryBoundaryState = {
  error: Error | null;
};

class AdminChatQueryBoundary extends Component<
  AdminChatQueryBoundaryProps,
  AdminChatQueryBoundaryState
> {
  state: AdminChatQueryBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AdminChatQueryBoundaryState {
    return {
      error:
        error instanceof Error
          ? error
          : new Error("Unable to load admin chat."),
    };
  }

  componentDidUpdate(previousProps: AdminChatQueryBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return <AdminQueryError error={this.state.error} />;
    return this.props.children;
  }
}

export function AdminChatDashboard() {
  const convex = useOptionalConvex();
  const convexAuth = useOptionalConvexAuth();
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,var(--background),var(--secondary))] px-5">
        <section className="w-full max-w-md border border-border bg-card p-7 shadow-xl">
          <Shield className="mb-5 h-8 w-8 text-gold" />
          <h1 className="font-serif text-4xl font-semibold text-foreground">Admin</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in with an allowlisted admin account to view visitor chat activity and
            transcripts.
          </p>
          <SignInButton mode="modal">
            <Button className="mt-6 w-full">Sign in</Button>
          </SignInButton>
        </section>
      </div>
    );
  }

  if (!convex) {
    return (
      <div className="grid min-h-screen place-items-center px-5">
        <section className="max-w-lg border border-border bg-card p-7 shadow-xl">
          <h1 className="font-serif text-3xl font-semibold">Convex is not configured</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Add `NEXT_PUBLIC_CONVEX_URL` so the admin dashboard can query chat sessions.
          </p>
        </section>
      </div>
    );
  }

  if (convexAuth.isAuthEnabled && convexAuth.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-gold" />
          Connecting secure admin session
        </div>
      </div>
    );
  }

  if (convexAuth.isAuthEnabled && !convexAuth.isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center px-5">
        <section className="max-w-lg border border-border bg-card p-7 shadow-xl">
          <Shield className="mb-5 h-8 w-8 text-gold" />
          <h1 className="font-serif text-3xl font-semibold">
            Convex auth is not connected
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Clerk is signed in, but Convex could not validate the Clerk token. Check
            the Convex `CLERK_JWT_ISSUER_DOMAIN` environment variable and the Clerk
            `convex` JWT template.
          </p>
        </section>
      </div>
    );
  }

  return (
    <AdminChatQueryBoundary resetKey={user.id ?? "admin"}>
      <AdminChatLiveDashboard userEmail={user.primaryEmailAddress?.emailAddress} />
    </AdminChatQueryBoundary>
  );
}

function AdminChatLiveDashboard({ userEmail }: { userEmail?: string }) {
  const now = usePresenceClock();
  const isLargeViewport = useMediaQuery("(min-width: 1024px)");
  const [view, setView] = useState<AdminDashboardView>("chats");
  const [status, setStatus] = useState<SessionStatus>("active");
  const [messageFilter, setMessageFilter] =
    useState<SessionMessageFilter>("withMessages");
  const [propertySlug, setPropertySlug] = useState("");
  const [selectedSessionId, setSelectedSessionId] =
    useState<Id<"chatSessions"> | null>(null);
  const trimmedPropertySlug = propertySlug.trim();
  const sessionsResetKey = `${status}:${messageFilter}:${trimmedPropertySlug}`;
  const liveSessionsResult = useQuery(api.adminChat.listSessions, {
    status,
    messageFilter,
    propertySlug: trimmedPropertySlug || undefined,
    limit: 30,
    now,
  }) as SessionListResult | undefined;
  const sessionsResult = useLatestDefined(liveSessionsResult, sessionsResetKey);
  const sessions = useMemo(() => sessionsResult?.sessions ?? [], [sessionsResult]);
  const liveTranscript = useQuery(
    api.adminChat.getTranscript,
    selectedSessionId ? { sessionId: selectedSessionId, now } : "skip",
  ) as TranscriptResult | undefined;
  const liveQuestions = useQuery(
    api.chatSuggestions.adminList,
    view === "questions" ? { limit: 100 } : "skip",
  ) as AdminSuggestedQuestion[] | undefined;
  const transcript = useLatestDefined(liveTranscript, selectedSessionId ?? "none");
  const loadingSessions = liveSessionsResult === undefined && sessionsResult === undefined;
  const loadingTranscript =
    Boolean(selectedSessionId) && liveTranscript === undefined && transcript === undefined;
  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session._id === selectedSessionId) ??
      transcript?.session ??
      null,
    [selectedSessionId, sessions, transcript],
  );

  useEffect(() => {
    if (!sessionsResult) return;

    setSelectedSessionId((current) => {
      if (current && sessionsResult.sessions.some((session) => session._id === current)) {
        return current;
      }
      return isLargeViewport ? sessionsResult.sessions[0]?._id ?? null : null;
    });
  }, [isLargeViewport, sessionsResult]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              <MessageCircle className="h-4 w-4" />
              Concierge operations
            </div>
            <h1 className="mt-2 font-serif text-4xl font-semibold text-foreground">
              Admin
            </h1>
            <div className="mt-4 flex w-fit rounded-lg border border-border bg-background p-1">
              {(["chats", "questions"] satisfies AdminDashboardView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    "rounded-md px-4 py-2 text-xs font-semibold capitalize transition",
                    view === option
                      ? "bg-navy text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{userEmail}</span>
            <UserButton />
          </div>
        </div>
      </header>

      {view === "questions" ? (
        <AdminQuestionsView questions={liveQuestions} />
      ) : (
      <>
      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="min-h-[calc(100vh-132px)] border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="flex rounded-lg border border-border bg-background p-1">
              {statusOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setStatus(option);
                    resetSelection(setSelectedSessionId);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-2 text-xs font-semibold capitalize transition",
                    status === option
                      ? "bg-navy text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={propertySlug}
                  onChange={(event) => {
                    setPropertySlug(event.target.value);
                    resetSelection(setSelectedSessionId);
                  }}
                  className="h-10 rounded-lg pl-9"
                  placeholder="Filter by property slug"
                />
              </div>
              <Select
                value={messageFilter}
                onValueChange={(value) => {
                  setMessageFilter(value as SessionMessageFilter);
                  resetSelection(setSelectedSessionId);
                }}
              >
                <SelectTrigger
                  className="h-10 w-full rounded-lg sm:w-[10.75rem]"
                  aria-label="Filter chat threads by message state"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {messageFilterOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {messageFilterLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-h-[calc(100vh-255px)] overflow-y-auto">
            {loadingSessions && sessions.length === 0 ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sessions
              </div>
            ) : null}
            {!loadingSessions && sessions.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No chat sessions match this filter yet.
              </div>
            ) : null}
            {sessions.map((session) => (
              <button
                key={session._id}
                type="button"
                onClick={() => setSelectedSessionId(session._id)}
                className={cn(
                  "block w-full border-b border-border px-4 py-3 text-left transition hover:bg-muted/60",
                  selectedSessionId === session._id && "bg-gold/10",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {visitorLabel(session)}
                      </p>
                      {session.isActive ? (
                        <Badge className="rounded-full bg-emerald-600 text-white">Active</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {session.propertyName ?? session.propertySlug ?? "General site"} ·{" "}
                      {session.channel}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(session.lastSeenAt ?? session.createdAt, now)}
                  </span>
                </div>
                {session.latestMessage ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {session.latestMessage.role}: {truncate(session.latestMessage.content, 118)}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No messages yet</p>
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="hidden min-h-[calc(100vh-132px)] border border-border bg-card lg:block">
          <AdminSessionDetail
            loadingTranscript={loadingTranscript}
            now={now}
            selectedSession={selectedSession}
            transcript={transcript}
          />
        </section>
      </main>
      <Dialog
        open={!isLargeViewport && Boolean(selectedSession)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedSessionId(null);
        }}
      >
        <DialogContent
          data-testid="admin-chat-detail-dialog"
          className="flex max-h-[calc(100svh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">
            {selectedSession ? `Chat details for ${visitorLabel(selectedSession)}` : "Chat details"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visitor context and transcript for the selected chat session.
          </DialogDescription>
          <AdminSessionDetail
            compact
            loadingTranscript={loadingTranscript}
            now={now}
            selectedSession={selectedSession}
            transcript={transcript}
          />
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}

function AdminSessionDetail({
  compact = false,
  loadingTranscript,
  now,
  selectedSession,
  transcript,
}: {
  compact?: boolean;
  loadingTranscript: boolean;
  now: number;
  selectedSession: AdminSession | null;
  transcript?: TranscriptResult;
}) {
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const messageCount = transcript?.messages.length ?? 0;

  useLayoutEffect(() => {
    const node = transcriptScrollRef.current;
    if (!node || loadingTranscript) return;
    node.scrollTop = node.scrollHeight;
  }, [loadingTranscript, messageCount, selectedSession?._id]);

  if (!selectedSession) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center p-6 text-center text-muted-foreground">
        Select a visitor session to inspect the transcript.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full grid-rows-[auto_1fr]",
        compact ? "min-h-0" : "min-h-[calc(100vh-132px)]",
      )}
    >
      <div className="border-b border-border p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-3xl font-semibold text-foreground">
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
            <p className="mt-1 text-sm text-muted-foreground">
              Last seen {relativeTime(selectedSession.lastSeenAt ?? selectedSession.createdAt, now)}
            </p>
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:min-w-[360px]">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-gold" />
              {selectedSession.visitorEmail ?? "No email"}
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-gold" />
              {contactLabel(selectedSession)}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gold" />
              {formatDateTime(selectedSession.createdAt)}
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-gold" />
              {truncate(selectedSession.visitorId, 28) || "No visitor ID"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="rounded-full">
            {selectedSession.propertyName ?? selectedSession.propertySlug ?? "General"}
          </Badge>
          {selectedSession.currentPath ? (
            <Badge variant="outline" className="rounded-full">
              <ExternalLink className="mr-1 h-3 w-3" />
              {selectedSession.currentPath}
            </Badge>
          ) : null}
        </div>
        <div className="mt-4 rounded-xl border border-border bg-background/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold">
            <MapPin className="h-3.5 w-3.5" />
            Visitor context
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex items-center gap-2">
              <Globe2 className="h-3.5 w-3.5 text-gold" />
              {selectedSession.timeZone ?? "Unknown timezone"}
            </div>
            <div className="flex items-center gap-2">
              <Globe2 className="h-3.5 w-3.5 text-gold" />
              {selectedSession.browserLanguage ?? "Unknown language"}
            </div>
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-3.5 w-3.5 text-gold" />
              {selectedSession.viewportSize
                ? `Viewport ${selectedSession.viewportSize}`
                : "Unknown viewport"}
            </div>
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-3.5 w-3.5 text-gold" />
              {selectedSession.screenSize
                ? `Screen ${selectedSession.screenSize}`
                : "Unknown screen"}
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 text-gold" />
              {selectedSession.platform ?? "Unknown platform"}
            </div>
            <div className="flex items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-gold" />
              {truncate(selectedSession.referrer, 44) || "No referrer"}
            </div>
          </div>
          <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
            {selectedSession.userAgent
              ? `User agent: ${truncate(selectedSession.userAgent, 160)}`
              : "No user agent"}
          </p>
        </div>
      </div>

      <div
        ref={transcriptScrollRef}
        className="min-h-0 overflow-y-auto bg-background/50 p-4"
      >
        {loadingTranscript ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading transcript
          </div>
        ) : null}
        <div className="space-y-3">
          {(transcript?.messages ?? []).map((message) => (
            <div
              key={message._id}
              className={cn(
                "max-w-[78%] border border-border px-4 py-3 text-sm leading-6 shadow-sm",
                message.role === "user"
                  ? "ml-auto bg-navy text-white"
                  : "bg-card text-foreground",
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
                <span>{message.role === "user" ? "Visitor" : "Assistant"}</span>
                <span>{formatDateTime(message.timestamp)}</span>
              </div>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}
          {!loadingTranscript && transcript?.messages.length === 0 ? (
            <div className="border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
              This visitor opened chat but has not sent a message yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AdminQuestionsView({
  questions,
}: {
  questions: AdminSuggestedQuestion[] | undefined;
}) {
  const [selectedLocale, setSelectedLocale] = useState<Locale>(defaultLocale);
  const loading = questions === undefined;
  const rows = questions ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              <HelpCircle className="h-4 w-4" />
              Generated question ranking
            </div>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-foreground">
              Suggested Questions
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedLocale}
              onValueChange={(value) => setSelectedLocale(value as Locale)}
            >
              <SelectTrigger
                className="h-10 w-[11rem] rounded-lg"
                aria-label="Suggested question language"
                data-testid="admin-question-language"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {localeLabels[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="w-fit rounded-full">
              Read only
            </Badge>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading generated questions
          </div>
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="p-5 text-sm leading-6 text-muted-foreground">
            No generated questions yet. They will appear after visitors receive concierge
            replies from a Convex-backed chat session.
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Question</th>
                  <th className="px-4 py-3 font-semibold">Score</th>
                  <th className="px-4 py-3 font-semibold">Topic</th>
                  <th className="px-4 py-3 font-semibold">Locale</th>
                  <th className="px-4 py-3 font-semibold">Property</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((question) => (
                  <tr key={question._id} className="border-b border-border last:border-b-0">
                    <td className="max-w-[360px] px-4 py-3">
                      <p className="font-medium text-foreground">
                        {getQuestionForLocale(question, selectedLocale)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {truncate(question.currentPath, 72) ||
                          truncate(question.visitorId, 32) ||
                          String(question.sessionId).slice(-8)}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-foreground">
                      {question.score}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="rounded-full">
                        {question.topic}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{question.locale}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {question.propertySlug ?? "General"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          className={cn(
                            "rounded-full",
                            question.status === "clicked"
                              ? "bg-emerald-600 text-white"
                              : "bg-navy text-white",
                          )}
                        >
                          {question.status}
                        </Badge>
                        {question.shownAt ? (
                          <Badge variant="secondary" className="rounded-full">
                            shown
                          </Badge>
                        ) : null}
                        {question.clickedAt ? (
                          <Badge variant="secondary" className="rounded-full">
                            clicked
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(question.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
