import { percentToBasisPoints } from "convex/shared/money";
import type { Id } from "convex/_generated/dataModel";
import { mergeSiteSettings } from "convex/shared/siteSettings";
import { DEFAULT_CASHIER_RULES, type CashierRules } from "convex/shared/staffTypes";
import { ConvexError } from "convex/values";
import { IntlProvider } from "@/platform/intl";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AdminRail, AdminTabBar } from "@/components/admin/AdminNav";
import { AdminSettingsView } from "@/components/admin/AdminSettingsView";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "./checkout-transport";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import en from "../../messages/en.json";
import { notifyFixtureStore, registerFixtureFunctions } from "./convex-mock";
import "@/app.css";

/*
 * Staff roles on fixture data: the checkout as a cashier or manager, Settings › Team, and the
 * admin navigation for each role. Query parameters:
 *   role=owner|manager|cashier   who is signed in (owner by default)
 *   view=checkout|settings|nav   checkout (default), Settings (tab=team for Team), or the navigation
 *   path=/admin/...              the route the navigation highlights
 *   scenario=spa                 checkout: a ฿1,200 Thai massage on a new order
 *   scenario=pending             checkout for a manager: two cashier requests waiting
 *   scenario=discounted          checkout: the spa line already carries a 15% discount (as after approval)
 *   scenario=paid                checkout: the spa order paid by cash, on its receipt
 *   scenario=refund              checkout: Thai massage 60 + Foot spa 45 (฿1,800) paid by card, on its receipt
 *   scenario=refund-pending      the same, with a cashier's ฿300 refund request on the massage waiting
 *   attached=1                   refund scenarios: also Somchai's attached Thai massage 90 appointment
 *   refund=cashier               the cashier rule for refunds (Manager approves by default)
 *   limit=N                      the cashier discount limit (10 by default)
 *   serverLimit=N                the limit the fixture server enforces, when it differs from the UI's
 *   stale=1                      Team: someone else saves the cashier rules first
 *   theme=dark                   dark app theme
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const role = (["owner", "manager", "cashier"] as const).find((value) => value === params.get("role")) ?? "owner";
const view = params.get("view") ?? "checkout";
const scenario = params.get("scenario") ?? "";
const EMAILS = { owner: "narin@auraliscove.co", manager: "ploy@auraliscove.co", cashier: "mint@auraliscove.co" } as const;
const rules: CashierRules = {
  ...DEFAULT_CASHIER_RULES,
  discountLimitPercent: params.has("limit") ? Number(params.get("limit")) * 100 : DEFAULT_CASHIER_RULES.discountLimitPercent,
  refund: params.get("refund") === "cashier" ? "cashier" : "manager",
};

const SAMUI_ID = "fxbranch-samui" as Id<"branches">;
const PHUKET_ID = "fxbranch-phuket" as Id<"branches">;
const SAMUI = { id: SAMUI_ID, key: "koh-samui", name: "Koh Samui", slug: "koh-samui", state: "active" as const };
const PHUKET = { id: PHUKET_ID, key: "phuket", name: "Phuket", slug: "phuket", state: "setup" as const };

function accessFor(who: typeof role): StaffAccessView {
  const operations = who !== "cashier";
  return {
    // Owners open every branch; desk roles hold Koh Samui, as the seed assigns them.
    email: EMAILS[who], role: who, pendingInvitation: null, companyScope: who === "owner", branches: who === "owner" ? [SAMUI, PHUKET] : [SAMUI], marketingInvitation: null, marketingRole: null, cashierRules: rules,
    capabilities: {
      checkout: true, approve: operations, operations, manageTeam: who === "owner", settings: who === "owner",
      bookings: operations, services: operations, customers: operations, orders: operations, chats: operations,
      properties: operations, roster: operations, reports: operations, marketing: who === "owner",
    },
  };
}
/** Who is signed in now: a spec can hand the till to another person (window.fixture.setRole). */
let access = accessFor(role);
const accessListeners = new Set<() => void>();
const useAccess = () => useSyncExternalStore((fn) => { accessListeners.add(fn); return () => accessListeners.delete(fn); }, () => access);

// ---------- Checkout ----------

