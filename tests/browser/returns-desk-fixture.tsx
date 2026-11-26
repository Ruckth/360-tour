import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import { ConvexError } from "convex/values";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { DEFAULT_CASHIER_RULES } from "convex/shared/staffTypes";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import {
  COMMERCE_OFF, CheckoutBackendProvider, returnArgs, type CheckoutActions, type CheckoutBackend, type OrderId, type ReturnsDesk, type ReturnsDeskActions,
} from "@/components/checkout/backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { cutoverAccess, type PayDeskTransport } from "@/components/checkout/pay-desk-backend";
import { deviceKey, rememberTill } from "@/components/checkout/pay-desk";
import "@/app.css";
import commerceEn from "../../messages/commerce/en.json";

/*
 * Return items on real Convex functions: tests/support/returns-desk-harness.ts seeds journey 7's
 * Gold Wellness receipt (฿6,900 by card) and runs every read and write in-process. Query parameters:
 *   role=manager|cashier   who this screen is (manager by default)
 *   session=<id>           share another screen's database (a manager approving a cashier's request)
 *   variant=mixed|expired|twoExpired|visit|linked|covered   a ฿1,200 massage paid ฿500 voucher + ฿700 card (walk-in, its
 *                          voucher since expired, ฿250 each on two expired vouchers, attached or linked visit), or a ฿0
 *                          visit covered by a package session, instead of Gold Wellness
 *   refundRule=cashier     the Team Refund rule granted to cashiers (D14)
 *   page=settings          a manager's fresh Settings tab: header only, on the live access reader, on a
 *                          device already admitted at checkout (payments on attempts since revision 1)
 * The session is kept for this tab, so a reload reopens the same database: what a till sees after a refresh.
 */

type Role = "manager" | "cashier";
const params = new URLSearchParams(location.search);
const role: Role = params.get("role") === "cashier" ? "cashier" : "manager";
const EMAILS = { manager: "ploy@auraliscove.co", cashier: "mint@auraliscove.co" } as const;

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/__checkout-fixture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    if (result.data !== undefined) throw new ConvexError(result.data);
    throw new Error(result.message);
  }
  return result.value;
}
const variant = params.get("variant");
const session = params.get("session") ?? sessionStorage.getItem("returns-fixture-session") ?? await post<string>({ kind: "create", harness: "returns", options: variant ? { variant } : {} });
sessionStorage.setItem("returns-fixture-session", session);
const call = <T,>(method: string, args: unknown[]) => post<T>({ kind: "call", session, method, args });
const orderId = await call<OrderId>("orderId", []);

// Reads are cached per function and arguments and refreshed after every write, and every
// second for writes made on another screen.
type Entry = { name: string; args: unknown; value: unknown; error?: unknown };
const cache = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((fn) => fn()); };
async function load(entry: Entry) {
  try {
    entry.value = await call("query", [role, entry.name, entry.args]);
    entry.error = undefined;
  } catch (error) {
    entry.error = error;
  }
}
async function refresh() {
  await Promise.all([...cache.values()].map(load));
  notify();
}
setInterval(() => void refresh(), 1000);
function useRead<T>(name: string, args: unknown | "skip"): T | undefined {
  useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version);
  const key = args === "skip" ? "" : JSON.stringify([name, args]);
  let entry = cache.get(key);
  if (key && !entry) {
    entry = { name, args, value: undefined };
    cache.set(key, entry);
  }
  useEffect(() => {
    if (entry && entry.value === undefined && !entry.error) void load(entry).then(notify);
  }, [entry]);
  if (entry?.error) throw entry.error;
  return entry?.value as T | undefined;
}
async function write<T>(name: string, args: unknown): Promise<T> {
  window.fixtureTaps?.push(`write:${name}`);
  try {
    return await call<T>("mutation", [role, name, args]);
  } finally {
    await refresh();
  }
}

// A Settings tab opened after this device was admitted at checkout: its till is remembered, and
// this page load has pinned nothing yet.
const settingsPage = params.get("page") === "settings";
if (settingsPage) {
  await call("attempts", []);
  const { cutoverRevision } = await call<{ cutoverRevision: number }>("query", [role, "commerce/settings:getAccess", {}]);
  const ack = await call<{ tillId: Id<"tills"> }>("mutation", [role, "commerce/paymentCutover:acknowledge", { deviceKey: deviceKey(), loadedMode: "attempts", loadedRevision: cutoverRevision }]);
  rememberTill(ack.tillId);
}
const transport: PayDeskTransport = {
  useQuery: ((ref, args) => useRead(getFunctionName(ref), args)) as PayDeskTransport["useQuery"],
  useMutation: ((ref) => (args: unknown) => write(getFunctionName(ref), args)) as PayDeskTransport["useMutation"],
};

