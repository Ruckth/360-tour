import { IntlProvider } from "@/platform/intl";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import { CheckoutBackendProvider, type ApprovalQueueRow } from "@/components/checkout/backend";
import { CheckoutPreview, previewBackend } from "@/components/checkout/CheckoutPreview";
import { CommerceMessages } from "@/components/checkout/commerce-messages";
import { historyEntry } from "@/components/checkout/commerce-readers";
import EditHistory from "@/components/checkout/EditHistory";
import { previewQueue } from "@/components/checkout/design/commerce-approvals";
import { commerceReceipt } from "@/components/checkout/design/commerce-receipt";
import { commerceDesignStates, type CommerceDesignState } from "@/components/checkout/fixture-backend";
import { Screen } from "@/components/display/DisplayScreens";
import en from "../../messages/en.json";
import commerceEn from "../../messages/commerce/en.json";
import displayEn from "../../messages/display/en.json";
import "@/app.css";

/*
 * The checkout Preview (src/components/checkout/CheckoutPreview.tsx) on one commerce design state,
 * for layout checks of the reader screens. Query parameters:
 *   commerce=<state>  one of commerceDesignStates (dark is what production ships: every switch Off)
 *   receipt=1         open the issuance receipt (packages, products, a gift voucher, a covered visit) instead of checkout
 *   receipt=redemption  open the redemption receipt (goodwill credit and voucher spend) instead
 *   theme=dark        dark app theme
 *   typed=<text>      append <text> (e.g. a full voucher code) to the issuance receipt's row names,
 *                     as staff might type it into a custom item
 *   queue=filtered    only the Approvals button, for a manager whose first page holds only their own
 *                     requests: the first page is empty with more to come, the next holds one discount
 *   display=order     the paired customer display on a room order, with <typed> appended to the extra
 *   unlimited=1       the issuance receipt's gift voucher never expires: getOrder sends it in
 *                     `unlimitedIssuedBenefits` with a null date (D20)
 *   history=publish   staff History for a package, from the backend's response for a five → six
 *                     session publish, a same-size substitution, the price-only control and a
 *                     change of eligible service (astra r4)
 *   history=cold      staff History as a cold open of a populated voucher arrives (astra r5): loading,
 *                     then the first page split by Convex (LoadingMore, no rows yet), then its rows
 *   history=cold-empty  the same steps for a voucher with no History, ending Exhausted with no rows
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const requested = params.get("commerce");
const commerce = commerceDesignStates.find((key) => key === requested) as CommerceDesignState | undefined;
const typed = params.get("typed");
if (typed) commerceReceipt.lines = commerceReceipt.lines.map((line) => ({ ...line, name: `${line.name} ${typed}` }));

if (params.get("unlimited") === "1" && commerceReceipt.commerce) {
  const sold = commerceReceipt.commerce.issuedBenefits.filter((benefit) => benefit.editHistory.targetType === "voucher" && benefit.contentKey === "voucher");
  commerceReceipt.commerce = {
    ...commerceReceipt.commerce,
    issuedBenefits: commerceReceipt.commerce.issuedBenefits.filter((benefit) => !sold.includes(benefit)),
    unlimitedIssuedBenefits: sold.map((benefit) => ({ ...benefit, issuedExpiresAt: null })) as never,
  };
}

/** commerce/history.staffPage rows, as the isolated backend returned them to the audit (r3). */
const staff = { actorName: "Ploy", reason: "other", reasonText: "Future sales" };
const session = (units: number, label?: string) => ({ contentKey: "massage", kind: "session", serviceIds: ["svc1"], units, ...(label ? { label } : {}) });
const publishRows = [
  { entryId: "qty", at: Date.UTC(2026, 10, 19, 0), fact: { key: "published" }, balance: null, before: { contents: [session(5)] }, after: { contents: [session(6)] }, staff },
  { entryId: "swap", at: Date.UTC(2026, 10, 18, 23), fact: { key: "published" }, balance: null, before: { contents: [session(5, "Massage 60")] }, after: { contents: [session(5, "Hot stone 60")] }, staff },
  { entryId: "price", at: Date.UTC(2026, 10, 18, 22), fact: { key: "published" }, balance: null, before: { price: 100000 }, after: { price: 120000 }, staff },
  // Astra r4 (audits/pr91-r4-astra-evidence/service-substitution.json): only the eligible service
  // changed. staffPage now names each stored service ID (convex/commerce/historyEvidence.test.ts).
  { entryId: "ms78asjbfrc9za866sp9sdxawx8jg3bf", at: 1795046402000, fact: { key: "published" }, balance: null,
    before: { contents: [{ contentKey: "massage", kind: "session", serviceIds: ["v574az9yevd878g3ttnq5vqrm58jh4qs"], units: 5, label: "Traditional Thai Massage" }] },
    after: { contents: [{ contentKey: "massage", kind: "session", serviceIds: ["v5716vh32a09k3mrge6ek8mrds8jgdax"], units: 5, label: "Aromatherapy Massage" }] },
    staff: { actorName: "Ploy", reason: "other", reasonText: "Updated eligible treatment" } },
].map((row) => historyEntry(row as unknown as Parameters<typeof historyEntry>[0]));

