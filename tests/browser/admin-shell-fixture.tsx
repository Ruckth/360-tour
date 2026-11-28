import type { Id } from "convex/_generated/dataModel";
import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";
import { IntlProvider } from "@/platform/intl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminSessionActions } from "@/components/admin/AdminSessionActions";
import { AdminSessionDetail } from "@/components/admin/AdminSessionDetail";
import { AdminFrame, AdminShell } from "@/components/admin/AdminShell";
import type { AdminSession } from "@/components/admin/admin-chat-types";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "./checkout-transport";
import en from "../../messages/en.json";
import { registerFixtureFunctions } from "./convex-mock";
import "@/app.css";

/*
 * The real admin frame (header, sidebar, rail, tab bar, approvals) around a page, on fixture data.
 * Query parameters:
 *   role=owner|manager|cashier   who is signed in (manager by default)
 *   path=/admin/chats            the page: Chats (a reply draft) or /admin/checkout (the till)
 *   pending=0|1|2                cashier requests waiting (1 by default): a 15% discount, then ฿100 off
 */
const params = new URLSearchParams(location.search);
const gate = params.get("gate");
const role = (["owner", "manager", "cashier"] as const).find((value) => value === params.get("role")) ?? "manager";
const path = params.get("path") ?? "/admin/chats";
const pending = Number(params.get("pending") ?? 1);
const EMAILS = { owner: "narin@auraliscove.co", manager: "ploy@auraliscove.co", cashier: "mint@auraliscove.co" } as const;

const operations = role !== "cashier";
const access: StaffAccessView = {
  email: EMAILS[role], role, pendingInvitation: null, companyScope: role === "owner", branches: [], marketingInvitation: null, marketingRole: null, cashierRules: DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: operations, operations, manageTeam: role === "owner", settings: role === "owner",
    bookings: operations, services: operations, customers: operations, orders: operations, chats: operations,
    properties: operations, roster: operations, reports: operations, marketing: role === "owner",
  },
};

if (gate) {
  const branches: StaffAccessView["branches"] = [
    { id: "fx-samui" as Id<"branches">, key: "samui", slug: "samui", name: "Koh Samui", state: "active" },
    { id: "fx-phuket" as Id<"branches">, key: "phuket", slug: "phuket", name: "Phuket" + "ReservationOffice".repeat(5), state: "setup" },
  ];
  const gateAccess: StaffAccessView = {
    ...access,
    email: "a".repeat(63) + "@example.com",
    role: gate === "choose" ? "manager" : null,
    branches: gate === "choose" ? branches : [],
    pendingInvitation: gate === "desk" ? {
      role: "cashier", expiresAt: Date.now() + 86_400_000, branchIds: [branches[1].id], branches: [branches[1]],
    } : null,
    marketingInvitation: gate === "marketing" ? { role: "marketer", expiresAt: Date.now() + 86_400_000 } : null,
    capabilities: gate === "choose" ? access.capabilities : Object.fromEntries(
      Object.keys(access.capabilities).map(key => [key, false]),
    ) as StaffAccessView["capabilities"],
  };
  registerFixtureFunctions({ queries: { "auth/staffAccess:myAccess": () => gateAccess } });
}

const backend = await createFixtureBackend({ staff: { role, email: EMAILS[role], rules: DEFAULT_CASHIER_RULES } });
const service = (n: number) => ({ kind: "service" as const, serviceId: `fxsvc${String(n).padStart(6, "0")}` as Id<"services"> });

async function seed(): Promise<OrderId | null> {
  if (role === "cashier") return (await backend.useActions().addItem({ item: service(1) })).orderId;
  const actions = backend.useActions();
  // A cashier's requests, as on a shared till: a 15% discount on a ฿1,200 massage, then ฿100 off a foot spa.
  const first = await actions.addItem({ item: service(1) });
  if (pending >= 1) await backend.seedApproval({ orderId: first.orderId, payload: { kind: "discount", lineId: first.lineId, discount: { type: "percent", value: 1500 } }, reason: "Guest waited 40 minutes", requesterEmail: EMAILS.cashier });
  if (pending >= 2) {
    const second = await actions.addItem({ item: service(7) });
    await backend.seedApproval({ orderId: second.orderId, payload: { kind: "discount", lineId: second.lineId, discount: { type: "amount", value: 10000 } }, reason: "Regular guest", requesterEmail: EMAILS.cashier });
  }
  return first.orderId;
}

const now = Date.UTC(2026, 10, 14, 8);
const session: AdminSession = {
  _id: "fixture-chat" as Id<"conversations">,
  channel: "whatsapp",
  visitorName: "Maya Lin",
  propertyName: "Tideglass Pool Residence",
  createdAt: now - 3_600_000,
  isActive: true,
  adminStatus: "open",
  inboxState: "needs_staff",
  aiPaused: true,
  keepWithStaff: true,
  latestGuestMessageId: "fixture-message" as Id<"messages">,
};

/** The chat detail with a reply being written: the draft must survive approving from the header. */
function ChatsPage() {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AdminSessionActions session={session} now={now} onDeleted={() => {}}>
        {({ actions, followUp, actionError }) => (
          <AdminSessionDetail
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
            messages={[{ _id: "fixture-message" as Id<"messages">, role: "user", content: "Can I book a foot spa tomorrow morning?", timestamp: now - 60_000 }]}
            now={now}
            replyDraft={draft}
            onReplyDraftChange={setDraft}
            onSendReply={async () => {}}
            replyPending={false}
            replyError={null}
            replyStatus={null}
            replyWindow={{ applies: true, closesAt: now + 3_600_000, lastGuestMessageAt: now - 60_000 }}
          />
        )}
      </AdminSessionActions>
    </div>
  );
}

function CheckoutPage({ initial }: { initial: OrderId | null }) {
  const [orderId, setOrderId] = useState(initial);
  return <CheckoutView orderId={orderId} onOrderChange={setOrderId} onPaid={() => {}} />;
}

async function main() {
  if (gate) {
    createRoot(document.getElementById("root")!).render(
      <IntlProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
        <AdminShell>Branch workspace</AdminShell>
      </IntlProvider>,
    );
    return;
  }
  const orderId = await seed();
  createRoot(document.getElementById("root")!).render(
    <IntlProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
      <StaffAccessProvider access={access}>
        <CheckoutBackendProvider backend={backend}>
          <div data-fixture-ready="" className="contents">
            <AdminFrame userEmail={EMAILS[role]} checkoutBackend={backend}>
              {path.startsWith("/admin/checkout") ? <CheckoutPage initial={orderId} /> : <ChatsPage />}
            </AdminFrame>
          </div>
        </CheckoutBackendProvider>
      </StaffAccessProvider>
    </IntlProvider>,
  );
}
void main();
