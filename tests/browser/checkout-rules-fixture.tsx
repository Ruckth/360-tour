import { mergeSiteSettings } from "convex/shared/siteSettings";
import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";
import { ConvexError } from "convex/values";
import { createRoot } from "react-dom/client";
import { AdminRail, AdminTabBar } from "@/components/admin/AdminNav";
import { AdminSettingsView } from "@/components/admin/AdminSettingsView";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { DEFAULT_TERMS } from "@/components/admin/checkout-rules/TermsForm";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { enableLiveNavigation } from "./navigation-mock";
import { notifyFixtureStore, registerFixtureFunctions } from "./convex-mock";
import "@/app.css";

/*
 * Settings › Checkout rules in the admin shell, on an in-memory server that refuses the way
 * convex/commerce/settings.ts and paymentCutover.ts do. Query parameters:
 *   role=owner|manager         who is signed in (owner by default)
 *   stage=before|paused|open|switched|ready   the cutover: not started (default), checkout paused,
 *                              paused with a pay panel still open, switched with the till waiting,
 *                              switched with every till reloaded
 *   theme=dark                 dark app theme
 * window.fixture: closePanel() finishes the open pay panel; otherScreen() saves a rule change from
 * another screen; ackTill() reloads the till.
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const role = params.get("role") === "manager" ? "manager" : "owner";
const stage = params.get("stage") ?? "before";
const now = Date.UTC(2026, 10, 21, 3, 30);

const access: StaffAccessView = {
  email: role === "owner" ? "narin@auraliscove.co" : "ploy@auraliscove.co", role, pendingInvitation: null, marketingRole: null, cashierRules: DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: true, operations: true, manageTeam: role === "owner", settings: role === "owner",
    bookings: true, services: true, customers: true, orders: true, chats: true, properties: true, roster: true, reports: true, marketing: role === "owner",
  },
};

type Switch = "off" | "managers" | "everyone";
const rank = { off: 0, managers: 1, everyone: 2 } as const;
const server = {
  revision: stage === "before" ? 0 : 2,
  terms: { ...DEFAULT_TERMS },
  switches: { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" } as Record<string, Switch>,
  mode: (stage === "switched" || stage === "ready" ? "attempts" : "direct") as "direct" | "attempts",
  paused: stage !== "before",
  cutoverAt: stage === "switched" || stage === "ready" ? now - 600_000 : null as number | null,
  panels: stage === "open" ? [{ panelKey: "panel-1", orderId: "order-0042", actor: "token", openedAt: now - 240_000, tillId: "till-1", tillKey: "default" }] : [],
  acknowledgedAt: stage === "ready" ? now - 300_000 : null as number | null,
  keys: new Map<string, string>(),
  history: [] as HistoryRow[],
};
type Scalar = string | number | boolean | null;
type HistoryRow = { entryId: string; at: number; fact: { key: string }; balance: null; staff: { actorName: string; reason: string; reasonText: string }; changes: { field: string; before: Scalar; after: Scalar }[] };
/** Each changed rule before → after, as commerce/history.staffPage shapes a settings row. */
function changesOf(before: Record<string, unknown>, patch: Record<string, unknown>, prefix = ""): HistoryRow["changes"] {
  return Object.entries(patch).flatMap(([field, value]) => typeof value === "object" && value !== null
    ? changesOf(before[field] as Record<string, unknown>, value as Record<string, unknown>, `${field}.`)
    : before[field] === value ? [] : [{ field: `${prefix}${field}`, before: before[field] as Scalar, after: value as Scalar }]);
}

function refuse(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, message, ...extra });
}
/** The shared checks of every settings edit: request key, reason and revision. */
function edit(args: { expectedRevision: number; clientKey: string; reason: string }, payload: unknown, apply: () => void) {
  const fingerprint = JSON.stringify(payload);
  const seen = server.keys.get(args.clientKey);
  if (seen !== undefined) {
    if (seen !== fingerprint) refuse("ADJUSTMENT_KEY_CONFLICT", "This request key was used for a different edit.");
    return { status: "applied", revision: server.revision, adjustmentId: "adj" };
  }
  if (!args.reason.trim()) refuse("INVALID_ADJUSTMENT_REASON", "Choose a reason and describe it when selecting Other.");
  if (args.expectedRevision !== server.revision) refuse("STALE_ADJUSTMENT_REVISION", "This record changed. Review the edit again.");
  const before = { terms: { ...server.terms }, switches: { ...server.switches }, mode: server.mode };
  apply();
  const { terms, switches, paused } = (payload ?? {}) as { terms?: Record<string, unknown>; switches?: Record<string, unknown>; paused?: boolean };
  const fact = server.mode !== before.mode ? "paymentsSwitched" : paused !== undefined ? (paused ? "checkoutPaused" : "checkoutResumed") : "rulesChanged";
  server.history.unshift({
    entryId: `adj-${server.revision + 1}`, at: Date.now(), fact: { key: fact }, balance: null,
    staff: { actorName: access.email ?? "", reason: "other", reasonText: args.reason },
    changes: [...changesOf(before.terms, terms ?? {}), ...changesOf(before.switches, switches ?? {}, "saleSwitches.")],
  });
  server.revision += 1;
  server.keys.set(args.clientKey, fingerprint);
  return { status: "applied", revision: server.revision, adjustmentId: `adj-${server.revision}` };
}
const tills = () => server.mode === "attempts"
  ? { acknowledged: server.acknowledgedAt ? [{ tillId: "till-1", key: "default", at: server.acknowledgedAt }] : [], pending: server.acknowledgedAt ? [] : [{ tillId: "till-1", key: "default" }] }
  : { acknowledged: [], pending: [] };

