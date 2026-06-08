"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Archive,
  Clock,
  Edit3,
  ExternalLink,
  Globe2,
  HelpCircle,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MonitorSmartphone,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Component, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultLocale, localeLabels, locales, type Locale } from "@/i18n/routing";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";
type AdminDashboardView = "chats" | "questions";

type AdminMessage = {
  _id: Id<"chatMessages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type LineWebhookStatus = "received" | "processing" | "replied" | "ignored" | "failed";
type LineReplyMode = "exact" | "ai" | "postback" | "follow" | "ignored" | "failed";

type AdminLineEvent = {
  _id: Id<"lineWebhookEvents">;
  eventType: "message" | "follow" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: LineReplyMode;
  lineReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
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
  latestLineEvent?: AdminLineEvent | null;
};

type SessionListResult = {
  sessions: AdminSession[];
  nextCursor: number | null;
};

type TranscriptResult = {
  session: AdminSession;
  messages: AdminMessage[];
  lineEvents?: AdminLineEvent[];
};

type AdminSuggestedQuestion = {
  _id: Id<"chatSuggestedQuestions">;
  source?: "generated";
  suggestionId?: Id<"chatSuggestedQuestions">;
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

type CuratedQuestionStatus = "all" | "active" | "archived";

type AdminCuratedQuestion = {
  _id: Id<"curatedChatQuestions">;
  question: string;
  normalizedQuestion: string;
  translations?: Record<string, string>;
  locale?: string;
  propertySlug?: string;
  topic: string;
  score: number;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  createdByAdminEmail: string;
  updatedByAdminEmail: string;
  archivedByAdminEmail?: string;
};

type QuestionBankForm = {
  question: string;
  topic: string;
  score: string;
  propertySlug: string;
  translations: Record<string, string>;
};

const statusOptions: SessionStatus[] = ["active", "all", "inactive"];
const curatedStatusOptions: CuratedQuestionStatus[] = ["active", "all", "archived"];
const questionTopics = [
  "villa_fit",
  "direct_booking",
  "tour",
  "availability",
  "booking",
  "amenities",
  "contact",
];
const PRESENCE_CLOCK_MS = 10_000;

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

function getCuratedQuestionForLocale(question: AdminCuratedQuestion, locale: Locale) {
  if (locale === defaultLocale) return question.question;
  return question.translations?.[locale]?.trim() || question.question;
}

function emptyQuestionBankForm(): QuestionBankForm {
  return {
    question: "",
    topic: "villa_fit",
    score: "80",
    propertySlug: "",
    translations: {},
  };
}

function formForCuratedQuestion(question: AdminCuratedQuestion): QuestionBankForm {
  return {
    question: question.question,
    topic: question.topic,
    score: String(question.score),
    propertySlug: question.propertySlug ?? "",
    translations: Object.fromEntries(
      locales
        .filter((locale) => locale !== defaultLocale)
        .map((locale) => [locale, question.translations?.[locale] ?? ""]),
    ),
  };
}

function scoreFromForm(value: string) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 50;
}

function translationsFromForm(form: QuestionBankForm) {
  return Object.fromEntries(
    Object.entries(form.translations)
      .map(([locale, value]) => [locale, value.trim()])
      .filter(([, value]) => value),
  );
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
  const [propertySlug, setPropertySlug] = useState("");
  const [selectedSessionId, setSelectedSessionId] =
    useState<Id<"chatSessions"> | null>(null);
  const trimmedPropertySlug = propertySlug.trim();
  const sessionsResetKey = `${status}:${trimmedPropertySlug}`;
  const liveSessionsResult = useQuery(api.adminChat.listSessions, {
    status,
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
                    setSelectedSessionId(null);
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
            <div className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={propertySlug}
                  onChange={(event) => setPropertySlug(event.target.value)}
                  className="h-10 rounded-lg pl-9"
                  placeholder="Filter by property slug"
                />
              </div>
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
                ) : session.latestLineEvent ? (
                  <p
                    className={cn(
                      "mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground",
                      session.latestLineEvent.status === "failed" && "text-red-300",
                    )}
                  >
                    {lineEventLabel(session.latestLineEvent)}
                    {session.latestLineEvent.error
                      ? `: ${truncate(session.latestLineEvent.error, 96)}`
                      : ""}
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
  if (!selectedSession) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center p-6 text-center text-muted-foreground">
        Select a visitor session to inspect the transcript.
      </div>
    );
  }

  const latestLineEvent = transcript?.lineEvents?.[0] ?? selectedSession.latestLineEvent;

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
        {selectedSession.channel === "line" && latestLineEvent ? (
          <div
            className={cn(
              "mt-4 rounded-lg border border-border bg-background/70 p-3 text-xs",
              latestLineEvent.status === "failed" && "border-red-900/60 bg-red-950/20",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <MessageCircle className="h-3.5 w-3.5 text-gold" />
              <span className="font-semibold uppercase tracking-[0.16em] text-gold">
                LINE delivery
              </span>
              <Badge
                variant={lineEventTone(latestLineEvent)}
                className={cn(
                  "rounded-full",
                  latestLineEvent.status === "failed" && "border-red-500/50 text-red-200",
                )}
              >
                {lineEventLabel(latestLineEvent)}
              </Badge>
            </div>
            <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
              <div>{formatDateTime(latestLineEvent.updatedAt)}</div>
              <div className="break-words">
                {latestLineEvent.messageText
                  ? truncate(latestLineEvent.messageText, 120)
                  : latestLineEvent.postbackData
                    ? truncate(latestLineEvent.postbackData, 120)
                    : latestLineEvent.eventType}
              </div>
            </div>
            {latestLineEvent.error ? (
              <p className="mt-2 break-words leading-5 text-red-200">
                {truncate(latestLineEvent.error, 260)}
              </p>
            ) : null}
          </div>
        ) : null}
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

      <div className="min-h-0 overflow-y-auto bg-background/50 p-4">
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
              {latestLineEvent
                ? `No transcript message is stored yet. Latest LINE event: ${lineEventLabel(latestLineEvent)}.`
                : "This visitor opened chat but has not sent a message yet."}
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
  const [mode, setMode] = useState<"bank" | "generated">("bank");
  const [curatedStatus, setCuratedStatus] = useState<CuratedQuestionStatus>("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<AdminCuratedQuestion | null>(null);
  const [form, setForm] = useState<QuestionBankForm>(() => emptyQuestionBankForm());
  const [formError, setFormError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const curatedQuestions = useQuery(api.chatSuggestions.adminListCurated, {
    status: curatedStatus,
    limit: 100,
  }) as AdminCuratedQuestion[] | undefined;
  const createQuestion = useMutation(api.chatSuggestions.adminCreateCurated);
  const updateQuestion = useMutation(api.chatSuggestions.adminUpdateCurated);
  const archiveQuestion = useMutation(api.chatSuggestions.adminArchiveCurated);
  const restoreQuestion = useMutation(api.chatSuggestions.adminRestoreCurated);
  const deleteQuestion = useMutation(api.chatSuggestions.adminDeleteArchivedCurated);
  const generatedLoading = questions === undefined;
  const generatedRows = questions ?? [];
  const curatedLoading = curatedQuestions === undefined;
  const curatedRows = curatedQuestions ?? [];

  function openCreateDialog() {
    setEditingQuestion(null);
    setForm(emptyQuestionBankForm());
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(question: AdminCuratedQuestion) {
    setEditingQuestion(question);
    setForm(formForCuratedQuestion(question));
    setFormError("");
    setDialogOpen(true);
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const question = form.question.trim();
    if (!question) {
      setFormError("Question is required.");
      return;
    }

    setPendingAction("save");
    try {
      const payload = {
        question,
        translations: translationsFromForm(form),
        topic: form.topic,
        score: scoreFromForm(form.score),
        propertySlug: form.propertySlug.trim() || undefined,
      };
      if (editingQuestion) {
        await updateQuestion({ questionId: editingQuestion._id, ...payload });
      } else {
        await createQuestion(payload);
      }
      setDialogOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save question.");
    } finally {
      setPendingAction("");
    }
  }

  async function runQuestionAction(action: string, question: AdminCuratedQuestion) {
    setPendingAction(`${action}:${question._id}`);
    try {
      if (action === "archive") await archiveQuestion({ questionId: question._id });
      if (action === "restore") await restoreQuestion({ questionId: question._id });
      if (action === "delete") {
        const confirmed = window.confirm(
          "Permanently delete this archived question? This cannot be undone.",
        );
        if (!confirmed) return;
        await deleteQuestion({ questionId: question._id });
      }
    } finally {
      setPendingAction("");
    }
  }

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
            <div className="mt-4 flex w-fit rounded-lg border border-border bg-background p-1">
              {(["bank", "generated"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={cn(
                    "rounded-md px-4 py-2 text-xs font-semibold capitalize transition",
                    mode === option
                      ? "bg-navy text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option === "bank" ? "Question bank" : "Generated activity"}
                </button>
              ))}
            </div>
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
            {mode === "bank" ? (
              <>
                <Select
                  value={curatedStatus}
                  onValueChange={(value) => setCuratedStatus(value as CuratedQuestionStatus)}
                >
                  <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Question status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {curatedStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={openCreateDialog} size="sm">
                  <Plus className="h-4 w-4" />
                  Add question
                </Button>
              </>
            ) : (
              <Badge variant="secondary" className="w-fit rounded-full">
                Read only
              </Badge>
            )}
          </div>
        </div>

        {mode === "bank" && curatedLoading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading question bank
          </div>
        ) : null}

        {mode === "bank" && !curatedLoading && curatedRows.length === 0 ? (
          <div className="p-5 text-sm leading-6 text-muted-foreground">
            No curated questions match this filter yet.
          </div>
        ) : null}

        {mode === "bank" && curatedRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Question</th>
                  <th className="px-4 py-3 font-semibold">Score</th>
                  <th className="px-4 py-3 font-semibold">Topic</th>
                  <th className="px-4 py-3 font-semibold">Scope</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {curatedRows.map((question) => (
                  <tr key={question._id} className="border-b border-border last:border-b-0">
                    <td className="max-w-[390px] px-4 py-3">
                      <p className="font-medium text-foreground">
                        {getCuratedQuestionForLocale(question, selectedLocale)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Created by {question.createdByAdminEmail}
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
                    <td className="px-4 py-3 text-muted-foreground">
                      {question.propertySlug ?? "Global"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={cn(
                          "rounded-full",
                          question.status === "active"
                            ? "bg-emerald-600 text-white"
                            : "bg-muted text-foreground",
                        )}
                      >
                        {question.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(question.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(question)}
                        >
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                        {question.status === "active" ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={pendingAction === `archive:${question._id}`}
                            onClick={() => void runQuestionAction("archive", question)}
                          >
                            <Archive className="h-4 w-4" />
                            Archive
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={pendingAction === `restore:${question._id}`}
                              onClick={() => void runQuestionAction("restore", question)}
                            >
                              <RotateCcw className="h-4 w-4" />
                              Restore
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={pendingAction === `delete:${question._id}`}
                              onClick={() => void runQuestionAction("delete", question)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {mode === "generated" && generatedLoading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading generated questions
          </div>
        ) : null}

        {mode === "generated" && !generatedLoading && generatedRows.length === 0 ? (
          <div className="p-5 text-sm leading-6 text-muted-foreground">
            No generated questions yet. They will appear after visitors receive concierge
            replies from a Convex-backed chat session.
          </div>
        ) : null}

        {mode === "generated" && generatedRows.length > 0 ? (
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
                {generatedRows.map((question) => (
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? "Edit Question" : "Add Question"}
            </DialogTitle>
            <DialogDescription>
              Active questions can appear as concierge chat suggestions immediately.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitQuestion}>
            <div className="grid gap-2">
              <Label htmlFor="question-text">Question</Label>
              <Input
                id="question-text"
                value={form.question}
                maxLength={160}
                onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                placeholder="Can I check availability for my dates?"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className="grid gap-2">
                <Label htmlFor="question-topic">Topic</Label>
                <Select
                  value={form.topic}
                  onValueChange={(value) => setForm((current) => ({ ...current, topic: value }))}
                >
                  <SelectTrigger id="question-topic" className="h-10 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {questionTopics.map((topic) => (
                      <SelectItem key={topic} value={topic}>
                        {topic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="question-score">Score</Label>
                <Input
                  id="question-score"
                  type="number"
                  min={0}
                  max={100}
                  value={form.score}
                  onChange={(event) => setForm((current) => ({ ...current, score: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="question-property">Property slug</Label>
              <Input
                id="question-property"
                value={form.propertySlug}
                onChange={(event) => setForm((current) => ({ ...current, propertySlug: event.target.value }))}
                placeholder="Leave blank for global"
              />
            </div>
            <div className="grid gap-3">
              <p className="text-sm font-medium text-foreground">Translations</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {locales
                  .filter((locale) => locale !== defaultLocale)
                  .map((locale) => (
                    <div key={locale} className="grid gap-2">
                      <Label htmlFor={`translation-${locale}`}>{localeLabels[locale]}</Label>
                      <Input
                        id={`translation-${locale}`}
                        value={form.translations[locale] ?? ""}
                        maxLength={160}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            translations: {
                              ...current.translations,
                              [locale]: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
              </div>
            </div>
            {formError ? (
              <p className="text-sm font-medium text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pendingAction === "save"}>
                {pendingAction === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save question
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