const serverRules = params.has("serverLimit") ? { ...rules, discountLimitPercent: Number(params.get("serverLimit")) * 100 } : rules;
// Refund receipts are rung up by the owner, then handed to whoever the page is for.
const refundScenario = scenario.startsWith("refund");
const backend = await createFixtureBackend({ staff: refundScenario ? { role: "owner", email: EMAILS.owner, rules: serverRules } : { role, email: EMAILS[role], rules: serverRules } });
const service = (n: number) => ({ kind: "service" as const, serviceId: `fxsvc${String(n).padStart(6, "0")}` as Id<"services"> });
let spaLineId: Id<"orderLines"> | undefined;
let spaOrderId: OrderId | undefined;

async function seedCheckout(): Promise<{ orderId: OrderId | null; receipt: boolean }> {
  const actions = backend.useActions();
  if (scenario === "spa" || scenario === "paid") {
    const { orderId, lineId } = await actions.addItem({ item: service(1) });
    spaLineId = lineId;
    spaOrderId = orderId;
    if (scenario === "paid") {
      await actions.settleOrder({ orderId, expectedRevision: 1, expectedDue: 120000, idempotencyKey: "browser-staff-paid", tenders: [{ method: "cash", amount: 120000 }] });
      return { orderId, receipt: true };
    }
    return { orderId, receipt: false };
  }
  if (refundScenario) {
    const massage = await actions.addItem({ item: service(1) });
    await actions.addItem({ orderId: massage.orderId, item: service(7) });
    let due = 180000;
    if (params.get("attached") === "1") {
      await actions.attach({ orderId: massage.orderId, appointmentId: "fxappt000002" as Id<"appointments"> });
      due += 160000;
    }
    await actions.settleOrder({ orderId: massage.orderId, expectedRevision: params.get("attached") === "1" ? 3 : 2, expectedDue: due, idempotencyKey: "browser-refund-paid", tenders: [{ method: "card", amount: due }] });
    if (scenario === "refund-pending") {
      await backend.setStaff({ role: "cashier", email: EMAILS.cashier, rules: serverRules });
      await backend.seedApproval({
        orderId: massage.orderId, requesterEmail: EMAILS.cashier, reason: "Shortened treatment",
        payload: { kind: "refund", lineId: massage.lineId, amountSatang: 30000, currency: "THB", method: "card", idempotencyKey: "browser-refund-request", reason: "Shortened treatment" },
      });
    }
    await backend.setStaff({ role, email: EMAILS[role], rules: serverRules });
    return { orderId: massage.orderId, receipt: true };
  }
  if (scenario === "discounted") {
    // Set as a manager-approved discount would leave it (use serverLimit=100 so the fixture accepts it).
    const { orderId, lineId } = await actions.addItem({ item: service(1) });
    await actions.updateLine({ lineId, discount: { type: "percent", value: 1500 } });
    return { orderId, receipt: false };
  }
  if (scenario === "pending") {
    // Two cashier requests on two orders: a 15% discount on a ฿1,200 massage, ฿100 off a foot spa.
    const first = await actions.addItem({ item: service(1) });
    await backend.seedApproval({ orderId: first.orderId, payload: { kind: "discount", lineId: first.lineId, discount: { type: "percent", value: 1500 } }, reason: "Guest waited 40 minutes", requesterEmail: EMAILS.cashier });
    const second = await actions.addItem({ item: service(7) });
    await backend.seedApproval({ orderId: second.orderId, payload: { kind: "discount", lineId: second.lineId, discount: { type: "amount", value: 10000 } }, reason: "Regular guest", requesterEmail: EMAILS.cashier });
    return { orderId: first.orderId, receipt: false };
  }
  return { orderId: null, receipt: false };
}

function CheckoutHarness({ initial }: { initial: { orderId: OrderId | null; receipt: boolean } }) {
  const current = useAccess();
  const [orderId, setOrderId] = useState(initial.orderId);
  const [receiptId, setReceiptId] = useState<OrderId | null>(initial.receipt ? initial.orderId : null);
  return (
    <StaffAccessProvider access={current}>
    <CheckoutBackendProvider backend={backend}>
      <div className="flex h-dvh flex-col bg-background text-foreground" data-fixture-ready="" data-role={current.role ?? ""}>
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 sm:px-6">
          <h1 className="min-w-0 flex-1 truncate font-serif text-2xl font-semibold tracking-tight text-foreground">Checkout</h1>
          <CheckoutStaffControls />
        </header>
        {receiptId ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <ReceiptView orderId={receiptId} onNewSale={() => { setReceiptId(null); setOrderId(null); }} onOpenOrder={(id) => { setReceiptId(null); setOrderId(id); }} />
          </div>
        ) : (
          <CheckoutView orderId={orderId} onOrderChange={setOrderId} onPaid={setReceiptId} />
        )}
      </div>
    </CheckoutBackendProvider>
    </StaffAccessProvider>
  );
}

