"use client";

import { ChevronUp, ReceiptText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ApprovalRequestForm, useSendApproval } from "./ApprovalRequest";
import { useCheckoutBackend, type CatalogItem, type OrderId } from "./backend";
import { CatalogPane } from "./CatalogPane";
import { TOUCH_TARGETS } from "./checkout-ui";
import { CheckoutDialogContent, CheckoutSheetContent } from "./CheckoutLayers";
import { useLoadablePhoto } from "./CheckoutPhoto";
import { OrderPanel } from "./OrderPanel";
import { OrderStrip } from "./OrderStrip";
import { errorText } from "@/lib/staff-bookings";
import { needsApproval } from "./staff-approvals";
import { useOrderWrites } from "./useOrderWrites";

/**
 * Staff checkout: the order strip on top (order, booking, customer, Orders), the catalog on the
 * left, the order's items on the right (wide screens) or in a bottom sheet behind a floating
 * total (phones). Data comes from the CheckoutBackend in context, so the admin page and the dev
 * preview render the same UI.
 */
export function CheckoutView({
  orderId,
  onOrderChange,
  onPaid,
  notice,
  onNoticeRetry,
  displayControl,
}: {
  orderId: OrderId | null;
  onOrderChange: (orderId: OrderId | null) => void;
  /** The order was paid here, or opened already paid or void: show its receipt. A redirect, so the page replaces this history entry. */
  onPaid: (orderId: OrderId) => void;
  /** Shown above the catalog, e.g. a refused `?booking=` link. */
  notice?: string;
  onNoticeRetry?: () => void;
  /** The customer display button for the top strip; only the admin page has one. */
  displayControl?: ReactNode;
}) {
  const backend = useCheckoutBackend();
  const catalog = backend.useCatalog();
  const view = backend.useOrder(orderId);
  const actions = backend.useActions();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { run, switchTo, busy } = useOrderWrites(orderId, onOrderChange, setError);
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
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
    (next: OrderId | null) => {
      setSheetOpen(false);
      setSaved("");
      // A failed write belongs to the order it was made on; the next order starts without its banner.
      setError("");
      switchTo(next);
    },
    [switchTo],
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

  // A paid or void order opened by link goes straight to its receipt.
  useEffect(() => {
    if (settled && view) toReceipt(view.order._id);
  }, [settled, view, toReceipt]);

  // The order sheet is for narrow screens only. Rotating an iPad to landscape while it is open
  // would hide the sheet but leave its overlay blocking the page, so close it there.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => {
      if (wide.matches) setSheetOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  const onSaved = useCallback(
    (savedTitle: string) => {
      changeOrder(null);
      setSaved(`${savedTitle} saved. Reopen it from Orders.`);
    },
    [changeOrder],
  );

  // Keyed by order, so opening another order starts from its rows, never a payment begun on the last one.
  const panel = (onClose?: () => void) => (
    <OrderPanel key={orderId ?? "new"} view={missing ? null : view} title={title} catalog={catalog} run={run} busy={busy} onSaved={onSaved} onPaid={toReceipt} onClose={onClose} />
  );

  // Danger-tone colours: red text on the red tint stays ≥4.5:1 (destructive/10 was 3.8:1).
  const alert = (message: string) => (
    <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-6 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-300">
      <span className="flex-1 self-center">{message}</span>
      {!error && onNoticeRetry ? (
        <button type="button" onClick={onNoticeRetry} className="shrink-0 rounded px-2 py-1 font-medium underline">Try again</button>
      ) : null}
      {error ? (
        <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="grid place-items-center rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-400/20">
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
  // A cashier can't open older receipts; the server answers those as missing too.
  const message = error || notice || (missing ? (cashier ? "Not available." : "That order link is invalid or the order no longer exists. Start a new order or choose one from Orders.") : "");

  return (
    <div className={cn("relative isolate flex min-h-0 flex-1 flex-col overflow-y-auto bg-background", TOUCH_TARGETS)}>
      <Backdrop src={catalog?.rooms.find((room) => room.imageUrl)?.imageUrl} />
      <OrderStrip view={missing ? null : view} title={title} run={run} onOrderChange={changeOrder} canStartNew={orderId !== null || Boolean(notice)} displayControl={displayControl} />
      {message ? alert(message) : null}
      {saved && !message ? (
        <p role="status" className="border-b border-border/70 bg-muted/50 px-4 py-2 text-sm text-muted-foreground sm:px-6">{saved}</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {view?.order.state === "discarded" ? <div className="min-w-0 flex-1 p-6"><h2 className="font-serif text-2xl">Discarded order</h2><p className="mt-3 text-sm text-muted-foreground">This order is read only. Open Orders → Discarded to review and restore it. Start a new order to continue selling.</p></div> : <CatalogPane catalog={catalog} lines={lines} onAdd={add} customNeedsManager={customNeedsManager} className="min-w-0 flex-1" />}
        {/* An inset glass panel, wider on bigger screens; the catalog's columns adapt to what is left.
            Without backdrop-filter it stays nearly opaque, so the photo behind never thins the text. */}
        <aside
          aria-label="Order"
          className="mt-1 mr-4 mb-4 hidden w-[380px] shrink-0 overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-xl shadow-navy/10 backdrop-blur-xl supports-[backdrop-filter:blur(1px)]:bg-card/80 lg:flex lg:flex-col xl:w-[440px] 2xl:w-[480px] dark:shadow-black/30"
        >
          {panel()}
        </aside>
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

      {/* The pill is the sheet's trigger, so closing the sheet puts focus back on it. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            // Starts with the visible text, so voice control can say what it sees (WCAG 2.5.3).
            aria-label={`View order ${count} ${count === 1 ? "item" : "items"} ${formatMoney(view?.totals.due ?? 0)} · ${title}, due · open the order`}
            className="fixed inset-x-4 bottom-[calc(1rem+max(var(--admin-tab-bar,0px),env(safe-area-inset-bottom)))] z-30 flex min-h-14 items-center gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-xl shadow-navy/25 lg:hidden dark:shadow-black/40"
          >
            <ReceiptText aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-sm font-semibold">View order</span>{" "}
              <span className="block truncate text-xs opacity-80">{count} {count === 1 ? "item" : "items"}</span>{" "}
            </span>
            <span className="shrink-0 font-serif text-2xl leading-none font-semibold lining-nums tabular-nums">{formatMoney(view?.totals.due ?? 0)}</span>
            <ChevronUp aria-hidden className="size-5 shrink-0" />
          </button>
        </SheetTrigger>
        <CheckoutSheetContent side="bottom" showCloseButton={false} className="h-[94dvh] gap-0 rounded-t-2xl border-border/80 bg-card p-0 lg:hidden">
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Items, totals and payment</SheetDescription>
          {/* The page banner sits under the sheet's overlay, so errors repeat here. */}
          {error ? alert(error) : null}
          {panel(() => setSheetOpen(false))}
        </CheckoutSheetContent>
      </Sheet>
    </div>
  );
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
        // eslint-disable-next-line @next/next/no-img-element -- decorative, any host
        <img src={photo.src} alt="" decoding="async" onError={photo.onError} className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-3xl saturate-50 dark:opacity-40" />
      ) : null}
      <div className="absolute inset-0 bg-linear-to-b from-background via-background/80 via-40% to-background/70" />
    </div>
  );
}