const nothing = { results: [], status: "Exhausted" as const, loadMore: () => {} };
const notHere = new Proxy({}, { get: (_, name) => async () => { throw new Error(`${String(name)} isn't part of the returns fixture`); } }) as CheckoutActions;
const R = "pos/commands/returnItems:";
const returnActions: ReturnsDeskActions = {
  preview: (args) => call("query", [role, `${R}preview`, args]),
  authorize: (args) => write(`${R}authorize`, args),
  askManager: (args) => write(`${R}askManager`, args),
  decideApproval: (args) => write(`${R}decideApproval`, args),
  claim: (args) => write(`${R}claim`, args),
  arm: (args) => write(`${R}arm`, args),
  recordPayout: (args) => write(`${R}recordPayout`, args),
  retry: (args) => write(`${R}retry`, args),
  cancel: (args) => write(`${R}cancel`, args),
  release: (args) => write(`${R}release`, args),
};
const returns: ReturnsDesk = {
  useReturn: (args) => useRead(`${R}get`, args ? returnArgs(args) : "skip"),
  useRequestStatus: (requestId) => useRead("pos/staffApprovals:myStatus", requestId ? { requestId } : "skip"),
  useActions: () => returnActions,
};
const backend: CheckoutBackend = {
  useOrder: (id) => useRead("pos/orders:getOrder", id ? { orderId: id } : "skip"),
  useBusinessName: () => "Auralis Cove Retreat",
  useOrderApprovals: (id) => useRead("pos/staffApprovals:forOrder", id ? { orderId: id } : "skip"),
  // One page of the managers' queue (staffApprovals.pendingPage), as the live backend pages it.
  usePendingApprovals: () => {
    const page = useRead<FunctionReturnType<typeof api.pos.staffApprovals.pendingPage>>("pos/staffApprovals:pendingPage", role === "cashier" ? "skip" : { paginationOpts: { numItems: 20, cursor: null } });
    return useMemo(() => ({ results: page?.page ?? [], status: page === undefined && role !== "cashier" ? "LoadingFirstPage" as const : "Exhausted" as const, loadMore: () => {} }), [page]);
  },
  useApprovalDetail: (requestId) => useRead("pos/staffApprovals:detail", requestId ? { requestId } : "skip"),
  useActions: () => notHere,
  useRestoreCheck: () => undefined,
  useAppointmentFees: () => [],
  useCorrectionHistory: () => nothing,
  useAuditHistory: () => nothing,
  useBookingRefundHistory: () => nothing,
  useAppointmentRefundHistory: () => nothing,
  useOrderRefundHistory: () => nothing,
  useCatalog: () => undefined,
  useOrderHistory: () => nothing,
  useOrders: () => nothing,
  useOpenOrders: () => nothing,
  useCustomerSearch: () => [],
  useCustomerPage: () => nothing,
  useCustomer: () => null,
  useCustomerHistory: () => nothing,
  useCustomerOrders: () => nothing,
  useAttachable: () => [],
  useAttachLookupStatus: () => ({ complete: true }),
  useLinkCandidates: () => [],
  useFindOrder: () => null,
  // Commerce receipts exist only after the payments cutover.
  commerce: settingsPage ? { ...COMMERCE_OFF, useAccess: cutoverAccess(transport) } : { ...COMMERCE_OFF, useAccess: () => ({ ...COMMERCE_OFF.useAccess()!, paymentsMode: "attempts" }) },
  returns,
};

const access: StaffAccessView = {
  email: EMAILS[role], role, pendingInvitation: null, companyScope: false, branches: [], marketingInvitation: null, marketingRole: null,
  cashierRules: params.get("refundRule") === "cashier" ? { ...DEFAULT_CASHIER_RULES, refund: "cashier" } : DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: role === "manager", operations: role === "manager", manageTeam: false, settings: false,
    bookings: role === "manager", services: role === "manager", customers: role === "manager", orders: role === "manager", chats: role === "manager",
    properties: role === "manager", roster: role === "manager", reports: role === "manager", marketing: false,
  },
};

declare global {
  interface Window {
    fixtureTaps?: string[];
    returnsFixture: { session: string; orderId: OrderId; returns: () => Promise<unknown[]>; payouts: () => Promise<unknown[]>; stock: () => Promise<number | null> };
  }
}
window.returnsFixture = { session, orderId, returns: () => call("returns", []), payouts: () => call("payouts", []), stock: () => call("stock", []) };

function Harness() {
  const [, setOpen] = useState<Id<"orders"> | null>(null);
  return (
    <StaffAccessProvider access={access}>
      <CheckoutBackendProvider backend={backend}>
        <div className="flex h-dvh flex-col bg-background text-foreground" data-fixture-ready="" data-role={role}>
          <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 sm:px-6">
            <h1 className="min-w-0 flex-1 truncate font-serif text-2xl font-semibold tracking-tight">{settingsPage ? "Settings" : "Checkout"}</h1>
            <CheckoutStaffControls />
          </header>
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            {settingsPage ? null : <ReceiptView orderId={orderId} onNewSale={() => {}} onOpenOrder={setOpen} />}
          </div>
        </div>
      </CheckoutBackendProvider>
    </StaffAccessProvider>
  );
}

// The admin layout supplies the commerce catalog to receipts (CommerceReceiptRow); so does this page.
createRoot(document.getElementById("root")!).render(
  <IntlProvider locale="en" timeZone="Asia/Bangkok" messages={commerceEn}>
    <ConfirmProvider><Harness /></ConfirmProvider>
  </IntlProvider>,
);