/** Fixture-only controls for specs: a second person on the same till, refund attempts, a lost answer. */
declare global {
  interface Window {
    fixture: {
      setRole: (next: typeof role) => Promise<void>;
      refundAttempts: () => ReturnType<typeof backend.refundAttempts>;
      recordedRefunds: () => ReturnType<typeof backend.recordedRefunds>;
      loseNextRefundResponse: () => void;
      lineId: (name: string) => string | undefined;
      refundFromAnotherTill: (lineName: string, satang: number) => Promise<void>;
      holdNextPayment: () => void;
      finishPayment: (loseAnswer?: boolean) => void;
      paymentAttempts: () => string[];
      holdNextDiscountWrite: () => void;
      finishDiscountWrite: (fail?: boolean) => void;
      discountFromAnotherTill: (value: number) => Promise<unknown>;
      requestFromAnotherTill: () => Promise<unknown>;
    };
  }
}
// Hold a blur write across the following tap, independently of browser/machine speed.
const fixtureActions = backend.useActions();
const updateLine = fixtureActions.updateLine;
let holdDiscount = false;
let finishDiscount: ((fail?: boolean) => void) | undefined;
fixtureActions.updateLine = async (args) => {
  if (holdDiscount && args.discount !== undefined) {
    holdDiscount = false;
    await new Promise<void>((resolve, reject) => {
      finishDiscount = (fail) => { finishDiscount = undefined; if (fail) reject(new Error("Discount write failed")); else resolve(); };
    });
  }
  return updateLine(args);
};
const settleOrder = fixtureActions.settleOrder;
let holdPayment = false;
let finishPayment: ((loseAnswer?: boolean) => void) | undefined;
const paymentAttempts: string[] = [];
fixtureActions.settleOrder = async (args) => {
  paymentAttempts.push(args.idempotencyKey);
  if (holdPayment) {
    holdPayment = false;
    await new Promise<void>((resolve, reject) => {
      finishPayment = (loseAnswer) => {
        finishPayment = undefined;
        if (loseAnswer) reject(new Error("Payment answer lost"));
        else resolve();
      };
    });
  }
  return settleOrder(args);
};
window.fixture = {
  setRole: async (next) => {
    await backend.setStaff({ role: next, email: EMAILS[next], rules: serverRules });
    access = accessFor(next);
    accessListeners.forEach((fn) => fn());
  },
  refundAttempts: () => backend.refundAttempts(),
  recordedRefunds: () => backend.recordedRefunds(),
  loseNextRefundResponse: () => backend.loseNextRefundResponse(),
  lineId: (name) => document.querySelector<HTMLElement>(`[data-refund-trigger][aria-label="Refund ${name}"]`)?.dataset.refundTrigger,
  refundFromAnotherTill: (lineName, satang) => backend.refundFromAnotherTill(lineName, satang),
  holdNextPayment: () => { holdPayment = true; },
  finishPayment: (loseAnswer) => { if (!finishPayment) throw new Error("No payment is waiting"); finishPayment(loseAnswer); },
  paymentAttempts: () => paymentAttempts,
  holdNextDiscountWrite: () => { holdDiscount = true; },
  finishDiscountWrite: (fail) => { if (!finishDiscount) throw new Error("No discount write is waiting"); finishDiscount(fail); },
  discountFromAnotherTill: (value) => {
    if (!spaLineId) throw new Error("No seeded spa line");
    return updateLine({ lineId: spaLineId, discount: { type: "percent", value: percentToBasisPoints(value) } });
  },
  requestFromAnotherTill: () => {
    if (!spaLineId || !spaOrderId) throw new Error("No seeded spa line");
    return backend.seedApproval({ orderId: spaOrderId, requesterEmail: EMAILS.cashier, reason: "Other till request", payload: { kind: "discount", lineId: spaLineId, discount: { type: "percent", value: 1500 } } });
  },
};

// ---------- Settings › Team ----------

