"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Shield,
  UserRound,
} from "lucide-react";
import { api } from "convex/_generated/api";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { cn } from "@/lib/utils";

type SessionStatus = "all" | "active" | "inactive";

type AdminMessage = {
  _id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type AdminSession = {
  _id: string;
  visitorId?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
  propertySlug?: string;
  propertyName?: string;
  currentPath?: string;
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

const statusOptions: SessionStatus[] = ["active", "all", "inactive"];

function visitorLabel(session?: AdminSession | null) {
  if (!session) return "Visitor";
  if (session.visitorName) return session.visitorName;
  if (session.visitorEmail) return session.visitorEmail;
  return `Visitor ${session.visitorId?.slice(0, 8) ?? session._id.slice(-6)}`;
}

function relativeTime(timestamp?: number) {
  if (!timestamp) return "Unknown";
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
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

export function AdminChatDashboard() {
  const convex = useOptionalConvex();
  const convexAuth = useOptionalConvexAuth();
  const { isLoaded, isSignedIn, user } = useUser();
  const [status, setStatus] = useState<SessionStatus>("active");
  const [propertySlug, setPropertySlug] = useState("");
  const [sessionsResult, setSessionsResult] = useState<SessionListResult | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const sessions = useMemo(() => sessionsResult?.sessions ?? [], [sessionsResult]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session._id === selectedSessionId) ?? transcript?.session ?? null,
    [selectedSessionId, sessions, transcript],
  );
  const canQueryAdmin =
    Boolean(convex && isSignedIn) &&
    (!convexAuth.isAuthEnabled || convexAuth.isAuthenticated);

  useEffect(() => {
    if (!convex || !canQueryAdmin) return;

    let active = true;
    setLoadingSessions(true);
    setError(null);

    convex
      .query(api.adminChat.listSessions, {
        status,
        propertySlug: propertySlug.trim() || undefined,
        limit: 30,
      } as never)
      .then((result) => {
        if (!active) return;
        const typed = result as SessionListResult;
        setSessionsResult(typed);
        setSelectedSessionId((current) => current ?? typed.sessions[0]?._id ?? null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load admin chat sessions.");
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [canQueryAdmin, convex, propertySlug, refreshKey, status]);

  useEffect(() => {
    if (!convex || !canQueryAdmin || !selectedSessionId) {
      setTranscript(null);
      return;
    }

    let active = true;
    setLoadingTranscript(true);

    convex
      .query(api.adminChat.getTranscript, { sessionId: selectedSessionId } as never)
      .then((result) => {
        if (active) setTranscript(result as TranscriptResult);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load transcript.");
      })
      .finally(() => {
        if (active) setLoadingTranscript(false);
      });

    return () => {
      active = false;
    };
  }, [canQueryAdmin, convex, refreshKey, selectedSessionId]);

  useEffect(() => {
    if (!isSignedIn) return;
    const interval = window.setInterval(() => setRefreshKey((key) => key + 1), 15_000);
    return () => window.clearInterval(interval);
  }, [isSignedIn]);

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
          <h1 className="font-serif text-4xl font-semibold text-foreground">Admin chat</h1>
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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              <MessageCircle className="h-4 w-4" />
              Concierge operations
            </div>
            <h1 className="mt-2 font-serif text-4xl font-semibold text-foreground">
              Admin chat monitor
            </h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{user.primaryEmailAddress?.emailAddress}</span>
            <UserButton />
          </div>
        </div>
      </header>

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
              <Button
                type="button"
                variant="outline"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="h-10 rounded-lg"
              >
                Refresh
              </Button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-255px)] overflow-y-auto">
            {loadingSessions && sessions.length === 0 ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sessions
              </div>
            ) : null}
            {error ? (
              <div className="m-3 border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {!loadingSessions && sessions.length === 0 && !error ? (
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
                    {relativeTime(session.lastSeenAt ?? session.createdAt)}
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

        <section className="min-h-[calc(100vh-132px)] border border-border bg-card">
          {!selectedSession ? (
            <div className="grid h-full min-h-[420px] place-items-center p-6 text-center text-muted-foreground">
              Select a visitor session to inspect the transcript.
            </div>
          ) : (
            <div className="grid h-full min-h-[calc(100vh-132px)] grid-rows-[auto_1fr]">
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
                      Last seen {relativeTime(selectedSession.lastSeenAt ?? selectedSession.createdAt)}
                    </p>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:min-w-[360px]">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-gold" />
                      {selectedSession.visitorEmail ?? "No email"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-gold" />
                      {selectedSession.visitorPhone ?? "No phone"}
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
                      This visitor opened chat but has not sent a message yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
