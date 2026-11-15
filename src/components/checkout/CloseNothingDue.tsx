"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { useCheckoutBackend, newAttemptKey, type CheckoutActions, type OrderId, type OrderView } from "./backend";

export function CloseNothingDue({ view, disabled, onPaid, onReview }: { view: OrderView; disabled: boolean; onPaid: (orderId: OrderId) => void; onReview: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const attempt = useRef<Parameters<CheckoutActions["settleOrder"]>[0] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const withStay = view.sources.some((source) => source.kind === "booking");
  const [notifyGuest, setNotifyGuest] = useState(false);
  async function close() {
    if (pending) return;
    // The order changed since the last try: a new close is a new attempt.
    if (attempt.current && attempt.current.expectedRevision !== view.order.revision) attempt.current = null;
    attempt.current ??= {
      orderId: view.order._id,
      idempotencyKey: newAttemptKey(),
      expectedDue: view.totals.due,
      expectedRevision: view.order.revision,
      expectedCustomerRevision: view.customer && "revision" in view.customer ? view.customer.revision : undefined,
      tenders: [],
      notifyGuest,
    };
    setPending(true);
    setError("");
    try {
      await actions.settleOrder(attempt.current);
      onPaid(attempt.current.orderId);
    } catch (err) {
      setError(errorText(err, "The order didn't close. Try again."));
      setPending(false);
    }
  }
  return (
    <>
      {error ? <p role="alert" className="mb-2 text-sm text-destructive">{error}</p> : null}
      {withStay ? (
        <label className="mb-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={notifyGuest} disabled={pending || Boolean(error)} onChange={(e) => setNotifyGuest(e.target.checked)} />
          Send booking payment confirmation email
        </label>
      ) : null}
      <Button className="h-12 w-full rounded-xl" disabled={disabled || pending} onClick={() => void close()}>
        {pending ? <Spinner label="Closing order" className="text-current" /> : null}
        {error ? "Retry close" : "Close order · nothing due"}
      </Button>
      {/* Staff entering an earlier sale set when it happened on the payment step. */}
      <Button variant="link" size="sm" className="mt-1 h-auto w-full p-0 text-xs text-muted-foreground" disabled={disabled || pending} onClick={onReview}>
        Happened earlier? Set the date
      </Button>
    </>
  );
}

