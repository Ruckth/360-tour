// Real inbox components with local data only; no backend connection or writes.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Id } from "convex/_generated/dataModel";
import { AdminSessionActions } from "@/components/admin/AdminSessionActions";
import { AdminSessionDetail } from "@/components/admin/AdminSessionDetail";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { AdminSession } from "@/components/admin/admin-chat-types";
import "@/app.css";

const now = Date.UTC(2026, 10, 11, 8);
const closed = new URLSearchParams(location.search).has("closed");
const initialSession: AdminSession = {
  _id: "fixture-inbox" as Id<"chatSessions">,
  channel: "whatsapp",
  visitorName: "Returning guest with a longer name",
  propertyName: "Tideglass Pool Residence",
  createdAt: now - 86_400_000,
  isActive: false,
  adminStatus: "open",
  inboxState: "needs_staff",
  inboxReason: "send_failed",
  inboxSendError: "Message could not be delivered. Review before trying again.",
  aiPaused: true,
  keepWithStaff: true,
  staffTask: "Check the accessible room with housekeeping and update the guest before arrival.",
  latestGuestMessageId: "fixture-message" as Id<"chatMessages">,
};

function Fixture() {
  const [session, setSession] = useState(initialSession);
  const [draft, setDraft] = useState("An unsent reply is retained.");
  useEffect(() => {
    const update = (event: Event) => {
      const args: unknown = (event as CustomEvent<unknown>).detail;
      if (!args || typeof args !== "object") return;
      if ("task" in args && (typeof args.task === "string" || args.task === null)) {
        const staffTask = args.task ?? undefined;
        setSession(current => ({ ...current, staffTask }));
      }
    };
    window.addEventListener("fixture-mutation", update);
    return () => window.removeEventListener("fixture-mutation", update);
  }, []);
  return <ConfirmProvider>
    <div data-fixture-ready style={{ height: "100dvh", minHeight: 0 }}>
      <AdminSessionActions key={session._id} session={session} onDeleted={() => {}}>
        {({ actions, followUp, actionError }) => <AdminSessionDetail
          selectedSession={session}
          compact
          actions={actions}
          actionError={actionError}
          followUp={followUp}
          onBack={() => {}}
          canLoadOlderMessages={false}
          loadOlderMessages={() => {}}
          loadingTranscript={false}
          loadingOlderMessages={false}
          messages={[{ _id: "fixture-message" as Id<"chatMessages">, role: "user", content: "Can you confirm an accessible room?", timestamp: now - 60_000 }]}
          now={now}
          replyDraft={draft}
          onReplyDraftChange={setDraft}
          onSendReply={async () => {}}
          replyPending={false}
          replyError={closed ? "The last reply was not sent. Your draft is kept." : null}
          replyStatus={null}
          replyWindow={{ applies: true, closesAt: closed ? now - 1 : now + 3_600_000, lastGuestMessageAt: now - 60_000 }}
        />}
      </AdminSessionActions>
    </div>
  </ConfirmProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