type Grant = { id: string; revision: number; role: "manager" | "cashier"; claimed: boolean; expiresAt: number | null; expired: boolean; updatedAt: number };
type MarketingGrant = { id: string; role: "manager" | "marketer" | "finance" | "viewer"; claimed: boolean; expiresAt: number | null; expired: boolean; updatedAt: number };
type Person = { email: string; role: "owner" | "manager" | "cashier" | null; branchIds: Id<"branches">[]; staffGrant: Grant | null; marketingGrant: MarketingGrant | null };
const DAY = 86_400_000;
const now = Date.now();
const team = {
  people: [
    { email: "lek@auraliscove.co", role: "cashier", branchIds: [SAMUI_ID], staffGrant: { id: "grant-lek", revision: 1, role: "cashier", claimed: false, expiresAt: now + 12 * DAY, expired: false, updatedAt: now }, marketingGrant: null },
    { email: "mint@auraliscove.co", role: "cashier", branchIds: [SAMUI_ID], staffGrant: { id: "grant-mint", revision: 1, role: "cashier", claimed: true, expiresAt: null, expired: false, updatedAt: now }, marketingGrant: null },
    { email: "narin@auraliscove.co", role: "owner", branchIds: [], staffGrant: null, marketingGrant: null },
    { email: "ploy@auraliscove.co", role: "manager", branchIds: [SAMUI_ID], staffGrant: { id: "grant-ploy", revision: 1, role: "manager", claimed: true, expiresAt: null, expired: false, updatedAt: now }, marketingGrant: { id: "mkt-ploy", role: "viewer", claimed: true, expiresAt: null, expired: false, updatedAt: now } },
    { email: "sun@auraliscove.co", role: null, branchIds: [], staffGrant: null, marketingGrant: { id: "mkt-sun", role: "marketer", claimed: true, expiresAt: null, expired: false, updatedAt: now } },
  ] as Person[],
  rules: { ...rules },
  staleOnce: params.get("stale") === "1",
};
if (params.get("teamInvite") === "expired") {
  const grant = team.people[0].staffGrant!;
  grant.expired = true;
  grant.expiresAt = now - DAY;
}
registerFixtureFunctions({
  queries: {
    "auth/staffAccess:listPeople": () => team.people,
    "branches/branches:list": () => [SAMUI, PHUKET].map((branch, index) => ({
      _id: branch.id, _creationTime: now + index, key: branch.key, name: branch.name, slug: branch.slug, state: branch.state,
      issuer: { legalName: "Auralis Cove Co., Ltd.", taxId: "0105560000000", branchCode: `0000${index}`, address: branch.name },
      stateChangedAt: now, stateChangedByEmail: "system:seed", revision: 1, createdAt: now + index, updatedAt: now,
    })),
    "settings/cashierRules:getCashierRules": () => team.rules,
    "settings/settings:get": () => ({ ...mergeSiteSettings(null), revision: 0 }),
    "settings/settings:setupChecklist": () => undefined,
    "settings/settings:channelHealth": () => ({
      channels: (["line", "whatsapp", "facebook", "instagram"] as const).map((channel, index) => ({ channel, lastEventAt: params.get("channelHealth") === "states" && index === 3 ? null : now - (index + 1) * 3_600_000, lastRepliedAt: now - (index + 1) * 3_500_000, failed24h: params.get("channelHealth") === "states" && index === 2 ? 1 : 0, failed7d: index === 1 ? 2 : params.get("channelHealth") === "states" && index === 2 ? 1 : 0, failedCapped: false, latestError: null })),
      ical: [
        { _id: "ical-1", propertyName: "Tideglass Pool Residence", platform: "airbnb", lastSyncedAt: now - 1_800_000, lastSyncError: null },
        { _id: "ical-2", propertyName: "Sea Fern Villa", platform: "booking", lastSyncedAt: null, lastSyncError: "Calendar link returned 404" },
      ],
    }),
    "settings/settings:serverConfig": () => ({ RESEND_API_KEY: true, OPENAI_API_KEY: true, STRIPE_SECRET_KEY: false, LINE_CHANNEL_SECRET: true }),
  },
  mutations: {
    "auth/staffAccess:setGrant": ({ email, role: next, branchIds, expectedGrant }: { expectedGrant: Pick<Grant, "id" | "revision"> | null; email: string; role: "manager" | "cashier" | null; branchIds: Id<"branches">[] }) => {
      const current = team.people.find((person) => person.email === email);
      if (current?.staffGrant?.id !== expectedGrant?.id || current?.staffGrant?.revision !== expectedGrant?.revision) {
        throw new ConvexError("Desk access changed. Review the current role and branches before trying again.");
      }
      if (next === null) {
        team.people = team.people.filter((person) => person.email !== email || person.marketingGrant).map((person) => (person.email === email ? { ...person, role: null, branchIds: [], staffGrant: null } : person));
        return null;
      }
      // As the server: a desk role needs at least one known, unarchived branch.
      if (!branchIds.length || branchIds.some((id) => id !== SAMUI_ID && id !== PHUKET_ID)) throw new ConvexError("Select existing branches that are not archived.");
      const grant: Grant = current?.staffGrant ? { ...current.staffGrant, revision: current.staffGrant.revision + 1, role: next } : { id: crypto.randomUUID(), revision: 1, role: next, claimed: false, expiresAt: Date.now() + 14 * DAY, expired: false, updatedAt: Date.now() };
      team.people = current
        ? team.people.map((person) => (person.email === email ? { ...person, role: next, branchIds, staffGrant: grant } : person))
        : [...team.people, { email, role: next, branchIds, staffGrant: grant, marketingGrant: null }].sort((a, b) => a.email.localeCompare(b.email));
      return grant.id;
    },
    "marketing/access:setGrant": ({ email, role: next }: { email: string; role: MarketingGrant["role"] | null }) => {
      const known = team.people.some((person) => person.email === email);
      const fresh: MarketingGrant | null = next ? { id: `mkt-${email}`, role: next, claimed: false, expiresAt: Date.now() + 14 * DAY, expired: false, updatedAt: Date.now() } : null;
      team.people = known
        ? team.people
            .map((person) => (person.email === email ? { ...person, marketingGrant: next ? { ...(person.marketingGrant ?? fresh!), role: next, updatedAt: Date.now() } : null } : person))
            .filter((person) => person.role || person.marketingGrant)
        : [...team.people, ...(fresh ? [{ email, role: null, branchIds: [], staffGrant: null, marketingGrant: fresh }] : [])].sort((a, b) => a.email.localeCompare(b.email));
      return null;
    },
    "auth/staffAccess:updateInvitation": ({ grantId, action, expectedRevision }: { grantId: string; expectedRevision: number; action: "resend" | "expire" }) => {
      const grant = team.people.find((person) => person.staffGrant?.id === grantId)?.staffGrant;
      if (!grant || grant.claimed || grant.revision !== expectedRevision) throw new ConvexError("Invitation changed.");
      const expiresAt = action === "resend" ? Date.now() + 14 * DAY : Date.now();
      team.people = team.people.map((person) => (person.staffGrant?.id === grantId ? { ...person, staffGrant: { ...person.staffGrant, revision: grant.revision + 1, expiresAt, expired: action === "expire" } } : person));
      return { expiresAt };
    },
    "settings/cashierRules:updateCashierRules": ({ expectedRevision, ...next }: CashierRules & { expectedRevision: number }) => {
      if (team.staleOnce) {
        // Another owner saved a moment earlier.
        team.staleOnce = false;
        team.rules = { ...team.rules, discountLimitPercent: 1200, revision: team.rules.revision + 1 };
        notifyFixtureStore();
      }
      if (expectedRevision !== team.rules.revision) throw new ConvexError({ code: "STALE_RULES", message: "Cashier rules changed. Reload and try again." });
      team.rules = { ...next, revision: team.rules.revision + 1 };
      return team.rules;
    },
  },
});

