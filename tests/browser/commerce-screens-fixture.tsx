import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import { CheckoutBackendProvider, type ApprovalQueueRow } from "@/components/checkout/backend";
import { CheckoutPreview, previewBackend } from "@/components/checkout/CheckoutPreview";
import { CommerceMessages } from "@/components/checkout/commerce-messages";
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
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const requested = params.get("commerce");
const commerce = commerceDesignStates.find((key) => key === requested) as CommerceDesignState | undefined;
const typed = params.get("typed");
if (typed) commerceReceipt.lines = commerceReceipt.lines.map((line) => ({ ...line, name: `${line.name} ${typed}` }));

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
  : params.get("display") === "order" ? (
    <NextIntlClientProvider locale="en" messages={displayEn} timeZone="Asia/Bangkok"><Screen state={roomOrder as never} /></NextIntlClientProvider>
  ) : <CheckoutPreview initial={{ commerce, receipt: params.get("receipt") === "redemption" ? "redemption" : params.get("receipt") === "1" }} />;

createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
    <div data-fixture-ready="">{tree}</div>
  </NextIntlClientProvider>,
);
