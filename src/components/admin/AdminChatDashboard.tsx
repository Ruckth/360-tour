"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  Filter,
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
  X,
} from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Component, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultLocale, localeLabels, locales, type Locale } from "@/i18n/routing";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";
type EmptyChatFilter = "all" | "empty";
type AdminDashboardView = "chats" | "questions";

type AdminMessage = {
  _id: Id<"chatMessages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type LineWebhookStatus = "received" | "processing" | "replied" | "ignored" | "failed";
type LineReplyMode =
  | "exact"
  | "approved_exact"
  | "question_bank_exact"
  | "question_bank_semantic"
  | "ai"
  | "unknown_fallback"
  | "postback"
  | "follow"
  | "ignored"
  | "failed";

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
  messageCount?: number;
  latestMessageAt?: number;
  adminSortAt?: number;
  isActive: boolean;
  latestMessage?: AdminMessage;
  latestLineEvent?: AdminLineEvent | null;
};

type SessionListResult = {
  sessions: AdminSession[];
  continueCursor: string | null;
  nextCursor?: string | null;
  isDone: boolean;
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
type CuratedAnswerMode = "static" | "dynamic";
type CuratedDynamicIntent = "availability" | "pricing" | "property_details" | "booking_help" | "contact";

type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
type KnowledgeAnswerFilter = KnowledgeAnswerStatus | "all";
type UnknownQuestionStatus = "new" | "resolved" | "ignored";
type UnknownQuestionFilter = UnknownQuestionStatus | "all";
type KnowledgeViewMode = "answers" | "unknown" | "generated";

type AdminKnowledgeQuestion = {
  _id: Id<"chatQuestions">;
  answerId: Id<"chatAnswers">;
  questionText: string;
  normalizedQuestion: string;
  isPrimary: boolean;
  isAiTrigger: boolean;
  createdBy: "admin" | "ai";
  status: "approved" | "suggested" | "rejected";
  createdAt: number;
  updatedAt: number;
};

type AdminKnowledgeTopic = {
  _id: Id<"chatTopics">;
  name: string;
  description: string;
};

type AdminKnowledgeAnswer = {
  _id: Id<"chatAnswers">;
  propertyName?: string;
  propertySlug?: string;
  title: string;
  answer: string;
  status: KnowledgeAnswerStatus;
  createdAt: number;
  updatedAt: number;
  questions: AdminKnowledgeQuestion[];
  topics: AdminKnowledgeTopic[];
};

type AdminUnknownQuestion = {
  _id: Id<"chatUnknownQuestions">;
  propertyName?: string;
  propertySlug?: string;
  userQuestion: string;
  normalizedQuestion: string;
  detectedTopic?: string;
  userId?: string;
  pageUrl?: string;
  status: UnknownQuestionStatus;
  adminNotified: boolean;
  resolvedAnswerTitle?: string;
  createdAt: number;
  updatedAt: number;
};

type AnswerKnowledgeForm = {
  title: string;
  answer: string;
  status: KnowledgeAnswerStatus;
  primaryQuestion: string;
  questions: string;
  topicNames: string;
  propertySlug: string;
};

type AdminCuratedQuestion = {
  _id: Id<"curatedChatQuestions">;
  question: string;
  normalizedQuestion: string;
  translations?: Record<string, string>;
  answer?: string;
  answerTranslations?: Record<string, string>;
  answerMode?: CuratedAnswerMode;
  dynamicIntent?: CuratedDynamicIntent;
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
  answer: string;
  answerMode: CuratedAnswerMode;
  dynamicIntent: CuratedDynamicIntent;
  topic: string;
  score: string;
  propertySlug: string;
  translations: Record<string, string>;
  answerTranslations: Record<string, string>;
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
const dynamicIntentOptions: CuratedDynamicIntent[] = [
  "availability",
  "pricing",
  "property_details",
  "booking_help",
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

function dateTimeInputToMillis(value: string) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function dateTimeBadgeLabel(value: string) {
  const timestamp = dateTimeInputToMillis(value);
  return typeof timestamp === "number" ? formatDateTime(timestamp) : value;
}

function emptyFilterLabel(value: EmptyChatFilter) {
  if (value === "empty") return "Empty only";
  return "All threads";
}

function getQuestionForLocale(question: AdminSuggestedQuestion, locale: Locale) {
  if (locale === defaultLocale) return question.question;
  return question.translations?.[locale]?.trim() || "";
}

function isMissingSuggestionTranslation(question: AdminSuggestedQuestion, locale: Locale) {
  return locale !== defaultLocale && !question.translations?.[locale]?.trim();
}

function getCuratedQuestionForLocale(question: AdminCuratedQuestion, locale: Locale) {
  if (locale === defaultLocale) return question.question;
  return question.translations?.[locale]?.trim() || question.question;
}

function getCuratedAnswerForLocale(question: AdminCuratedQuestion, locale: Locale) {
  if (!question.answer?.trim()) return "";
  if (locale === defaultLocale) return question.answer;
  return question.answerTranslations?.[locale]?.trim() || question.answer;
}

function emptyQuestionBankForm(): QuestionBankForm {
  return {
    question: "",
    answer: "",
    answerMode: "static",
    dynamicIntent: "property_details",
    topic: "villa_fit",
    score: "80",
    propertySlug: "",
    translations: {},
    answerTranslations: {},
  };
}

function formForCuratedQuestion(question: AdminCuratedQuestion): QuestionBankForm {
  const answerMode = question.answerMode ?? (question.answer ? "static" : "dynamic");
  return {
    question: question.question,
    answer: question.answer ?? "",
    answerMode,
    dynamicIntent: question.dynamicIntent ?? "property_details",
    topic: question.topic,
    score: String(question.score),
    propertySlug: question.propertySlug ?? "",
    translations: Object.fromEntries(
      locales
        .filter((locale) => locale !== defaultLocale)
        .map((locale) => [locale, question.translations?.[locale] ?? ""]),
    ),
    answerTranslations: Object.fromEntries(
      locales
        .filter((locale) => locale !== defaultLocale)
        .map((locale) => [locale, question.answerTranslations?.[locale] ?? ""]),
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

function answerTranslationsFromForm(form: QuestionBankForm) {
  return Object.fromEntries(
    Object.entries(form.answerTranslations)
      .map(([locale, value]) => [locale, value.trim()])
      .filter(([, value]) => value),
  );
}

function answerModeLabel(mode?: CuratedAnswerMode, answer?: string) {
  const resolved = mode ?? (answer ? "static" : "dynamic");
  return resolved === "static" ? "Static" : "Dynamic";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [emptyFilter, setEmptyFilter] = useState<EmptyChatFilter>("all");
  const [messageStartAt, setMessageStartAt] = useState("");
  const [messageEndAt, setMessageEndAt] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [selectedSessionId, setSelectedSessionId] =
    useState<Id<"chatSessions"> | null>(null);
  const trimmedSearchQuery = searchQuery.trim();
  const parsedMessageStartAt = dateTimeInputToMillis(messageStartAt);
  const parsedMessageEndAt = dateTimeInputToMillis(messageEndAt);
  const currentCursor = pageCursors[pageIndex] ?? null;
  const filterResetKey = [
    status,
    trimmedSearchQuery,
    emptyFilter,
    messageStartAt,
    messageEndAt,
  ].join(":");
  const sessionsResetKey = `${filterResetKey}:${currentCursor ?? "first"}`;
  const liveSessionsResult = useQuery(api.adminChat.listSessions, {
    paginationOpts: { numItems: 10, cursor: currentCursor },
    status,
    empty: emptyFilter,
    searchQuery: trimmedSearchQuery || undefined,
    messageStartAt: parsedMessageStartAt,
    messageEndAt: parsedMessageEndAt,
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

  const resetSessionPaging = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
    setSelectedSessionId(null);
  }, []);

  function handleNextPage() {
    const nextCursor = sessionsResult?.continueCursor ?? sessionsResult?.nextCursor ?? null;
    if (!nextCursor || sessionsResult?.isDone) return;
    setPageCursors((current) => [
      ...current.slice(0, pageIndex + 1),
      nextCursor,
    ]);
    setPageIndex((current) => current + 1);
    setSelectedSessionId(null);
  }

  function handlePreviousPage() {
    if (pageIndex <= 0) return;
    setPageIndex((current) => Math.max(0, current - 1));
    setSelectedSessionId(null);
  }

  useEffect(() => {
    if (!sessionsResult) return;

    setSelectedSessionId((current) => {
      if (current && sessionsResult.sessions.some((session) => session._id === current)) {
        return current;
      }
      return isLargeViewport ? sessionsResult.sessions[0]?._id ?? null : null;
    });
  }, [isLargeViewport, sessionsResult]);

  useEffect(() => {
    resetSessionPaging();
  }, [filterResetKey, resetSessionPaging]);

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
        <aside className="grid min-h-[calc(100vh-132px)] grid-rows-[auto_minmax(0,1fr)_auto] border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="flex rounded-lg border border-border bg-background p-1">
              {statusOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setStatus(option);
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
                      (emptyFilter !== "all" || messageStartAt || messageEndAt) &&
                        "border-gold text-gold",
                    )}
                    aria-label="Open chat filters"
                  >
                    <Filter className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Filters</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Empty thread
                    </Label>
                    <div className="grid grid-cols-2 rounded-lg border border-border bg-background p-1">
                      {(["all", "empty"] satisfies EmptyChatFilter[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setEmptyFilter(option)}
                          className={cn(
                            "rounded-md px-2 py-2 text-xs font-semibold transition",
                            emptyFilter === option
                              ? "bg-navy text-white shadow-sm"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {option === "all" ? "All" : "Empty"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="admin-message-start" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Message start
                      </Label>
                      <Input
                        id="admin-message-start"
                        type="datetime-local"
                        value={messageStartAt}
                        onChange={(event) => setMessageStartAt(event.target.value)}
                        className="admin-datetime-input h-10 rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="admin-message-end" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Message end
                      </Label>
                      <Input
                        id="admin-message-end"
                        type="datetime-local"
                        value={messageEndAt}
                        onChange={(event) => setMessageEndAt(event.target.value)}
                        className="admin-datetime-input h-10 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEmptyFilter("all");
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
            {trimmedSearchQuery || emptyFilter !== "all" || messageStartAt || messageEndAt ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {trimmedSearchQuery ? (
                  <Badge variant="secondary" className="gap-1 rounded-full">
                    Search: {truncate(trimmedSearchQuery, 24)}
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
                {emptyFilter !== "all" ? (
                  <Badge variant="secondary" className="gap-1 rounded-full">
                    {emptyFilterLabel(emptyFilter)}
                    <button
                      type="button"
                      onClick={() => setEmptyFilter("all")}
                      aria-label="Clear empty filter"
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
                {messageStartAt ? (
                  <Badge variant="secondary" className="gap-1 rounded-full">
                    From {dateTimeBadgeLabel(messageStartAt)}
                    <button
                      type="button"
                      onClick={() => setMessageStartAt("")}
                      aria-label="Clear message start"
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
                {messageEndAt ? (
                  <Badge variant="secondary" className="gap-1 rounded-full">
                    To {dateTimeBadgeLabel(messageEndAt)}
                    <button
                      type="button"
                      onClick={() => setMessageEndAt("")}
                      aria-label="Clear message end"
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto">
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
                      {session.channel} · {session.messageCount ?? 0} messages
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(
                      session.latestMessageAt ?? session.lastSeenAt ?? session.createdAt,
                      now,
                    )}
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
  const [mode, setMode] = useState<KnowledgeViewMode>("answers");
  const [answerStatus, setAnswerStatus] = useState<KnowledgeAnswerFilter>("approved");
  const [unknownStatus, setUnknownStatus] = useState<UnknownQuestionFilter>("new");
  const [answerDialogOpen, setAnswerDialogOpen] = useState(false);
  const [editingAnswer, setEditingAnswer] = useState<AdminKnowledgeAnswer | null>(null);
  const [sourceUnknown, setSourceUnknown] = useState<AdminUnknownQuestion | null>(null);
  const [form, setForm] = useState<AnswerKnowledgeForm>(() => emptyKnowledgeForm());
  const [formError, setFormError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [linkAnswerIds, setLinkAnswerIds] = useState<Record<string, string>>({});
  const answers = useQuery(
    api.chatKnowledge.adminListAnswers,
    mode === "answers"
      ? {
          status: answerStatus === "all" ? undefined : answerStatus,
          limit: 100,
        }
      : mode === "unknown"
        ? { status: "approved", limit: 100 }
        : "skip",
  ) as AdminKnowledgeAnswer[] | undefined;
  const unknownQuestions = useQuery(
    api.chatKnowledge.adminListUnknownQuestions,
    mode === "unknown" ? { status: unknownStatus, limit: 100 } : "skip",
  ) as AdminUnknownQuestion[] | undefined;
  const createAnswer = useMutation(api.chatKnowledge.adminCreateAnswer);
  const updateAnswer = useMutation(api.chatKnowledge.adminUpdateAnswer);
  const approveQuestion = useMutation(api.chatKnowledge.adminApproveQuestion);
  const rejectQuestion = useMutation(api.chatKnowledge.adminRejectQuestion);
  const ignoreUnknown = useMutation(api.chatKnowledge.adminIgnoreUnknown);
  const createAnswerFromUnknown = useAction(api.chatKnowledge.adminCreateAnswerFromUnknown);
  const resolveUnknownWithAnswer = useAction(api.chatKnowledge.adminResolveUnknownWithAnswer);
  const generateSimilarQuestions = useAction(api.chatKnowledge.adminGenerateSimilarQuestions);
  const backfillThaiSuggestions = useMutation(api.chatSuggestions.adminBackfillThaiGeneratedSuggestions);
  const answerRows = answers ?? [];
  const unknownRows = unknownQuestions ?? [];
  const generatedRows = questions ?? [];

  function emptyKnowledgeForm(): AnswerKnowledgeForm {
    return {
      title: "",
      answer: "",
      status: "approved",
      primaryQuestion: "",
      questions: "",
      topicNames: "",
      propertySlug: "",
    };
  }

  function formForKnowledgeAnswer(answer: AdminKnowledgeAnswer): AnswerKnowledgeForm {
    return {
      title: answer.title,
      answer: answer.answer,
      status: answer.status,
      primaryQuestion:
        answer.questions.find((question) => question.isPrimary)?.questionText ??
        answer.questions.find((question) => question.status === "approved")?.questionText ??
        "",
      questions: "",
      topicNames: answer.topics.map((topic) => topic.name).join(", "),
      propertySlug: answer.propertySlug ?? "",
    };
  }

  function splitList(value: string) {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function openCreateAnswer() {
    setEditingAnswer(null);
    setSourceUnknown(null);
    setForm(emptyKnowledgeForm());
    setFormError("");
    setAnswerDialogOpen(true);
  }

  function openEditAnswer(answer: AdminKnowledgeAnswer) {
    setEditingAnswer(answer);
    setSourceUnknown(null);
    setForm(formForKnowledgeAnswer(answer));
    setFormError("");
    setAnswerDialogOpen(true);
  }

  function openCreateFromUnknown(question: AdminUnknownQuestion) {
    setEditingAnswer(null);
    setSourceUnknown(question);
    setForm({
      ...emptyKnowledgeForm(),
      title: question.detectedTopic ? `${question.detectedTopic}: ${question.userQuestion}` : question.userQuestion,
      primaryQuestion: question.userQuestion,
      topicNames: question.detectedTopic ?? "",
      propertySlug: question.propertySlug ?? "",
    });
    setFormError("");
    setAnswerDialogOpen(true);
  }

  async function submitKnowledgeAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const title = form.title.trim();
    const answer = form.answer.trim();
    if (!title || !answer) {
      setFormError("Title and answer are required.");
      return;
    }
    if (!editingAnswer && !sourceUnknown && !form.primaryQuestion.trim()) {
      setFormError("Add the primary question guests will ask.");
      return;
    }

    setPendingAction("save-answer");
    try {
      const topicNames = splitList(form.topicNames);
      if (sourceUnknown) {
        await createAnswerFromUnknown({
          unknownQuestionId: sourceUnknown._id,
          title,
          answer,
          status: form.status,
          topicNames,
          generateSimilar: true,
        });
      } else if (editingAnswer) {
        await updateAnswer({
          answerId: editingAnswer._id,
          title,
          answer,
          status: form.status,
          topicNames,
          propertySlug: form.propertySlug.trim() || undefined,
        });
      } else {
        await createAnswer({
          title,
          answer,
          status: form.status,
          primaryQuestion: form.primaryQuestion.trim(),
          questions: splitList(form.questions),
          topicNames,
          propertySlug: form.propertySlug.trim() || undefined,
        });
      }
      setAnswerDialogOpen(false);
      setSourceUnknown(null);
      setEditingAnswer(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save answer.");
    } finally {
      setPendingAction("");
    }
  }

  async function runAnswerAction(action: string, answer: AdminKnowledgeAnswer) {
    setPendingAction(`${action}:${answer._id}`);
    try {
      if (action === "generate") {
        await generateSimilarQuestions({ answerId: answer._id });
      }
    } finally {
      setPendingAction("");
    }
  }

  async function runQuestionAction(action: string, question: AdminKnowledgeQuestion) {
    setPendingAction(`${action}:${question._id}`);
    try {
      if (action === "approve") await approveQuestion({ questionId: question._id });
      if (action === "reject") await rejectQuestion({ questionId: question._id });
    } finally {
      setPendingAction("");
    }
  }

  async function linkUnknownQuestion(question: AdminUnknownQuestion) {
    const answerId = linkAnswerIds[question._id];
    if (!answerId) return;
    setPendingAction(`link:${question._id}`);
    try {
      await resolveUnknownWithAnswer({
        unknownQuestionId: question._id,
        answerId: answerId as Id<"chatAnswers">,
        generateSimilar: true,
      });
    } finally {
      setPendingAction("");
    }
  }

  async function ignoreUnknownQuestion(question: AdminUnknownQuestion) {
    setPendingAction(`ignore:${question._id}`);
    try {
      await ignoreUnknown({ unknownQuestionId: question._id });
    } finally {
      setPendingAction("");
    }
  }

  async function runThaiSuggestionBackfill() {
    setPendingAction("backfill-thai");
    try {
      await backfillThaiSuggestions({ limit: 100 });
    } finally {
      setPendingAction("");
    }
  }

  function answerStatusTone(status: KnowledgeAnswerStatus) {
    if (status === "approved") return "bg-emerald-600 text-white";
    if (status === "archived") return "bg-muted text-foreground";
    return "bg-amber-600 text-white";
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              <HelpCircle className="h-4 w-4" />
              Approved knowledge
            </div>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-foreground">
              Chatbot Knowledge
            </h2>
            <div className="mt-4 flex w-fit rounded-lg border border-border bg-background p-1">
              {(["answers", "unknown", "generated"] satisfies KnowledgeViewMode[]).map((option) => (
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
                  {option === "generated" ? "AI Suggestions" : option}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "answers" ? (
              <>
                <Select
                  value={answerStatus}
                  onValueChange={(value) => setAnswerStatus(value as KnowledgeAnswerFilter)}
                >
                  <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Answer status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["approved", "draft", "archived", "all"] satisfies KnowledgeAnswerFilter[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={openCreateAnswer} size="sm">
                  <Plus className="h-4 w-4" />
                  Add answer
                </Button>
              </>
            ) : null}
            {mode === "unknown" ? (
              <Select
                value={unknownStatus}
                onValueChange={(value) => setUnknownStatus(value as UnknownQuestionFilter)}
              >
                <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Unknown status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["new", "resolved", "ignored", "all"] satisfies UnknownQuestionFilter[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {mode === "generated" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingAction === "backfill-thai"}
                  onClick={() => void runThaiSuggestionBackfill()}
                >
                  {pendingAction === "backfill-thai" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Fill Thai
                </Button>
                <Select
                  value={selectedLocale}
                  onValueChange={(value) => setSelectedLocale(value as Locale)}
                >
                  <SelectTrigger className="h-10 w-[11rem] rounded-lg" aria-label="Suggested question language">
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
              </>
            ) : null}
          </div>
        </div>

        {mode === "answers" ? (
          <div>
            {!answers ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading answers
              </div>
            ) : null}
            {answers && answerRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No approved answers match this filter yet.
              </div>
            ) : null}
            {answerRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Answer</th>
                      <th className="px-4 py-3 font-semibold">Questions</th>
                      <th className="px-4 py-3 font-semibold">Suggested</th>
                      <th className="px-4 py-3 font-semibold">Scope</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {answerRows.map((answer) => {
                      const approvedQuestions = answer.questions.filter((question) => question.status === "approved");
                      const suggestedQuestions = answer.questions.filter((question) => question.status === "suggested");
                      return (
                        <tr key={answer._id} className="border-b border-border last:border-b-0">
                          <td className="max-w-[360px] px-4 py-3">
                            <p className="font-medium text-foreground">{answer.title}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                              {answer.answer}
                            </p>
                            {answer.topics.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {answer.topics.map((topic) => (
                                  <Badge key={topic._id} variant="outline" className="rounded-full">
                                    {topic.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td className="max-w-[300px] px-4 py-3 text-muted-foreground">
                            {approvedQuestions.length > 0 ? (
                              <div className="space-y-1">
                                {approvedQuestions.slice(0, 4).map((question) => (
                                  <p key={question._id} className="line-clamp-1">
                                    {question.isPrimary ? "Primary: " : ""}
                                    {question.questionText}
                                  </p>
                                ))}
                                {approvedQuestions.length > 4 ? (
                                  <p className="text-xs">+{approvedQuestions.length - 4} more</p>
                                ) : null}
                              </div>
                            ) : (
                              <span>No approved questions</span>
                            )}
                          </td>
                          <td className="max-w-[300px] px-4 py-3">
                            {suggestedQuestions.length > 0 ? (
                              <div className="space-y-2">
                                {suggestedQuestions.slice(0, 3).map((question) => (
                                  <div key={question._id} className="rounded-lg border border-border bg-background/70 p-2">
                                    <p className="text-xs leading-5 text-foreground">{question.questionText}</p>
                                    <div className="mt-2 flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={pendingAction === `approve:${question._id}`}
                                        onClick={() => void runQuestionAction("approve", question)}
                                      >
                                        Approve
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={pendingAction === `reject:${question._id}`}
                                        onClick={() => void runQuestionAction("reject", question)}
                                      >
                                        Reject
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">No pending suggestions</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {answer.propertyName ?? answer.propertySlug ?? "Global"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={cn("rounded-full", answerStatusTone(answer.status))}>
                              {answer.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openEditAnswer(answer)}>
                                <Edit3 className="h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={pendingAction === `generate:${answer._id}`}
                                onClick={() => void runAnswerAction("generate", answer)}
                              >
                                {pendingAction === `generate:${answer._id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Plus className="h-4 w-4" />
                                )}
                                Generate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "unknown" ? (
          <div>
            {!unknownQuestions ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading unknown questions
              </div>
            ) : null}
            {unknownQuestions && unknownRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No unknown questions match this filter.
              </div>
            ) : null}
            {unknownRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Question</th>
                      <th className="px-4 py-3 font-semibold">Context</th>
                      <th className="px-4 py-3 font-semibold">Link Existing</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unknownRows.map((question) => (
                      <tr key={question._id} className="border-b border-border last:border-b-0">
                        <td className="max-w-[360px] px-4 py-3">
                          <p className="font-medium text-foreground">{question.userQuestion}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(question.createdAt)}
                          </p>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 text-muted-foreground">
                          <p>{question.propertyName ?? question.propertySlug ?? "General"}</p>
                          <p className="mt-1 line-clamp-1 text-xs">
                            {question.detectedTopic ?? "No topic"} · {truncate(question.pageUrl, 72) || "No page"}
                          </p>
                        </td>
                        <td className="min-w-[260px] px-4 py-3">
                          {question.status === "new" ? (
                            <div className="flex gap-2">
                              <Select
                                value={linkAnswerIds[question._id] ?? ""}
                                onValueChange={(value) =>
                                  setLinkAnswerIds((current) => ({
                                    ...current,
                                    [question._id]: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 min-w-[180px] rounded-lg" aria-label="Link answer">
                                  <SelectValue placeholder="Select answer" />
                                </SelectTrigger>
                                <SelectContent>
                                  {answerRows.map((answer) => (
                                    <SelectItem key={answer._id} value={answer._id}>
                                      {answer.title}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={!linkAnswerIds[question._id] || pendingAction === `link:${question._id}`}
                                onClick={() => void linkUnknownQuestion(question)}
                              >
                                Link
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              {question.resolvedAnswerTitle ?? "No linked answer"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={question.status === "new" ? "default" : "secondary"} className="rounded-full">
                            {question.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {question.status === "new" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" onClick={() => openCreateFromUnknown(question)}>
                                <Plus className="h-4 w-4" />
                                Create answer
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingAction === `ignore:${question._id}`}
                                onClick={() => void ignoreUnknownQuestion(question)}
                              >
                                Ignore
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{formatDateTime(question.updatedAt)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "generated" ? (
          <div>
            {questions === undefined ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading generated suggestions
              </div>
            ) : null}
            {questions && generatedRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No generated chat suggestions yet.
              </div>
            ) : null}
            {generatedRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Question</th>
                      <th className="px-4 py-3 font-semibold">Score</th>
                      <th className="px-4 py-3 font-semibold">Topic</th>
                      <th className="px-4 py-3 font-semibold">Property</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatedRows.map((question) => {
                      const localizedQuestion = getQuestionForLocale(question, selectedLocale);
                      const missingTranslation = isMissingSuggestionTranslation(question, selectedLocale);

                      return (
                        <tr key={question._id} className="border-b border-border last:border-b-0">
                          <td className="max-w-[380px] px-4 py-3">
                            <p className="font-medium text-foreground">
                              {localizedQuestion || question.question}
                            </p>
                            {missingTranslation ? (
                              <p className="mt-1 text-xs font-semibold text-amber-300">
                                Missing {localeLabels[selectedLocale]} translation
                              </p>
                            ) : null}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {truncate(question.currentPath, 72) ||
                                truncate(question.visitorId, 32) ||
                                String(question.sessionId).slice(-8)}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-foreground">{question.score}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="rounded-full">
                              {question.topic}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {question.propertySlug ?? "General"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDateTime(question.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <Dialog
        open={answerDialogOpen}
        onOpenChange={(isOpen) => {
          setAnswerDialogOpen(isOpen);
          if (!isOpen) {
            setEditingAnswer(null);
            setSourceUnknown(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {sourceUnknown ? "Create Answer From Unknown" : editingAnswer ? "Edit Answer" : "Add Answer"}
            </DialogTitle>
            <DialogDescription>
              Approved answers are the source of truth. Suggested questions still need approval.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitKnowledgeAnswer}>
            <div className="grid gap-2">
              <Label htmlFor="knowledge-title">Title</Label>
              <Input
                id="knowledge-title"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Smoking policy"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="knowledge-answer">Answer</Label>
              <textarea
                id="knowledge-answer"
                value={form.answer}
                maxLength={2000}
                onChange={(event) => setForm((current) => ({ ...current, answer: event.target.value }))}
                className="min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="knowledge-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, status: value as KnowledgeAnswerStatus }))
                  }
                >
                  <SelectTrigger id="knowledge-status" className="h-10 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["approved", "draft", "archived"] satisfies KnowledgeAnswerStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="knowledge-property">Property slug</Label>
                <Input
                  id="knowledge-property"
                  value={form.propertySlug}
                  disabled={Boolean(sourceUnknown)}
                  onChange={(event) => setForm((current) => ({ ...current, propertySlug: event.target.value }))}
                  placeholder="Leave blank for global"
                />
              </div>
            </div>
            {!editingAnswer ? (
              <div className="grid gap-2">
                <Label htmlFor="knowledge-primary-question">Primary question</Label>
                <textarea
                  id="knowledge-primary-question"
                  value={form.primaryQuestion}
                  maxLength={240}
                  disabled={Boolean(sourceUnknown)}
                  onChange={(event) => setForm((current) => ({ ...current, primaryQuestion: event.target.value }))}
                  className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </div>
            ) : null}
            {!editingAnswer && !sourceUnknown ? (
              <div className="grid gap-2">
                <Label htmlFor="knowledge-more-questions">Additional approved questions</Label>
                <textarea
                  id="knowledge-more-questions"
                  value={form.questions}
                  onChange={(event) => setForm((current) => ({ ...current, questions: event.target.value }))}
                  placeholder="One per line"
                  className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="knowledge-topics">Topics</Label>
              <Input
                id="knowledge-topics"
                value={form.topicNames}
                onChange={(event) => setForm((current) => ({ ...current, topicNames: event.target.value }))}
                placeholder="house_rules, check_in"
              />
            </div>
            {formError ? <p className="text-sm font-medium text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAnswerDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pendingAction === "save-answer"}>
                {pendingAction === "save-answer" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save answer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// Kept temporarily for reference while the new approved-knowledge admin view replaces it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyAdminQuestionsView({
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
  const [translationLocale, setTranslationLocale] = useState<Locale>("th");
  const [formError, setFormError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const curatedQuestions = useQuery(api.chatSuggestions.adminListCurated, {
    status: curatedStatus,
    limit: 100,
  }) as AdminCuratedQuestion[] | undefined;
  const createQuestion = useMutation(api.chatSuggestions.adminCreateCurated);
  const updateQuestion = useMutation(api.chatSuggestions.adminUpdateCurated);
  const translateQuestion = useAction(api.chatSuggestions.adminTranslateCuratedDraft);
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
    setTranslationLocale("th");
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(question: AdminCuratedQuestion) {
    setEditingQuestion(question);
    setForm(formForCuratedQuestion(question));
    setTranslationLocale("th");
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
    if (form.answerMode === "static" && !form.answer.trim()) {
      setFormError("Answer is required for static questions.");
      return;
    }

    setPendingAction("save");
    try {
      const payload = {
        question,
        answer: form.answerMode === "static" ? form.answer.trim() || undefined : undefined,
        answerTranslations: form.answerMode === "static" ? answerTranslationsFromForm(form) : {},
        answerMode: form.answerMode,
        dynamicIntent: form.answerMode === "dynamic" ? form.dynamicIntent : undefined,
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

  async function translateDraft(mode: "all" | "missing") {
    setFormError("");
    const question = form.question.trim();
    if (!question) {
      setFormError("Question is required before translating.");
      return;
    }

    const targetLocales = locales.filter((locale) => {
      if (locale === defaultLocale) return false;
      if (mode === "all") return true;
      const hasQuestion = Boolean(form.translations[locale]?.trim());
      const hasAnswer = form.answerMode !== "static" || Boolean(form.answerTranslations[locale]?.trim());
      return !hasQuestion || !hasAnswer;
    });
    if (targetLocales.length === 0) return;

    setPendingAction(`translate:${mode}`);
    try {
      const result = await translateQuestion({
        question,
        answer: form.answerMode === "static" ? form.answer.trim() || undefined : undefined,
        targetLocales,
      });
      const nextQuestionTranslations = result.questionTranslations ?? {};
      const nextAnswerTranslations = result.answerTranslations ?? {};
      setForm((current) => ({
        ...current,
        translations: {
          ...current.translations,
          ...Object.fromEntries(
            Object.entries(nextQuestionTranslations).filter(
              ([locale]) => mode === "all" || !current.translations[locale]?.trim(),
            ),
          ),
        },
        answerTranslations: {
          ...current.answerTranslations,
          ...Object.fromEntries(
            Object.entries(nextAnswerTranslations).filter(
              ([locale]) => mode === "all" || !current.answerTranslations[locale]?.trim(),
            ),
          ),
        },
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to translate question bank content.");
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
              Concierge question bank
            </div>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-foreground">
              Question Bank
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
                  {option === "bank" ? "Question bank" : "AI suggestions"}
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
                  <th className="px-4 py-3 font-semibold">Answer</th>
                  <th className="px-4 py-3 font-semibold">Mode</th>
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
                    <td className="max-w-[360px] px-4 py-3 text-muted-foreground">
                      {question.answerMode === "dynamic" || (!question.answerMode && !question.answer) ? (
                        <span>{question.dynamicIntent ?? "AI live data"}</span>
                      ) : (
                        truncate(getCuratedAnswerForLocale(question, selectedLocale), 120)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="rounded-full">
                        {answerModeLabel(question.answerMode, question.answer)}
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
                {generatedRows.map((question) => {
                  const localizedQuestion = getQuestionForLocale(question, selectedLocale);
                  const missingTranslation = isMissingSuggestionTranslation(question, selectedLocale);

                  return (
                    <tr key={question._id} className="border-b border-border last:border-b-0">
                      <td className="max-w-[360px] px-4 py-3">
                        <p className="font-medium text-foreground">
                          {localizedQuestion || question.question}
                        </p>
                        {missingTranslation ? (
                          <p className="mt-1 text-xs font-semibold text-amber-300">
                            Missing {localeLabels[selectedLocale]} translation
                          </p>
                        ) : null}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? "Edit Question Bank Item" : "Add Question Bank Item"}
            </DialogTitle>
            <DialogDescription>
              Static items answer from saved text. Dynamic items use live villa data.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitQuestion}>
            <div className="grid gap-2">
              <Label htmlFor="question-text">Question</Label>
              <textarea
                id="question-text"
                value={form.question}
                maxLength={160}
                onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                placeholder="Can I check availability for my dates?"
                className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>
            <div className="grid gap-2">
              <Label>Answer mode</Label>
              <div className="grid w-fit grid-cols-2 rounded-lg border border-border bg-background p-1">
                {(["static", "dynamic"] as const).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        answerMode: modeOption,
                      }))
                    }
                    className={cn(
                      "rounded-md px-4 py-2 text-xs font-semibold capitalize transition",
                      form.answerMode === modeOption
                        ? "bg-navy text-white shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {modeOption === "static" ? "Static answer" : "Dynamic answer"}
                  </button>
                ))}
              </div>
            </div>
            {form.answerMode === "static" ? (
              <div className="grid gap-2">
                <Label htmlFor="question-answer">Answer</Label>
                <textarea
                  id="question-answer"
                  value={form.answer}
                  maxLength={1200}
                  onChange={(event) => setForm((current) => ({ ...current, answer: event.target.value }))}
                  placeholder="Yes. This is a real villa listing managed by our concierge team..."
                  className="min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="dynamic-intent">Dynamic intent</Label>
                <Select
                  value={form.dynamicIntent}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      dynamicIntent: value as CuratedDynamicIntent,
                    }))
                  }
                >
                  <SelectTrigger id="dynamic-intent" className="h-10 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dynamicIntentOptions.map((intent) => (
                      <SelectItem key={intent} value={intent}>
                        {intent}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction.startsWith("translate")}
                onClick={() => void translateDraft("all")}
              >
                {pendingAction === "translate:all" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe2 className="h-4 w-4" />
                )}
                Translate all languages
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pendingAction.startsWith("translate")}
                onClick={() => void translateDraft("missing")}
              >
                {pendingAction === "translate:missing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Translate missing only
              </Button>
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 text-sm font-medium text-foreground">Translations</p>
                {locales
                  .filter((locale) => locale !== defaultLocale)
                  .map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      onClick={() => setTranslationLocale(locale)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
                        translationLocale === locale
                          ? "border-navy bg-navy text-white"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {localeLabels[locale]}
                    </button>
                  ))}
              </div>
              <div className="grid gap-3 rounded-lg border border-border bg-background/60 p-3">
                <div className="grid gap-2">
                  <Label htmlFor={`translation-${translationLocale}`}>
                    {localeLabels[translationLocale]} question
                  </Label>
                  <textarea
                    id={`translation-${translationLocale}`}
                    value={form.translations[translationLocale] ?? ""}
                    maxLength={160}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        translations: {
                          ...current.translations,
                          [translationLocale]: event.target.value,
                        },
                      }))
                    }
                    className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  />
                </div>
                {form.answerMode === "static" ? (
                  <div className="grid gap-2">
                    <Label htmlFor={`answer-translation-${translationLocale}`}>
                      {localeLabels[translationLocale]} answer
                    </Label>
                    <textarea
                      id={`answer-translation-${translationLocale}`}
                      value={form.answerTranslations[translationLocale] ?? ""}
                      maxLength={1200}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          answerTranslations: {
                            ...current.answerTranslations,
                            [translationLocale]: event.target.value,
                          },
                        }))
                      }
                      className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    />
                  </div>
                ) : null}
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
