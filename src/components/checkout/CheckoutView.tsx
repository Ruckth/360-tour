"use client";

import type { Id } from "convex/_generated/dataModel";
import { ChevronUp, ReceiptText, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApprovalRequestForm, useSendApproval } from "./ApprovalRequest";
import { useCheckoutBackend, useCommerce, type CatalogItem, type OrderId } from "./backend";
import { CatalogPane } from "./CatalogPane";
import { TOUCH_TARGETS } from "./checkout-ui";
import { CheckoutDialogContent, CheckoutSheetContent } from "./CheckoutLayers";
import { useLoadablePhoto } from "./CheckoutPhoto";
import { CheckoutDraftProvider, useCheckoutDraft, useCheckoutDiscountNotice, useCheckoutDraftOrder, useCheckoutPaymentSubmitting } from "./CheckoutDrafts";
import { OrderPanel, usePayState } from "./OrderPanel";
import { OrderStrip } from "./OrderStrip";
import { errorText } from "@/lib/staff-bookings";
import { needsApproval, shownRequest } from "./staff-approvals";
import { useOrderWrites } from "./useOrderWrites";
import { useCommerceCopy } from "./commerce-copy";

const CheckoutProducts = lazy(() => import("./CheckoutProducts"));

/**
 * Staff checkout: the order strip on top (order, booking, customer, Orders), the catalog on the
 * left, the order's items on the right (wide screens) or in a bottom sheet behind a floating
 * total (phones). Data comes from the CheckoutBackend in context, so the admin page and the dev
 * preview render the same UI.
 */
export function CheckoutView(props: CheckoutViewProps) {
  return <CheckoutDraftProvider>{props.retail ? <RetailCheckoutContent {...props} /> : <CheckoutContent {...props} />}</CheckoutDraftProvider>;
}

type CheckoutViewProps = {
  orderId: OrderId | null;
  onOrderChange: (orderId: OrderId | null) => void;
  /** Paid here, or opened already paid/void: replace this page with its receipt. */
  onPaid: (orderId: OrderId) => void;
  /** Shown above the catalog, e.g. a refused `?booking=` link. */
  notice?: string;
  onNoticeRetry?: () => void;
  /** The customer display button; only the admin page has one. */
  displayControl?: ReactNode;
  retail?: boolean;
  ordersFilterScope?: string;
  preferredRetailBranchId?: Id<"branches">;
};

function RetailCheckoutContent(props: CheckoutViewProps) {
  const { t } = useCommerceCopy();
  return <CheckoutContent {...props} retailLabels={{ products: t("kinds.products"), loading: t("retail.loading") }} />;
}

