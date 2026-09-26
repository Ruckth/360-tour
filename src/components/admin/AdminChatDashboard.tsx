"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Filter,
  Globe2,
  HelpCircle,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  Shield,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Badge, RemovableBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import { ChatInput } from "@/components/ui/chat/chat-input";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
  ChatBubbleTimestamp,
} from "@/components/ui/chat/chat-bubble";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { adminChatVisitorLabel } from "@/components/admin/admin-chat-labels";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { AdminLeadsView } from "@/components/admin/AdminLeadsView";
import { AdminPropertiesView } from "@/components/admin/AdminPropertiesView";
import { ADMIN_VIEW_TITLES, AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminStaffBookingsView } from "@/components/admin/AdminStaffBookingsView";
import { adminRoute, adminViewPath } from "@/components/admin/admin-routes";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";
type EmptyChatFilter = "non_empty" | "empty";
type SessionChannelFilter = "all" | "web" | "line" | "facebook" | "whatsapp" | "instagram";

type AdminMessage = {
  _id: Id<"chatMessages">;
  role: "user" | "assistant";
  source?: "admin";
  content: string;
  timestamp: number;
};

export function chronologicalTranscriptMessages<T>(newestFirst: readonly T[]): T[] {
  return [...newestFirst].reverse();
}

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

type AdminFacebookEvent = {
  _id: Id<"facebookWebhookEvents">;
  eventType: "message" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow">;
  facebookReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

type AdminWhatsAppEvent = {
  _id: Id<"whatsappWebhookEvents">;
  eventType: "message" | "unsupported";
  messageText?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow" | "postback">;
  whatsappReplyStatus?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  processedAt?: number;
};

type AdminInstagramEvent = {
  _id: Id<"instagramWebhookEvents">;
  eventType: "message" | "postback" | "unsupported";
  messageText?: string;
  postbackData?: string;
  status: LineWebhookStatus;
  replyMode?: Exclude<LineReplyMode, "follow">;
  instagramReplyStatus?: number;
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
  visitorContactApp?: "whatsapp" | "line" | "facebook" | "instagram";
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
  channel: "web" | "whatsapp" | "line" | "facebook" | "instagram";
  createdAt: number;
  lastSeenAt?: number;
  lastOpenedAt?: number;
  lastClosedAt?: number;
  messageCount?: number;
  latestMessageAt?: number;
  adminSortAt?: number;
  isActive: boolean;
  latestMessage?: AdminMessage;
  needsReply?: boolean;
  latestLineEvent?: AdminLineEvent | null;
  latestFacebookEvent?: AdminFacebookEvent | null;
  latestWhatsAppEvent?: AdminWhatsAppEvent | null;
  latestInstagramEvent?: AdminInstagramEvent | null;
};

type SessionListResult = {
  sessions: AdminSession[];
  continueCursor: string | null;
  nextCursor?: string | null;
  isDone: boolean;
};

type SessionDetailResult = {
  session: AdminSession;
  lineEvents?: AdminLineEvent[];
  facebookEvents?: AdminFacebookEvent[];
  whatsappEvents?: AdminWhatsAppEvent[];
  instagramEvents?: AdminInstagramEvent[];
};

type TranscriptPaginationResult = {
  results: AdminMessage[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
};

type KnowledgeAnswerStatus = "draft" | "approved" | "archived";
type KnowledgeAnswerFilter = KnowledgeAnswerStatus | "all";
type UnknownQuestionStatus = "new" | "resolved" | "ignored";
type UnknownQuestionFilter = UnknownQuestionStatus | "all";
type KnowledgeViewMode = "answers" | "unknown";

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

type AdminKnowledgePropertyScope = {
  slug: string;
  normalizedSlug: string;
  label: string;
  source: "property" | "custom";
  propertyId?: Id<"properties">;
  canDelete?: boolean;
};

type AdminKnowledgeAnswer = {
  _id: Id<"chatAnswers">;
  propertyName?: string;
  propertySlug?: string;
  propertySlugs?: string[];
  propertyScopes?: AdminKnowledgePropertyScope[];
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
  questions: string[];
  additionalQuestionInput: string;
  topicNames: string;
  propertySlugs: string[];
};

const statusOptions: SessionStatus[] = ["active", "all", "inactive"];
const channelFilterOptions = ["all", "web", "line", "facebook", "whatsapp", "instagram"] satisfies SessionChannelFilter[];
const PRESENCE_CLOCK_MS = 10_000;
const timeHours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const timeMinutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function dateTimeValueFromParts(date: Date, hour: string, minute: string) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseDateTimeValue(value: string, defaultHour: string, defaultMinute: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return {
      date: undefined,
      hour: defaultHour,
      minute: defaultMinute,
    };
  }

  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const validDate =
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day);

  return {
    date: validDate ? date : undefined,
    hour: timeHours.includes(hour) ? hour : defaultHour,
    minute: timeMinutes.includes(minute) ? minute : defaultMinute,
  };
}