registerFixtureFunctions({
  queries: {
    "settings/settings:get": () => ({ ...mergeSiteSettings(null), revision: 0 }),
    "settings/settings:setupChecklist": () => undefined,
    "pos/staffApprovals:pending": () => ({ count: 0, list: [] }),
    "commerce/settings:getRules": () => ({
      revision: server.revision, terms: server.terms, switches: server.switches, paymentsMode: server.mode,
      canEdit: role === "owner", settingsId: server.revision ? "settings-1" : null,
    }),
    "commerce/history:staffPage": () => [...server.history],
    "commerce/settings:getAccess": () => ({
      settingsRevision: server.revision, switches: server.switches, canSell: {}, paymentsMode: server.mode,
      paused: server.paused && server.mode === "direct", tillReady: false, cutoverRevision: null,
    }),
    "commerce/paymentCutover:status": () => ({
      mode: server.mode, settingsRevision: server.revision, paused: server.paused && server.mode === "direct", cutoverAt: server.cutoverAt,
      cutoverRevision: server.mode === "attempts" ? 2 : null, ...tills(),
    }),
  },
  mutations: {
    "commerce/settings:updateRules": ({ terms, switches, ...args }: { expectedRevision: number; clientKey: string; reason: string; terms?: object; switches?: Record<string, Switch> }) =>
      edit(args, { terms, switches }, () => {
        const next = { ...server.switches, ...switches };
        const raising = Object.keys(next).some((kind) => rank[next[kind]] > rank[server.switches[kind]]);
        const { acknowledged, pending } = tills();
        if (raising && (server.mode !== "attempts" || !acknowledged.length || pending.length)) {
          refuse("PAYMENT_ROLLOUT_PENDING", "Switch to new payments and reload every till before enabling sales.");
        }
        server.terms = { ...server.terms, ...terms };
        server.switches = next;
      }),
    "commerce/paymentCutover:setPaused": ({ paused, ...args }: { expectedRevision: number; clientKey: string; reason: string; paused: boolean }) =>
      edit(args, { paused }, () => {
        if (server.mode === "attempts") refuse("PAYMENTS_ALREADY_SWITCHED", "New payments are already on.");
        server.paused = paused;
      }),
    "commerce/paymentCutover:activate": (args: { expectedRevision: number; clientKey: string; reason: string }) =>
      edit(args, {}, () => {
        if (server.mode === "attempts") refuse("PAYMENTS_ALREADY_SWITCHED", "New payments are already on.");
        if (!server.paused) refuse("PAYMENT_PAUSE_REQUIRED", "Pause checkout before switching to new payments.");
        if (server.panels.length) refuse("PAYMENTS_STILL_OPEN", "Finish or reconcile open payments before switching.", { panels: server.panels, attempts: [], moreAttempts: false });
        server.mode = "attempts";
        server.cutoverAt = Date.now();
      }),
  },
});

Object.assign(window, {
  fixture: {
    closePanel() { server.panels = []; notifyFixtureStore(); },
    otherScreen() { server.terms = { ...server.terms, voucherValidityDays: 90 }; server.revision += 1; notifyFixtureStore(); },
    ackTill() { server.acknowledgedAt = Date.now(); notifyFixtureStore(); },
    switches() { return server.switches; },
  },
});

enableLiveNavigation();
createRoot(document.getElementById("root")!).render(
  <StaffAccessProvider access={access}>
    <ConfirmProvider>
      <SidebarProvider className="min-h-dvh bg-background text-foreground" data-fixture-ready="">
        <AdminSidebar userEmail={access.email ?? undefined} />
        <AdminRail />
        <SidebarInset className="min-h-0 min-w-0">
          <header className="flex min-h-16 items-center border-b border-border px-4"><h1 className="font-serif text-2xl font-semibold">Settings</h1></header>
          <main className="flex-1"><AdminSettingsView /></main>
          <AdminTabBar />
        </SidebarInset>
      </SidebarProvider>
    </ConfirmProvider>
  </StaffAccessProvider>,
);
