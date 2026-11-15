// The real Chats screen (ChatsView) on an in-memory inbox; no backend connection or writes.
import type { Id } from "convex/_generated/dataModel";
import { createRoot } from "react-dom/client";
import { ChatsView } from "@/components/admin/ChatsView";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AdminMessage, AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { registerFixtureFunctions } from "./convex-mock";
import { enableLiveNavigation } from "./next-navigation-mock";
import "@/app.css";

/*
 * Three guests wait in "Needs you" (newest first: Anna on the web, Somchai on LINE, Kenji on
 * WhatsApp) and Marta's Instagram chat is In progress with a follow-up. Every mutation the page
 * sends is appended to window.fixtureCalls as [name, args].
 */
enableLiveNavigation();
const now = Date.now();
const MIN = 60_000;
const calls: Array<[string, unknown]> = [];
(window as unknown as { fixtureCalls: typeof calls }).fixtureCalls = calls;

type Row = AdminSession & { messages: AdminMessage[] };
let messageSeq = 0;
function messages(...lines: Array<[AdminMessage["role"], string, number]>): AdminMessage[] {
  return lines.map(([role, content, minutesAgo]) => ({
    _id: `msg-${++messageSeq}` as Id<"messages">,
    role,
    content,
    timestamp: now - minutesAgo * MIN,
  }));
}
function row(session: Omit<AdminSession, "isActive" | "createdAt"> & { messages: AdminMessage[] }): Row {
  const latest = session.messages.at(-1);
  const latestGuest = session.messages.filter((message) => message.role === "user").at(-1);
  return {
    isActive: false,
    createdAt: now - 3 * 60 * MIN,
    adminStatus: "open",
    latestMessage: latest,
    latestMessageAt: latest?.timestamp,
    latestGuestMessageId: latestGuest?._id,
    messageCount: session.messages.length,
    ...session,
  };
}

const sessions: Row[] = [
  row({
    _id: "chat-anna" as Id<"conversations">,
    channel: "web",
    visitorName: "Anna Müller",
    visitorEmail: "anna.mueller@example.com",
    visitorPhone: "+49 151 2345 6789",
    visitorId: "visitor_8f2c41d0",
    propertyName: "Tideglass Pool Residence",
    propertySlug: "tideglass",
    currentPath: "/villas/tideglass",
    referrer: "https://www.google.com/",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15",
    timeZone: "Europe/Berlin",
    browserLanguage: "de-DE",
    viewportSize: "1440×900",
    screenSize: "2880×1800",
    platform: "MacIntel",
    lastSeenAt: now - 4 * MIN,
    needsReply: true,
    inboxState: "needs_staff",
    inboxReason: "staff_reply",
    messages: messages(
      ["user", "Is the pool heated in December?", 20],
      ["assistant", "Yes, the pool is heated all year to about 29 °C.", 19],
      ["user", "Perfect, thank you! That's all I needed.", 3],
    ),
  }),
  row({
    _id: "chat-somchai" as Id<"conversations">,
    channel: "line",
    visitorName: "Somchai P.",
    visitorContactApp: "line",
    visitorContactHandle: "@somchai.p",
    propertyName: "Garden Villa",
    needsReply: true,
    inboxState: "needs_staff",
    inboxReason: "handoff",
    messages: messages(["user", "Is breakfast included for four people?", 9]),
  }),
  row({
    _id: "chat-kenji" as Id<"conversations">,
    channel: "whatsapp",
    visitorName: "Kenji Watanabe",
    visitorPhone: "+81 90 1234 5678",
    propertyName: "Tideglass Pool Residence",
    needsReply: true,
    inboxState: "needs_staff",
    inboxReason: "staff_reply",
    messages: messages(["user", "Can we check in at 11 am on Friday?", 14]),
  }),
  row({
    _id: "chat-marta" as Id<"conversations">,
    channel: "instagram",
    visitorName: "Marta Silva",
    visitorContactApp: "instagram",
    visitorContactHandle: "@marta.travels",
    needsReply: false,
    inboxState: "processing",
    inboxReason: "follow_up",
    aiPaused: true,
    staffTask: "Confirm the airport pickup time with the driver.",
    messages: messages(["user", "Could someone pick us up at 6 pm?", 40], ["assistant", "Staff will confirm shortly.", 39]),
  }),
];

const byId = (id: string) => {
  const session = sessions.find((candidate) => candidate._id === id);
  if (!session) throw new Error("Session not found");
  return session;
};
function view(row: Row): AdminSession {
  const session: Partial<Row> = { ...row };
  delete session.messages;
  return session as AdminSession;
}

