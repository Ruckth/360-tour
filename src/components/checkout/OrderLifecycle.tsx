"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { newAttemptKey, useCheckoutBackend, type CheckoutActions, type OrderView, type OrderId } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { historyTime } from "./OrderHistory";

/** "Order #1042" → "Discard order #1042?" */
export function discardQuestion(title: string) {
  return `Discard ${title.replace(/^Order\b/, "order")}?`;
}

/**
 * The confirm behind ⋯ › Discard order…, naming the order. One attempt per open: a retry after a
 * lost answer sends the same revision and key, so the order is discarded once. On success the
 * order on screen turns read only (its contents, customer, links and history are kept).
 */
export function DiscardOrderDialog({ view, onClose }: { view: Pick<OrderView, "order">; onClose: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const attempt = useRef<Parameters<CheckoutActions["discardOrder"]>[0] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function discard() {
    if (pending) return;
    attempt.current ??= { orderId: view.order._id, expectedRevision: view.order.revision, idempotencyKey: newAttemptKey() };
    setPending(true);
    setError("");
    try {
      await actions.discardOrder(attempt.current);
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn't discard the order. Try again."));
      setPending(false);
    }
  }
  return (
    <CheckoutDialogContent role="alertdialog" showCloseButton={false} className="max-w-md" onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{discardQuestion(view.order.title)}</DialogTitle>
        <DialogDescription>Its contents and history are kept, and you can restore it from Discarded.</DialogDescription>
      </DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={onClose}>Keep</Button>
        <Button variant="destructive" disabled={pending} onClick={() => void discard()}>
          {pending ? <Spinner label="Discarding order" className="text-current" /> : null}
          {error ? "Retry discard" : "Discard"}
        </Button>
      </DialogFooter>
    </CheckoutDialogContent>
  );
}

/** Restore… on a discarded order: reviews rows now on another order first. */
export function OrderLifecycle({ orderId, onDone, onPending, onOpen }: {
  orderId: OrderId; onDone: () => void;
  onPending: (pending: boolean) => void; onOpen: (id: OrderId) => void;
}) {
  const backend = useCheckoutBackend();
  const view = backend.useOrder(orderId);
  const review = backend.useRestoreCheck(orderId);
  const actions = backend.useActions();
  const [attempt, setAttempt] = useState<Parameters<CheckoutActions["restoreOrder"]>[0] | null>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  async function submit(removeConflictingRows = false) {
    if (sending.current || !view || !review) return;
    if (!attempt && (view.order.revision !== review.revision || !review.discarded || review.rowsLeft === 0)) return;
    const input = attempt ?? {
      orderId, expectedRevision: view.order.revision, idempotencyKey: newAttemptKey(), removeConflictingRows,
      reviewedConflictLineIds: review.conflicts.flatMap(c => c.blocking && c.lineId ? [c.lineId] : []),
    };
    if (!attempt) setWarnings(review.conflicts.filter(c => !c.blocking).map(c => c.message));
    setAttempt(input);
    sending.current = true; setPending(true); onPending(true); setError("");
    try {
      const result = await actions.restoreOrder(input);
      if (result.warnings.length) setWarnings(result.warnings.map(c => c.message));
      setRemoved(result.removed.map(c => c.name));
      setDone(true);
    } catch (err) { setError(errorText(err, "Couldn't restore the order. Retry this attempt or review again.")); }
    finally { sending.current = false; setPending(false); onPending(false); }
  }
  if (view === undefined || review === undefined) return <Spinner label="Reviewing order" />;
  if (!view || !review) return <div className="grid gap-3"><p role="alert">Order not found.</p><Button onClick={onDone}>Back to orders</Button></div>;
  if (done) return <div className="grid gap-3" role="status">
    <p>{view.order.title} restored. Review retained rows and any source warnings before payment.</p>
    {removed.length ? <p>Removed conflicting rows: {removed.join(", ")}. Their snapshots remain in Order history.</p> : null}
    {warnings.length ? <ul className="grid gap-2 text-sm">{warnings.map((message, i) => <li key={i}>{message}</li>)}</ul> : null}
    <Button onClick={() => onOpen(orderId)}>Open restored order</Button>
    <Button variant="outline" onClick={onDone}>Back to orders</Button>
  </div>;
  const removing = new Set(review.conflicts.filter(conflict => conflict.blocking).map(conflict => conflict.lineId));
  return <section aria-label="Restore order" className="grid gap-3">
    <h3 className="font-semibold">Restore {view.order.title}</h3>
    <p className="text-sm">Contents, customer and booking links are retained. Bookings and appointments are not cancelled.</p>
    {view.discarded ? <p className="text-xs text-muted-foreground">Discarded {historyTime(view.discarded.at)} by {view.discarded.by ?? "Unknown"}{view.discarded.reason ? ` · ${view.discarded.reason}` : ""}</p> : null}
    <>
      {view.order.revision === review.revision ? [false, true].map(remove => {
        const rows = view.lines.filter(line => removing.has(line._id) === remove);
        return <div key={String(remove)}><h4 className="font-medium">{remove ? "Remove" : "Keep"}</h4>{rows.length ? <ul className="list-disc pl-5 text-sm">{rows.map(line => <li key={line._id}>{line.name} × {line.qty}</li>)}</ul> : <p className="text-sm text-muted-foreground">No items</p>}</div>;
      }) : <p role="status">Refreshing the order review…</p>}
      <ul className="grid gap-2 text-sm">{review.conflicts.toSorted((a, b) => Number(b.blocking) - Number(a.blocking)).map((conflict, i) => <li key={`${conflict.lineId}:${i}`}>
        <p className={conflict.blocking ? "text-destructive" : "text-muted-foreground"}>{conflict.message}</p>
        {conflict.order ? <Button variant="link" disabled={pending} onClick={() => onOpen(conflict.order!._id)}>Open {conflict.order.title}</Button> : null}
      </li>)}</ul>
      {review.blocking && review.rowsLeft === 0 ? <p role="alert" className="text-sm">Every row conflicts. Leave this order discarded or resolve the competing order first.</p> : null}
      {!attempt ? <Button disabled={pending || view.order.revision !== review.revision || !review.discarded || review.rowsLeft === 0} onClick={() => void submit(review.blocking > 0)}>{review.blocking ? `Restore without ${review.blocking} conflicting ${review.blocking === 1 ? "row" : "rows"}` : "Restore order"}</Button> : null}
    </>
    {pending ? <Spinner label="Restoring order" /> : null}
    {error ? <div role="alert" className="grid gap-2 text-sm"><p className="text-destructive">{error}</p><p>A response may have been lost. Retry uses the same reviewed revision and attempt.</p><Button disabled={pending} onClick={() => void submit()}>Retry restore</Button></div> : null}
    <Button variant="outline" disabled={pending} onClick={onDone}>{error ? "Leave and review orders again" : "Back to orders"}</Button>
  </section>;
}