function CheckoutContent({
  orderId,
  onOrderChange,
  onPaid,
  notice,
  onNoticeRetry,
  displayControl,
  retailLabels,
  preferredRetailBranchId,
  ordersFilterScope,
}: CheckoutViewProps & { retailLabels?: { products: string; loading: string } }) {
  const { confirmDiscard } = useCheckoutDraft();
  const { discountNotice, setDiscountNotice } = useCheckoutDiscountNotice();
  const backend = useCheckoutBackend();
  const commerce = useCommerce();
  const commerceAccess = commerce.useAccess();
  const catalog = backend.useCatalog();
  const view = backend.useOrder(orderId, "checkout");
  const actions = backend.useActions();
  const { paymentSubmitting } = useCheckoutPaymentSubmitting();
  const [error, setError] = useState("");
  const [earlierError, setEarlierError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = useIsMobile(1024);
  // Set by the phone bar's Cash: the sheet opens on the cash panel instead of the rows.
  const [payOnOpen, setPayOnOpen] = useState<"cash" | undefined>();
  const { run, switchTo, busy } = useOrderWrites(orderId, onOrderChange, setError, setEarlierError);
  const reviewLocked = useRef(false);
  useEffect(() => { reviewLocked.current = paymentSubmitting || busy; }, [paymentSubmitting, busy]);
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
  // Approvers keep the header's Approvals usable over the phone order sheet, so for them the sheet
  // is non-modal: it stops under the header, and the page behind it is inert instead.
  const keepHeader = access.capabilities.approve;
  const customNeedsManager = cashier && access.cashierRules.customPrice === "manager";
  // A cashier's custom item that needs a manager: asked for, not added.
  const [askItem, setAskItem] = useState<{ name: string; price: number } | null>(null);
  const send = useSendApproval();

  const add = useCallback((item: CatalogItem) => {
    if (customNeedsManager && item.kind === "extra") {
      setAskItem({ name: item.name, price: item.price });
      return;
    }
    void run(async (id) => {
      try {
        return await actions.addItem({ orderId: id, item });
      } catch (err) {
        if (!cashier || item.kind !== "extra" || !needsApproval(err)) throw err;
        setAskItem({ name: item.name, price: item.price });
        return null;
      }
    });
  }, [run, actions, cashier, customNeedsManager]);

  /** Sends the custom item request, starting an empty order first if there is none yet. */
  async function requestItem(item: { name: string; price: number }, reason: string) {
    let failed: string | null = null;
    await run(async (id) => {
      let target = id;
      if (!target) {
        try {
          target = (await actions.createOrder({})).orderId;
        } catch (err) {
          failed = errorText(err, "Couldn’t start an order. Try again.");
          return null;
        }
      }
      failed = await send(target, { kind: "customPrice", action: "addCustomItem", name: item.name, price: item.price }, reason);
      return { orderId: target };
    }, () => { if (!failed) setAskItem(null); });
    return failed;
  }

  const changeOrder = useCallback(
    async (next: OrderId | null, canChange: () => boolean = () => true) => {
      if (!await confirmDiscard() || !canChange()) return false;
      setSheetOpen(false);
      setPayOnOpen(undefined);
      // A failed write belongs to the order it was made on; the next order starts without its banner.
      setError("");
      switchTo(next);
      return true;
    },
    [switchTo, confirmDiscard],
  );

  // Paying and then seeing the order turn paid both lead to the receipt; go there once.
  const shownReceipt = useRef<OrderId | null>(null);
  const toReceipt = useCallback(
    (id: OrderId) => {
      if (shownReceipt.current === id) return;
      shownReceipt.current = id;
      onPaid(id);
    },
    [onPaid],
  );

  const missing = orderId !== null && view === null;
  const title = view?.order.title ?? (orderId && view === undefined ? "Loading order…" : "New order");
  const lines = view?.lines ?? [];
  const count = lines.reduce((n, line) => n + line.qty, 0);
  const settled = view && (view.order.state === "paid" || view.order.state === "void");
  const due = view?.totals.due ?? 0;
  // The phone bar offers exact cash once the order could be paid with it.
  const { cannotPay, approvals, now } = usePayState(missing ? null : view);
  useCheckoutDraftOrder(orderId, view, approvals);
  const request = shownRequest(approvals, now);
  const requestLabel = request?.status === "pending" ? "Request waiting" : "Request update";
  // Not while a change is still saving: the panel would open on an order about to change.
  const quickCash = !cannotPay && !busy && due > 0 && view?.order.state !== "discarded";

  // A paid or void order opened by link goes straight to its receipt.
  useEffect(() => {
    if (settled && view) toReceipt(view.order._id);
  }, [settled, view, toReceipt]);

  // Rotation closes a clean phone sheet. A dirty editor stays visible until staff agree to
  // discard it; CSS must not hide that sheet (and leave its overlay trapping focus).
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => {
      if (wide.matches && sheetOpen) {
        void confirmDiscard().then((discard) => {
          if (!discard) return;
          setSheetOpen(false);
          setPayOnOpen(undefined);
        });
      }
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [confirmDiscard, sheetOpen]);

  async function closeSheet() {
    if (!await confirmDiscard()) return;
    setSheetOpen(false);
    setPayOnOpen(undefined);
  }

  const discountAlert = discountNotice ? (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
      <span className="flex-1 basis-40">{discountNotice.message}</span>
      <button type="button" disabled={paymentSubmitting || busy} className="min-h-11 rounded px-2 font-medium underline disabled:opacity-50" onClick={() => {
        void (async () => {
          if (reviewLocked.current) return;
          // Only switch sales when the notice is for another order; reviewing the open order keeps its own error and state.
          const ready = discountNotice.orderId === orderId ? await confirmDiscard() : await changeOrder(discountNotice.orderId, () => !reviewLocked.current);
          if (!ready || reviewLocked.current) return;
          setPayOnOpen(undefined);
          if (narrow) setSheetOpen(true);
          setDiscountNotice(current => current === discountNotice ? { ...current, review: true } : current);
        })();
      }}>Review discount</button>
      <button type="button" disabled={paymentSubmitting || busy} aria-label="Dismiss discount notice" className="grid size-11 place-items-center rounded disabled:opacity-50" onClick={() => setDiscountNotice(null)}><X aria-hidden className="size-4" /></button>
    </div>
  ) : null;

  // Keyed by order, so opening another order starts from its rows, never a payment begun on the last one.
  const panel = (onClose?: () => void, initialPay?: "cash") => (
    <OrderPanel key={orderId ?? "new"} view={missing ? null : view} title={title} catalog={catalog} run={run} busy={busy} onPaid={toReceipt} onClose={onClose} initialPay={initialPay} discountNotice={discountAlert} onOpenOrder={(id) => { void changeOrder(id); }} />
  );

  // Danger-tone colours: red text on the red tint stays ≥4.5:1 (destructive/10 was 3.8:1).
  const alert = (message: string) => (
    <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-6 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-300">
      <span className="flex-1 self-center">{message}</span>
      {!error && !earlierError && onNoticeRetry ? (
        <button type="button" onClick={onNoticeRetry} className="shrink-0 rounded px-2 py-1 font-medium underline">Try again</button>
      ) : null}
      {error || earlierError ? (
        <button type="button" onClick={() => { if (error) setError(""); else setEarlierError(""); }} aria-label="Dismiss" className="grid place-items-center rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-400/20">
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
  // A cashier can't open older receipts; the server answers those as missing too.
  const message = error || earlierError || notice || (missing ? (cashier ? "Not available." : "That order link is invalid or the order no longer exists. Start a new order or choose one from Orders.") : "");

  return (
    <div inert={sheetOpen && keepHeader} className={cn("relative isolate flex min-h-0 flex-1 flex-col overflow-y-auto bg-background", TOUCH_TARGETS)}>
      {discountNotice && discountNotice.orderId !== orderId ? <DiscountNoticeTarget orderId={discountNotice.orderId} /> : null}
      <Backdrop src={catalog?.rooms.find((room) => room.imageUrl)?.imageUrl} />
      <OrderStrip key={ordersFilterScope} ordersFilterScope={ordersFilterScope} view={missing ? null : view} title={title} run={run} onOrderChange={changeOrder} canStartNew={orderId !== null || Boolean(notice)} displayControl={displayControl} />
      {message ? alert(message) : null}
      {narrow && !sheetOpen ? discountAlert : null}
      <div className="flex min-h-0 flex-1">
        {view?.order.state === "discarded" ? narrow && !sheetOpen ? panel() : <div className="min-w-0 flex-1 p-6"><h2 className="font-serif text-2xl">Discarded order</h2><p className="mt-3 text-sm text-muted-foreground">This order is read only. Review its items in the order panel before restoring it.</p></div> : <CatalogPane catalog={catalog} lines={lines} onAdd={add} customNeedsManager={customNeedsManager} products={retailLabels && commerceAccess?.canSell.products && commerceAccess.paymentsMode === "attempts" && !commerceAccess.paused ? { label: retailLabels.products, content: <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{retailLabels.loading}</p>}><CheckoutProducts preferredBranchId={preferredRetailBranchId} orderBranchId={view?.order.stockBranchId} busy={busy || paymentSubmitting || Boolean(orderId && !view)} run={run} /></Suspense> } : undefined} className="min-w-0 flex-1" />}
        {/* An inset glass panel, wider on bigger screens; the catalog's columns adapt to what is left.
            Without backdrop-filter it stays nearly opaque, so the photo behind never thins the text. */}
        {!narrow && !sheetOpen ? <aside
          aria-label="Order"
          className="mt-1 mr-4 mb-4 hidden max-h-full lg:w-[420px] shrink-0 overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-xl shadow-navy/10 backdrop-blur-xl supports-[backdrop-filter:blur(1px)]:bg-card/80 lg:flex lg:flex-col xl:w-[440px] 2xl:w-[480px] dark:shadow-black/30"
        >
          {panel()}
        </aside> : null}
      </div>

      <Dialog open={askItem !== null} onOpenChange={(open) => { if (!open) setAskItem(null); }}>
        <CheckoutDialogContent className="max-w-sm" showCloseButton={false}>
          <DialogTitle className="sr-only">Ask a manager</DialogTitle>
          {askItem ? (
            <ApprovalRequestForm
              className="border-0 bg-transparent p-0 dark:bg-transparent"
              what={`${askItem.name} · ${formatMoney(askItem.price)}`}
              onCancel={() => setAskItem(null)}
              onSend={(reason) => requestItem(askItem, reason)}
            />
          ) : null}
        </CheckoutDialogContent>
      </Dialog>

      {/* The pill is the sheet's trigger, so closing the sheet puts focus back on it. Once the
          order can be paid, Cash ฿X beside it opens the sheet on the cash panel, prefilled; its
          Confirm is still the one that takes the money. */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) setSheetOpen(true); else void closeSheet(); }} modal={!keepHeader}>
        <div data-admin-bottom-bar="lg" className={cn("fixed inset-x-4 bottom-[calc(1rem+max(var(--admin-tab-bar,0px),env(safe-area-inset-bottom)))] z-30 flex min-h-14 items-stretch gap-1 rounded-2xl p-1 lg:hidden", count ? "bg-primary text-primary-foreground shadow-xl shadow-navy/25 dark:shadow-black/40" : "border border-border bg-card text-foreground shadow-sm")}>
          {count || request ? <SheetTrigger asChild>
            <button
              type="button"
              // Starts with the visible text, so voice control can say what it sees (WCAG 2.5.3).
              aria-label={count ? `View order ${count} ${count === 1 ? "item" : "items"}${quickCash ? ` · ${title}` : ` ${formatMoney(due)} · ${title}, due`} · open the order` : `${requestLabel} · View · open the order`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-2 pr-2 pl-3 text-left focus-visible:outline-2 focus-visible:outline-ring min-[400px]:gap-3 min-[400px]:px-4"
            >
              <ReceiptText aria-hidden className="size-5 shrink-0" />
              {/* "View order" never truncates; a long total shrinks the Cash amount instead. */}
              <span className="min-w-0 flex-1 leading-tight">
                <span className={cn("block text-sm font-semibold", count ? "whitespace-nowrap" : "truncate")}>{count ? "View order" : `${requestLabel} · View`}</span>{" "}
                {count ? <span className="block truncate text-xs opacity-80">{`${count} ${count === 1 ? "item" : "items"}`}</span> : null}{" "}
              </span>
              {count && !quickCash ? <span className={cn("shrink-0 leading-none font-semibold font-sans whitespace-nowrap tabular-nums", cashAmountSize(formatMoney(due), "text-2xl"))}>{formatMoney(due)}</span> : null}
              <ChevronUp aria-hidden className="size-5 shrink-0" />
            </button>
          </SheetTrigger> : <p className="flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm text-muted-foreground"><ReceiptText aria-hidden className="size-5 shrink-0" />No items yet</p>}
          {quickCash ? (
            <button
              type="button"
              data-testid="bar-cash"
              onClick={() => { setPayOnOpen("cash"); setSheetOpen(true); }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-foreground px-3 text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[400px]:px-4"
            >
              <span className="text-sm font-semibold">Cash</span>
              <span className={cn("leading-none font-semibold font-sans whitespace-nowrap tabular-nums", cashAmountSize(formatMoney(due)))}>{formatMoney(due)}</span>
            </button>
          ) : null}
        </div>
        {/* --admin-header is set on <html> by the shell, since the sheet is portaled outside it. */}
        <CheckoutSheetContent side="bottom" showCloseButton={false} className={cn(keepHeader ? "max-h-[calc(100dvh-var(--admin-header,6dvh))]" : "max-h-[94dvh]", "h-auto gap-0 rounded-t-2xl border-border/80 bg-card p-0")}>
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Items, totals and payment</SheetDescription>
          {/* The page banner sits under the sheet's overlay, so errors repeat here. */}
          {error || earlierError ? alert(error || earlierError) : null}
          {panel(() => { void closeSheet(); }, payOnOpen)}
        </CheckoutSheetContent>
      </Sheet>
    </div>
  );
}

/** The bar amount's type size: a long total (฿155,386.60) steps down so "View order" keeps its room. */
export function cashAmountSize(amount: string, base = "text-xl") {
  return amount.length > 11 ? "text-base" : amount.length > 8 ? "text-lg" : base;
}

/**
 * The resort's own first villa photo, blurred and muted behind the panes, under a wash of the
 * theme's background so text keeps its contrast in light and dark. Purely decorative and static;
 * without a photo, only the plain background shows.
 */
function Backdrop({ src }: { src?: string }) {
  const photo = useLoadablePhoto(src);
  return (
    <div aria-hidden data-checkout-backdrop="" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {photo.src ? (
        // eslint-disable-next-line react-app/no-raw-img -- decorative, any host
        <img src={photo.src} alt="" decoding="async" onError={photo.onError} className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-3xl saturate-50 dark:opacity-40" />
      ) : null}
      <div className="absolute inset-0 bg-linear-to-b from-background via-background/80 via-40% to-background/70" />
    </div>
  );
}

/** A late refusal can belong to another order; validate it without moving the cashier there. */
function DiscountNoticeTarget({ orderId }: { orderId: OrderId }) {
  const view = useCheckoutBackend().useOrder(orderId, "checkout");
  const approvals = useCheckoutBackend().useOrderApprovals(orderId);
  useCheckoutDraftOrder(orderId, view, approvals);
  return null;
}