function PublishHistory() {
  const base = previewBackend("empty", "live");
  const backend = { ...base, commerce: { ...base.commerce!, useHistory: () => ({ results: publishRows, status: "Exhausted" as const, loadMore: () => {} }) } };
  return (
    <CommerceMessages messages={commerceEn}>
      <CheckoutBackendProvider backend={backend}>
        <div className="h-dvh bg-background" />
        <EditHistory target={{ targetType: "package", targetId: "fxpkggold" as never }} title="Gold Wellness" onClose={() => {}} />
      </CheckoutBackendProvider>
    </CommerceMessages>
  );
}

/** usePaginatedQuery's states for a first page that Convex splits (SplitRequired), 250 ms apart. */
function useColdHistory(rows: typeof publishRows) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= 2) return;
    const timer = setTimeout(() => setStep(step + 1), 250);
    return () => clearTimeout(timer);
  }, [step]);
  if (step === 0) return { results: [], status: "LoadingFirstPage" as const, loadMore: () => {} };
  if (step === 1) return { results: [], status: "LoadingMore" as const, loadMore: () => {} };
  return { results: rows, status: "Exhausted" as const, loadMore: () => {} };
}

function ColdHistory({ empty }: { empty: boolean }) {
  const base = previewBackend("empty", "live");
  const backend = { ...base, commerce: { ...base.commerce!, useHistory: () => useColdHistory(empty ? [] : publishRows) } };
  return (
    <CommerceMessages messages={commerceEn}>
      <CheckoutBackendProvider backend={backend}>
        <div className="h-dvh bg-background" />
        <EditHistory target={{ targetType: "voucher", targetId: "fxvoucher" as never }} title="Gift voucher" onClose={() => {}} />
      </CheckoutBackendProvider>
    </CommerceMessages>
  );
}

const waiting = previewQueue.filter((row) => row.kind === "discount");
/** The server's pages for a promoted manager: their own 20 newer requests filter to nothing. */
function useFilteredQueue() {
  const [pages, setPages] = useState(1);
  return pages === 1
    ? { results: [] as ApprovalQueueRow[], status: "CanLoadMore" as const, loadMore: () => setTimeout(() => setPages(2), 300) }
    : { results: waiting, status: "Exhausted" as const, loadMore: () => {} };
}

function FilteredQueue() {
  const backend = { ...previewBackend("empty", "live"), usePendingApprovals: useFilteredQueue };
  return (
    <CommerceMessages messages={commerceEn}>
      <ConfirmProvider>
        <CheckoutBackendProvider backend={backend}>
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <header className="flex h-16 items-center gap-3 border-b border-border px-4">
              <h1 className="flex-1 font-serif text-2xl font-semibold">Checkout</h1>
              <CheckoutStaffControls />
            </header>
          </div>
        </CheckoutBackendProvider>
      </ConfirmProvider>
    </CommerceMessages>
  );
}

const roomOrder = {
  state: "order", businessName: "Auralis Cove Retreat", customerFirstName: "Maya", orderNumber: 1048, currency: "THB",
  subtotal: 870000, discount: 0, coupon: null, deposit: 0, total: 870000, vat: 0, due: 870000, activeAt: Date.now(),
  lines: [
    { name: "Tideglass Pool Residence", detail: "1 night", qty: 1, unitPrice: 850000, price: 850000, discount: 0, couponDiscount: 0, total: 850000, deposit: 0 },
    { name: `Sunset cocktail ${typed ?? ""}`.trim(), detail: null, qty: 1, unitPrice: 20000, price: 20000, discount: 0, couponDiscount: 0, total: 20000, deposit: 0 },
  ],
} as const;

const tree = params.get("queue") === "filtered" ? <FilteredQueue />
  : params.get("history") === "publish" ? <PublishHistory />
  : params.get("history")?.startsWith("cold") ? <ColdHistory empty={params.get("history") === "cold-empty"} />
  : params.get("display") === "order" ? (
    <IntlProvider locale="en" messages={displayEn} timeZone="Asia/Bangkok"><Screen state={roomOrder as never} /></IntlProvider>
  ) : <CheckoutPreview initial={{ commerce, receipt: params.get("receipt") === "redemption" ? "redemption" : params.get("receipt") === "1" }} />;

createRoot(document.getElementById("root")!).render(
  <IntlProvider locale="en" messages={en} timeZone="Asia/Bangkok">
    <div data-fixture-ready="">{tree}</div>
  </IntlProvider>,
);