function visitorLabel(session?: AdminSession | null) {
  return adminChatVisitorLabel(session);
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

function channelLabel(channel: AdminSession["channel"] | SessionChannelFilter) {
  if (channel === "line") return "LINE";
  if (channel === "facebook") return "Facebook";
  if (channel === "web") return "Web";
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "instagram") return "Instagram";
  return "All";
}

function ChannelIcon({
  channel,
  className,
}: {
  channel: AdminSession["channel"] | Exclude<SessionChannelFilter, "all">;
  className?: string;
}) {
  if (channel === "line" || channel === "facebook" || channel === "whatsapp" || channel === "instagram") {
    return <ContactAppBrandIcon app={channel} className={className} />;
  }
  if (channel === "web") return <Globe2 className={cn("h-4 w-4", className)} aria-hidden="true" />;
  return <MessageCircle className={cn("h-4 w-4", className)} aria-hidden="true" />;
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

function AdminDateTimeFilterField({
  id,
  label,
  value,
  onChange,
  defaultHour,
  defaultMinute,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultHour: string;
  defaultMinute: string;
}) {
  const { date, hour, minute } = parseDateTimeValue(value, defaultHour, defaultMinute);
  const dateLabel = date
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : "Select date";

  function updateTime(nextHour: string, nextMinute: string) {
    if (!date) return;
    onChange(dateTimeValueFromParts(date, nextHour, nextMinute));
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              className={cn(
                "h-10 justify-start rounded-lg px-3 text-left text-sm",
                !date && "text-muted-foreground",
              )}
            >
              <CalendarDays className="h-4 w-4 text-gold" />
              <span className="min-w-0 truncate">{dateLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(selectedDate) => {
                if (!selectedDate) return;
                onChange(dateTimeValueFromParts(selectedDate, hour, minute));
              }}
            />
          </PopoverContent>
        </Popover>
        <Select value={hour} onValueChange={(nextHour) => updateTime(nextHour, minute)} disabled={!date}>
          <SelectTrigger className="h-10 rounded-lg" aria-label={`${label} hour`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeHours.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minute} onValueChange={(nextMinute) => updateTime(hour, nextMinute)} disabled={!date}>
          <SelectTrigger className="h-10 rounded-lg" aria-label={`${label} minute`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeMinutes.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function emptyFilterLabel(value: EmptyChatFilter) {
  if (value === "empty") return "Empty only";
  return "Not empty";
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const route = adminRoute(pathname);
  const view = route?.view ?? "chats";
  const staffTab = route?.staffTab ?? "calendar";
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
  const selectedSessionId = (view === "chats" ? searchParams.get("session") : null) as Id<"chatSessions"> | null;
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
    try {
      await settleGuestMessageMutation({ sessionId, messageId });
    } catch (error) {
      console.error("Unable to settle guest message", error);
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
    if (view !== "chats" || !isLargeViewport || selectedSessionId || !sessionsResult?.sessions.length) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("session", sessionsResult.sessions[0]._id);
    router.replace(`/admin/chats?${params}`, { scroll: false });
  }, [isLargeViewport, router, searchParams, selectedSessionId, sessionsResult, view]);

  useEffect(() => {
    resetSessionPaging();
  }, [filterResetKey, resetSessionPaging]);

  return (
    <SidebarProvider
      className={cn("bg-background", view === "chats" ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen")}
    >
      <AdminSidebar
        view={view}
        onViewChange={(nextView) => router.push(adminViewPath(nextView))}
        userEmail={userEmail}
      />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 sm:px-6">
          <SidebarTrigger className="-ml-1" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
              Concierge operations
            </p>
            <h1 className="truncate font-serif text-2xl font-semibold text-foreground">
              {ADMIN_VIEW_TITLES[view]}
            </h1>
          </div>
        </header>

      {view === "hotel" ? (
        <AdminBookingsView />
      ) : view === "staff" ? (
        <AdminStaffBookingsView tab={staffTab} />
      ) : view === "questions" ? (
        <AdminQuestionsView />
      ) : view === "properties" ? (
        <AdminPropertiesView />
      ) : view === "leads" ? (
        <AdminLeadsView />
      ) : (
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
      )}
      </SidebarInset>
    </SidebarProvider>
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

function normalizePropertySlugInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function KnowledgePropertyScopeSelector({
  disabled = false,
  onChange,
  onCreate,
  onDelete,
  pendingAction,
  scopes,
  selectedSlugs,
}: {
  disabled?: boolean;
  onChange: (slugs: string[]) => void;
  onCreate: (slug: string) => void;
  onDelete: (slug: string) => void;
  pendingAction: string;
  scopes: AdminKnowledgePropertyScope[];
  selectedSlugs: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizePropertySlugInput(query);
  const scopeBySlug = new Map(scopes.map((scope) => [scope.slug, scope]));
  const selectedScopes = selectedSlugs.map(
    (slug) =>
      scopeBySlug.get(slug) ?? {
        slug,
        normalizedSlug: normalizePropertySlugInput(slug),
        label: slug,
        source: "custom" as const,
        canDelete: true,
      },
  );
  const filteredScopes = scopes.filter((scope) => {
    const haystack = `${scope.slug} ${scope.label}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  });
  const canCreate =
    Boolean(normalizedQuery) &&
    !scopes.some((scope) => scope.normalizedSlug === normalizedQuery || scope.slug === normalizedQuery);

  function toggleSlug(slug: string) {
    onChange(
      selectedSlugs.includes(slug)
        ? selectedSlugs.filter((item) => item !== slug)
        : [...selectedSlugs, slug],
    );
  }

  function createScope() {
    if (!canCreate) return;
    onCreate(normalizedQuery);
    setQuery("");
  }

  return (
    <div className={cn("rounded-lg border border-input bg-background p-2", disabled && "opacity-60")}>
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selectedScopes.length === 0 ? (
          <Badge variant="secondary" className="rounded-full">
            All properties
          </Badge>
        ) : (
          selectedScopes.map((scope) => (
            <RemovableBadge
              key={scope.slug}
              removeLabel={`Remove ${scope.label}`}
              disabled={disabled}
              onRemove={() => toggleSlug(scope.slug)}
            >
              {scope.label}
            </RemovableBadge>
          ))
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} className="ml-auto">
              <Plus className="h-4 w-4" />
              Properties
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-3">
            <div className="space-y-3">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createScope();
                  }
                }}
                placeholder="Search or add a slug"
              />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted",
                    selectedSlugs.length === 0 && "bg-muted text-foreground",
                  )}
                  onClick={() => onChange([])}
                >
                  <span>All properties</span>
                  {selectedSlugs.length === 0 ? <span className="text-xs text-gold">Selected</span> : null}
                </button>
                {filteredScopes.map((scope) => {
                  const selected = selectedSlugs.includes(scope.slug);
                  const deleting = pendingAction === `delete-property-scope:${scope.slug}`;
                  return (
                    <div key={scope.slug} className="flex items-center gap-1 rounded-lg hover:bg-muted">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                        onClick={() => toggleSlug(scope.slug)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{scope.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{scope.slug}</span>
                        </span>
                        {selected ? <span className="text-xs text-gold">Selected</span> : null}
                      </button>
                      {scope.source === "custom" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!scope.canDelete || deleting}
                          aria-label={`Delete ${scope.label}`}
                          title={
                            scope.canDelete
                              ? `Delete ${scope.label}`
                              : "Cannot delete while linked to an answer"
                          }
                          onClick={() => onDelete(scope.slug)}
                          className="mr-1 h-8 w-8"
                        >
                          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {filteredScopes.length === 0 && !canCreate ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">No properties found</div>
                ) : null}
              </div>
              {canCreate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pendingAction === "create-property-scope"}
                  onClick={createScope}
                >
                  {pendingAction === "create-property-scope" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add {normalizedQuery}
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function AdminQuestionsView() {
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
  const propertyScopes = useQuery(
    api.chatKnowledge.adminListPropertyScopes,
    mode === "answers" || answerDialogOpen ? {} : "skip",
  ) as AdminKnowledgePropertyScope[] | undefined;
  const createAnswer = useMutation(api.chatKnowledge.adminCreateAnswer);
  const updateAnswer = useMutation(api.chatKnowledge.adminUpdateAnswer);
  const approveQuestion = useMutation(api.chatKnowledge.adminApproveQuestion);
  const rejectQuestion = useMutation(api.chatKnowledge.adminRejectQuestion);
  const ignoreUnknown = useMutation(api.chatKnowledge.adminIgnoreUnknown);
  const createPropertyScope = useMutation(api.chatKnowledge.adminCreatePropertyScope);
  const deletePropertyScope = useMutation(api.chatKnowledge.adminDeletePropertyScope);
  const createAnswerFromUnknown = useAction(api.chatKnowledge.adminCreateAnswerFromUnknown);
  const resolveUnknownWithAnswer = useAction(api.chatKnowledge.adminResolveUnknownWithAnswer);
  const generateSimilarQuestions = useAction(api.chatKnowledge.adminGenerateSimilarQuestions);
  const answerRows = answers ?? [];
  const unknownRows = unknownQuestions ?? [];
  const linkableAnswersLoading = mode === "unknown" && answers === undefined;
  const hasLinkableAnswers = answerRows.length > 0;

  function emptyKnowledgeForm(): AnswerKnowledgeForm {
    return {
      title: "",
      answer: "",
      status: "approved",
      primaryQuestion: "",
      questions: [],
      additionalQuestionInput: "",
      topicNames: "",
      propertySlugs: [],
    };
  }

  function formForKnowledgeAnswer(answer: AdminKnowledgeAnswer): AnswerKnowledgeForm {
    const approvedQuestions = answer.questions.filter((question) => question.status === "approved");
    const primaryQuestion =
      approvedQuestions.find((question) => question.isPrimary) ??
      approvedQuestions[0] ??
      null;
    return {
      title: answer.title,
      answer: answer.answer,
      status: answer.status,
      primaryQuestion: primaryQuestion?.questionText ?? "",
      questions: approvedQuestions
        .filter((question) => question._id !== primaryQuestion?._id)
        .map((question) => question.questionText),
      additionalQuestionInput: "",
      topicNames: answer.topics.map((topic) => topic.name).join(", "),
      propertySlugs:
        answer.propertySlugs ??
        answer.propertyScopes?.map((scope) => scope.slug) ??
        (answer.propertySlug ? [answer.propertySlug] : []),
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
      propertySlugs: question.propertySlug ? [question.propertySlug] : [],
    });
    setFormError("");
    setAnswerDialogOpen(true);
  }

  function addAdditionalQuestion() {
    const question = form.additionalQuestionInput.trim();
    if (!question) return;
    const normalizedQuestion = question.toLowerCase().replace(/\s+/g, " ");
    const existingQuestions = [form.primaryQuestion, ...form.questions].map((item) =>
      item.trim().toLowerCase().replace(/\s+/g, " "),
    );
    if (existingQuestions.includes(normalizedQuestion)) {
      setForm((current) => ({ ...current, additionalQuestionInput: "" }));
      return;
    }
    setForm((current) => ({
      ...current,
      questions: [...current.questions, question],
      additionalQuestionInput: "",
    }));
  }

  function removeAdditionalQuestion(question: string) {
    setForm((current) => ({
      ...current,
      questions: current.questions.filter((item) => item !== question),
    }));
  }

  async function createKnowledgePropertyScope(slug: string) {
    setPendingAction("create-property-scope");
    setFormError("");
    try {
      const scope = (await createPropertyScope({ slug })) as AdminKnowledgePropertyScope;
      setForm((current) => ({
        ...current,
        propertySlugs: current.propertySlugs.includes(scope.slug)
          ? current.propertySlugs
          : [...current.propertySlugs, scope.slug],
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to add property.");
    } finally {
      setPendingAction("");
    }
  }

  async function deleteKnowledgePropertyScope(slug: string) {
    setPendingAction(`delete-property-scope:${slug}`);
    setFormError("");
    try {
      await deletePropertyScope({ slug });
      setForm((current) => ({
        ...current,
        propertySlugs: current.propertySlugs.filter((item) => item !== slug),
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to delete property.");
    } finally {
      setPendingAction("");
    }
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
    if (!sourceUnknown && !form.primaryQuestion.trim()) {
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
          propertySlugs: form.propertySlugs,
          primaryQuestion: form.primaryQuestion.trim(),
          questions: form.questions,
        });
      } else {
        await createAnswer({
          title,
          answer,
          status: form.status,
          primaryQuestion: form.primaryQuestion.trim(),
          questions: form.questions,
          topicNames,
          propertySlugs: form.propertySlugs,
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

  function answerStatusTone(status: KnowledgeAnswerStatus) {
    if (status === "approved") return "bg-emerald-600 text-white";
    if (status === "archived") return "bg-muted text-foreground";
    return "bg-amber-600 text-white";
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
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
            <ToggleGroup value={mode} onValueChange={setMode} aria-label="Knowledge view" className="mt-4 w-fit">
              {(["answers", "unknown"] satisfies KnowledgeViewMode[]).map((option) => (
                <ToggleGroupItem key={option} value={option} className="px-4 capitalize">
                  {option}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
                            {answer.propertyScopes && answer.propertyScopes.length > 0 ? (
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {answer.propertyScopes.slice(0, 3).map((scope) => (
                                  <Badge key={scope.slug} variant="secondary" className="rounded-full">
                                    {scope.label}
                                  </Badge>
                                ))}
                                {answer.propertyScopes.length > 3 ? (
                                  <span className="text-xs">+{answer.propertyScopes.length - 3} more</span>
                                ) : null}
                              </div>
                            ) : (
                              "Global"
                            )}
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
                                disabled={linkableAnswersLoading || !hasLinkableAnswers}
                                onValueChange={(value) =>
                                  setLinkAnswerIds((current) => ({
                                    ...current,
                                    [question._id]: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 min-w-[180px] rounded-lg" aria-label="Link answer">
                                  <SelectValue
                                    placeholder={
                                      linkableAnswersLoading
                                        ? "Loading answers"
                                        : hasLinkableAnswers
                                          ? "Select answer"
                                          : "No approved answers"
                                    }
                                  />
                                </SelectTrigger>
                                {hasLinkableAnswers ? (
                                  <SelectContent>
                                    {answerRows.map((answer) => (
                                      <SelectItem key={answer._id} value={answer._id}>
                                        {answer.title}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                ) : null}
                              </Select>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={
                                  !hasLinkableAnswers ||
                                  !linkAnswerIds[question._id] ||
                                  pendingAction === `link:${question._id}`
                                }
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
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
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
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Properties</Label>
                <KnowledgePropertyScopeSelector
                  scopes={propertyScopes ?? []}
                  selectedSlugs={form.propertySlugs}
                  disabled={Boolean(sourceUnknown)}
                  pendingAction={pendingAction}
                  onChange={(propertySlugs) => setForm((current) => ({ ...current, propertySlugs }))}
                  onCreate={(slug) => void createKnowledgePropertyScope(slug)}
                  onDelete={(slug) => void deleteKnowledgePropertyScope(slug)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="knowledge-primary-question">Primary question</Label>
              <Input
                id="knowledge-primary-question"
                value={form.primaryQuestion}
                maxLength={240}
                disabled={Boolean(sourceUnknown)}
                onChange={(event) => setForm((current) => ({ ...current, primaryQuestion: event.target.value }))}
                placeholder="Who is the creator of this website?"
              />
            </div>
            {!sourceUnknown ? (
              <div className="grid gap-2">
                <Label htmlFor="knowledge-more-questions">Additional approved questions</Label>
                <div className="flex gap-2">
                  <Input
                    id="knowledge-more-questions"
                    value={form.additionalQuestionInput}
                    maxLength={240}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, additionalQuestionInput: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addAdditionalQuestion();
                      }
                    }}
                    placeholder="Add another way guests ask this"
                  />
                  <Button type="button" variant="secondary" size="icon" onClick={addAdditionalQuestion}>
                    <Plus className="h-4 w-4" />
                    <span className="sr-only">Add question</span>
                  </Button>
                </div>
                {form.questions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {form.questions.map((question) => (
                      <RemovableBadge
                        key={question}
                        removeLabel={`Remove ${question}`}
                        onRemove={() => removeAdditionalQuestion(question)}
                      >
                        {question}
                      </RemovableBadge>
                    ))}
                  </div>
                ) : null}
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
    </div>
  );
}
