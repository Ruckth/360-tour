"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { newAttemptKey, useCheckoutBackend, type CheckoutActions, type OrderId } from "./backend";
import { historyTime } from "./OrderHistory";

/** Kept outside the paged list: a successful discard may remove its own row before the response arrives. */
export function OrderLifecycle({ orderId, mode, onDone, onPending, onOpen }: {
  orderId: OrderId; mode: "discard" | "restore"; onDone: () => void;
  onPending: (pending: boolean) => void; onOpen: (id: OrderId) => void;
}) {
  const backend = useCheckoutBackend();
  const view = backend.useOrder(orderId);
  const review = backend.useRestoreCheck(orderId);
  const actions = backend.useActions();
  const [attempt, setAttempt] = useState<Parameters<CheckoutActions["restoreOrder"]>[0] | null>(null);
  const sending = useRef(false);
  const started = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  async function submit(removeConflictingRows = false) {
    if (sending.current || !view) return;
    const input = attempt ?? { orderId, expectedRevision: mode === "restore" ? review!.revision : view.order.revision, idempotencyKey: newAttemptKey(), ...(mode === "restore" ? { removeConflictingRows } : {}) };
    if (!attempt && mode === "restore") setWarnings(review!.conflicts.filter(c => !c.blocking).map(c => c.message));
    setAttempt(input);
    sending.current = true; setPending(true); onPending(true); setError("");
    try {
      if (mode === "discard") await actions.discardOrder(input);
      else { const result = await actions.restoreOrder(input); if (result.warnings.length) setWarnings(result.warnings.map(c => c.message)); setRemoved(result.removed.map(c => c.name)); }
      setDone(true);
    } catch (err) { setError(errorText(err, `Couldn't ${mode} the order. Retry this attempt or review again.`)); }
    finally { sending.current = false; setPending(false); onPending(false); }
  }
  useEffect(() => {
    if (mode === "discard" && view && !started.current) { started.current = true; void submit(); }
    // The first loaded order revision owns this direct discard; reactive updates never restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, view]);
  if (view === undefined || (mode === "restore" && review === undefined)) return <Spinner label="Reviewing order" />;
  if (!view || !review) return <div className="grid gap-3"><p role="alert">Order not found.</p><Button onClick={onDone}>Back to orders</Button></div>;
  if (done) return <div className="grid gap-3" role="status">
    <p>{view.order.title} {mode === "discard" ? "discarded. Contents, customer, links and history are kept. Bookings are not cancelled." : "restored. Review retained rows and any source warnings before payment."}</p>
    {removed.length ? <p>Removed conflicting rows: {removed.join(", ")}. Their snapshots remain in Order history.</p> : null}
    {warnings.length ? <ul className="grid gap-2 text-sm">{warnings.map((message, i) => <li key={i}>{message}</li>)}</ul> : null}
    {mode === "restore" ? <Button onClick={() => onOpen(orderId)}>Open restored order</Button> : null}
    <Button variant="outline" onClick={onDone}>Back to orders</Button>
  </div>;
  return <section aria-label={`${mode === "discard" ? "Discard" : "Restore"} order`} className="grid gap-3">
    <h3 className="font-semibold">{mode === "discard" ? "Discarding" : "Restore"} {view.order.title}</h3>
    <p className="text-sm">Contents, customer and booking links are retained. Bookings and appointments are not cancelled.</p>
    {view.discarded ? <p className="text-xs text-muted-foreground">Discarded {historyTime(view.discarded.at)} by {view.discarded.by ?? "Unknown"}{view.discarded.reason ? ` · ${view.discarded.reason}` : ""}</p> : null}
    {mode === "restore" ? <>
      <p className="text-sm">{view.lines.length} retained rows. Changed or settled sources must be updated or removed before payment.</p>
      <ul className="grid gap-2 text-sm">{review.conflicts.toSorted((a, b) => Number(b.blocking) - Number(a.blocking)).map((conflict, i) => <li key={`${conflict.lineId}:${i}`}>
        <p className={conflict.blocking ? "text-destructive" : "text-muted-foreground"}>{conflict.message}</p>
        {conflict.order ? <Button variant="link" disabled={pending} onClick={() => onOpen(conflict.order!._id)}>Open {conflict.order.title}</Button> : null}
      </li>)}</ul>
      {review.blocking && review.rowsLeft === 0 ? <p role="alert" className="text-sm">Every row conflicts. Leave this order discarded or resolve the competing order first.</p> : null}
      {!attempt ? <Button disabled={pending || !review.discarded || review.rowsLeft === 0} onClick={() => void submit(review.blocking > 0)}>{review.blocking ? `Restore without ${review.blocking} conflicting ${review.blocking === 1 ? "row" : "rows"}` : "Restore order"}</Button> : null}
    </> : null}
    {pending ? <Spinner label={mode === "discard" ? "Discarding order" : "Restoring order"} /> : null}
    {error ? <div role="alert" className="grid gap-2 text-sm"><p className="text-destructive">{error}</p><p>A response may have been lost. Retry uses the same reviewed revision and attempt.</p><Button disabled={pending} onClick={() => void submit()}>Retry {mode}</Button></div> : null}
    <Button variant="outline" disabled={pending} onClick={onDone}>{error ? "Leave and review orders again" : "Back to orders"}</Button>
  </section>;
}