// ---------- Navigation ----------

function NavHarness() {
  return (
    <StaffAccessProvider access={access}>
      <SidebarProvider className="min-h-dvh bg-background" data-fixture-ready="">
        <AdminSidebar userEmail={access.email ?? undefined} />
        <AdminRail />
        <SidebarInset className="min-h-0 min-w-0">
          <header className="flex min-h-16 items-center border-b border-border px-4"><h1 className="font-serif text-2xl font-semibold">Admin</h1></header>
          <main className="flex-1" />
          <AdminTabBar />
        </SidebarInset>
      </SidebarProvider>
    </StaffAccessProvider>
  );
}

async function main() {
  const root = createRoot(document.getElementById("root")!);
  if (view === "nav") {
    root.render(<NavHarness />);
    return;
  }
  if (view === "settings") {
    root.render(
      <StaffAccessProvider access={access}>
        <ConfirmProvider>
          <div className="min-h-dvh bg-background text-foreground" data-fixture-ready="">
            <AdminSettingsView />
          </div>
        </ConfirmProvider>
      </StaffAccessProvider>,
    );
    return;
  }
  const initial = await seedCheckout();
  root.render(
    <IntlProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
      <ConfirmProvider><CheckoutHarness initial={initial} /></ConfirmProvider>
    </IntlProvider>,
  );
}
void main();