function finishWithoutReply(session: Row) {
  Object.assign(session, {
    needsReply: false,
    adminStatus: "resolved" satisfies AdminSessionStatus,
    inboxState: "done",
    inboxReason: "no_reply_needed",
    resolutionSource: "manual",
    resolvedAt: Date.now(),
    staffTask: undefined,
  });
}

function matches(session: Row, status: string, adminStatus: string) {
  const state = session.adminStatus ?? "open";
  if (adminStatus === "done") return state !== "open";
  if (state !== adminStatus) return false;
  if (status === "needs_reply") return session.needsReply === true;
  if (status === "in_progress") return session.inboxState === "processing";
  return true;
}

function record(name: string, args: unknown) {
  calls.push([name, args]);
  cache.clear();
}

// Real Convex hands back the same object until the data changes; ChatsView's effects rely on that.
const cache = new Map<string, unknown>();
function stable<A>(name: string, compute: (args: A) => unknown) {
  return (args: A) => {
    const key = `${name}:${JSON.stringify(args)}`;
    if (!cache.has(key)) cache.set(key, compute(args));
    return cache.get(key);
  };
}

registerFixtureFunctions({
  queries: {
    "messaging/adminChat:listSessions": stable("list", ({ status, adminStatus, searchQuery }: { status: string; adminStatus: string; searchQuery?: string }) => ({
      sessions: sessions
        .filter((session) => matches(session, status, adminStatus))
        .filter((session) => !searchQuery || (session.visitorName ?? "").toLowerCase().includes(searchQuery.toLowerCase()))
        .sort((a, b) => (b.latestMessageAt ?? 0) - (a.latestMessageAt ?? 0))
        .map(view),
      continueCursor: null,
      isDone: true,
    })),
    "messaging/adminChat:getSessionDetail": stable("detail", ({ sessionId }: { sessionId: string }) => {
      const session = byId(sessionId);
      return {
        session: view(session),
        replyWindow:
          session.channel === "web" || session.channel === "line"
            ? { applies: false }
            : { applies: true, lastGuestMessageAt: session.latestMessageAt, closesAt: now + 20 * 60 * MIN },
        lineEvents: [],
        facebookEvents: [],
        whatsappEvents: [],
        instagramEvents: [],
      };
    }),
    "messaging/adminChat:listTranscriptMessages": stable("transcript", ({ sessionId }: { sessionId: string }) => [...byId(sessionId).messages].reverse()),
  },
  mutations: {
    "messaging/adminChat:setSessionStatus": (args: { sessionId: string; status: AdminSessionStatus }) => {
      record("setSessionStatus", args);
      const session = byId(args.sessionId);
      if (args.status === "resolved") finishWithoutReply(session);
      else if (args.status === "archived") Object.assign(session, { adminStatus: "archived", inboxState: "done", needsReply: false });
      else Object.assign(session, { adminStatus: "open", inboxState: "processing", staffTask: session.staffTask ?? "Review conversation", resolutionSource: undefined });
      return null;
    },
    "messaging/adminChat:settleGuestMessage": (args: { sessionId: string; messageId: string }) => {
      record("settleGuestMessage", args);
      finishWithoutReply(byId(args.sessionId));
      return null;
    },
    "messaging/adminChat:setAiPaused": (args: { sessionId: string; paused: boolean }) => {
      record("setAiPaused", args);
      byId(args.sessionId).aiPaused = args.paused;
      return null;
    },
    "messaging/adminChat:setKeepWithStaff": (args: { sessionId: string; keep: boolean }) => {
      record("setKeepWithStaff", args);
      byId(args.sessionId).keepWithStaff = args.keep;
      return null;
    },
    "messaging/adminChat:setStaffTask": (args: { sessionId: string; task: string | null }) => {
      record("setStaffTask", args);
      byId(args.sessionId).staffTask = args.task ?? undefined;
      return null;
    },
    "messaging/adminChat:deleteArchivedSession": (args: { sessionId: string }) => {
      record("deleteArchivedSession", args);
      sessions.splice(sessions.indexOf(byId(args.sessionId)), 1);
      return null;
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    {/* The admin shell's sidebar provides this in the app. */}
    <TooltipProvider delayDuration={0}>
    <div data-fixture-ready className="flex flex-col bg-background" style={{ height: "100dvh" }}>
      <ChatsView />
    </div>
    </TooltipProvider>
  </ConfirmProvider>,
);
