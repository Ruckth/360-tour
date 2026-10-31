"use client";

import { ChevronUp, ReceiptText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCheckoutBackend, type CatalogItem, type OrderId } from "./backend";
import { CatalogPane } from "./CatalogPane";
import { CHECKOUT_THEME, CHECKOUT_LAYER } from "./checkout-ui";
import { OrderPanel } from "./OrderPanel";
import { OrderStrip } from "./OrderStrip";
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
}: {
  orderId: OrderId | null;
  onOrderChange: (orderId: OrderId | null) => void;
  onPaid: (orderId: OrderId) => void;
  /** Shown above the catalog, e.g. a refused `?booking=` link. */
  notice?: string;
}) {
  const backend = useCheckoutBackend();
  const catalog = backend.useCatalog();
  const view = backend.useOrder(orderId);
  const actions = backend.useActions();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { run, switchTo } = useOrderWrites(orderId, onOrderChange, setError);

  const add = useCallback((item: CatalogItem) => void run((id) => actions.addItem({ orderId: id, item })), [run, actions]);

  const changeOrder = useCallback(
    (next: OrderId | null) => {
      setSheetOpen(false);
      setSaved("");
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
  const settled = view && view.order.state !== "unpaid";

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
    <OrderPanel key={orderId ?? "new"} view={missing ? null : view} title={title} catalog={catalog} run={run} onSaved={onSaved} onPaid={toReceipt} onClose={onClose} />
  );

  // Danger-tone colours: red text on the red tint stays ≥4.5:1 (destructive/10 was 3.8:1).
  const alert = (message: string) => (
    <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-6 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-300">
      <span className="flex-1 self-center">{message}</span>
      {error ? (
        <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="grid place-items-center rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-400/20">
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
  const message = error || notice || (missing ? "That order doesn't exist. Start a new one." : "");

  return (
    <div className={cn("relative isolate flex min-h-0 flex-1 flex-col bg-background", CHECKOUT_LAYER)}>
      <Backdrop src={catalog?.rooms.find((room) => room.imageUrl)?.imageUrl} />
      <OrderStrip view={missing ? null : view} title={title} run={run} onOrderChange={changeOrder} />
      {message ? alert(message) : null}
      {saved && !message ? (
        <p role="status" className="border-b border-border/70 bg-muted/50 px-4 py-2 text-sm text-muted-foreground sm:px-6">{saved}</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <CatalogPane catalog={catalog} lines={lines} onAdd={add} className="min-w-0 flex-1" />
        {/* An inset panel, wider on bigger screens; the catalog's columns adapt to what is left. */}
        <aside
          aria-label="Order"
          className="mt-1 mr-4 mb-4 hidden w-[380px] shrink-0 overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-2xl shadow-black/30 backdrop-blur-xl lg:flex lg:flex-col xl:w-[440px] 2xl:w-[480px]"
        >
          {panel()}
        </aside>
      </div>

      {/* The pill is the sheet's trigger, so closing the sheet puts focus back on it. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={`${title} · ${count} ${count === 1 ? "item" : "items"} · ${formatMoney(view?.totals.due ?? 0)} due · open the order`}
            className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex min-h-14 items-center gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-2xl shadow-black/40 lg:hidden"
          >
            <ReceiptText aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
              {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="shrink-0 font-serif text-2xl leading-none font-semibold lining-nums tabular-nums">{formatMoney(view?.totals.due ?? 0)}</span>
            <ChevronUp aria-hidden className="size-5 shrink-0" />
          </button>
        </SheetTrigger>
        <SheetContent overlayClassName={CHECKOUT_THEME} side="bottom" showCloseButton={false} className={cn("h-[94dvh] gap-0 rounded-t-2xl border-border/80 bg-card p-0 lg:hidden", CHECKOUT_LAYER)}>
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Items, totals and payment</SheetDescription>
          {/* The page banner sits under the sheet's overlay, so errors repeat here. */}
          {error ? alert(error) : null}
          {panel(() => setSheetOpen(false))}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The resort's own first villa photo, blurred to colour behind the panes, under a dark wash so
 * text keeps its contrast. Purely decorative and static; without a photo, only the wash shows.
 */
function Backdrop({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string>();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {src && failed !== src ? (
        // eslint-disable-next-line @next/next/no-img-element -- decorative, any host
        <img src={src} alt="" decoding="async" onError={() => setFailed(src)} className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-3xl saturate-[0.6]" />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,oklch(0.32_0.04_150/0.35),transparent_55%),linear-gradient(to_bottom,var(--background)_0%,color-mix(in_oklch,var(--background)_80%,transparent)_40%,color-mix(in_oklch,var(--background)_70%,transparent)_100%)]" />
    </div>
  );
}
