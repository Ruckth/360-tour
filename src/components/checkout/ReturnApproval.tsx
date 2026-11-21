"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/lib/staff-bookings";
import { useCheckoutBackend, useReturnsDesk, type ReturnPreview, type ReturnQueueRow } from "./backend";
import { returnRefusal } from "./returnable-parts";
import { destinations, quoteDueAt, returnsTillId } from "./returns-desk";
import { voucherMasks } from "./checkout-ui";
import { authorizeLabel, destinationText, returnRefusalText, returnsCopy } from "./returns-desk-copy";
import { minutesLeft, orderRef, personName } from "./staff-approvals";

const { t, money, date } = returnsCopy;

/**
 * A return request that isn't open, from its compact stored summary alone (staffApprovals.pendingPage):
 * who asks, how many parts for how much, and when it expires. No reads; tap to open it.
 */
export function ReturnQueueItem({ request, onSelect }: { request: ReturnQueueRow; onSelect: () => void }) {
  const now = useNow(10_000);
  return (
    <li data-testid="approval-request" data-approval-selected="false" data-return-queued={request._id}>
      <button type="button" onClick={onSelect} className="grid w-full gap-0.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-xs text-muted-foreground">{t("returns.title")}</span>
        <span className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">
          {personName(request.requesterEmail)} {t("returns.approvalAsk", { count: request.summary.partCount, amount: money(request.summary.amount) })}
        </span>
        <span className="text-xs text-muted-foreground">{now >= request.expiresAt ? "Expiring now" : `Expires in ${minutesLeft(request.expiresAt, now)} min`}</span>
      </button>
    </li>
  );
}

/**
 * The open Return items request in Approvals (only the selected one mounts this). The
 * manager decides with everything in view (v27 manager preview): what comes back and for how
 * much, where every baht goes and by when, the cashier's reason, and that the cashier still gives
 * the money back at their own till. Approving authorizes it for that cashier.
 */
export default function ReturnApprovalItem({ request, onResult }: { request: ReturnQueueRow; onResult: (text: string) => void }) {
  const backend = useCheckoutBackend();
  const actions = useReturnsDesk()!.useActions();
  const order = backend.useOrder(request.orderId);
  const detail = backend.useApprovalDetail(request._id);
  const now = useNow(10_000);
  const title = order?.order.title ?? "Order";
  const amount = money(request.summary.amount);
  const cashier = personName(request.requesterEmail);
  const asked = detail && detail.kind === "returnItems" ? detail.request : null;
  const [quote, setQuote] = useState<{ value: ReturnPreview } | { error: string } | null>(null);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);

  // The same quote the cashier saw, read again now: one preview per request and receipt revision.
  const revision = order ? `${order.order.revision}:${order.paymentRecord.correctionRevision}` : null;
  useEffect(() => {
    if (!order || !asked) return;
    let live = true;
    actions.preview({
      orderId: request.orderId, expectedRevision: order.order.revision, expectedCorrectionRevision: order.paymentRecord.correctionRevision,
      clientKey: `approval:${request._id}`, tillId: returnsTillId(), reason: asked.reason || "Return items", parts: asked.parts,
    }).then(
      (value) => { if (live) setQuote({ value }); },
      (err) => { if (live) { const refusal = returnRefusal(err); setQuote({ error: refusal ? returnRefusalText(refusal) : t("returns.couldNotSend") }); } },
    );
    return () => { live = false; };
    // One read per request and receipt revision; actions are stable for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request._id, revision, Boolean(asked)]);

  async function decide(choice: "approve" | "decline") {
    if (lock.current) return;
    lock.current = true;
    setBusy(choice);
    setError("");
    try {
      const result = await actions.decideApproval({ requestId: request._id, decision: choice === "approve" ? "approve" : "reject" });
      const where = orderRef(title);
      onResult(result.status === "authorized" || result.status === "applied" ? t("returns.approvedFor", { amount, order: where })
        : result.status === "rejected" ? t("returns.declinedFor", { order: where })
        : result.status === "expired" ? t("returns.requestExpired") : t("returns.requestStale"));
    } catch (err) {
      const refusal = returnRefusal(err);
      setError(refusal ? returnRefusalText(refusal) : t("returns.couldNotSend"));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const preview = quote && "value" in quote ? quote.value : null;
  const list = preview ? destinations(preview, order ? voucherMasks(order) : undefined) : [];
  const due = preview && order ? quoteDueAt(order, preview) : null;
  // Loading, refusal and quote take the same bounded height, so Approve stays put as the quote resolves.
  const quoteBox = "h-48 overflow-y-auto overscroll-contain rounded-lg p-3 text-sm";
  return (
    <li data-testid="approval-request" data-approval-selected="true" data-return-request={request._id}>
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">{t("returns.title")} · {title}</p>
        <p className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">{cashier} {t("returns.approvalAsk", { count: request.summary.partCount, amount })}</p>
        {preview ? (
          <section aria-label={t("returns.whereItGoes")} data-return-approval-quote="" tabIndex={0}
            className={`${quoteBox} grid content-start gap-2 bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            <ul className="grid gap-1">
              {preview.rows.map((row) => {
                const showParts = row.parts.length > 1 || row.parts.some((part) => part.kind === "restore" || part.kind === "product" || (part.kind === "session" && part.units));
                return (
                <li key={row.lineId} className="grid gap-0.5">
                  <span className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span><span className="font-sans tabular-nums">{money(row.amount)}</span></span>
                  {showParts ? (
                    <ul className="grid gap-0.5 pl-3 text-xs text-muted-foreground" data-return-approval-parts="">
                      {row.parts.map((part, index) => {
                        // A product with no disposition stays with the guest; its quantity still shows.
                        const disposition = part.disposition
                          ? t(part.disposition === "sellable" ? "returns.sellable" : "returns.damaged")
                          : part.kind === "product" ? t("returns.staysWithGuest") : null;
                        const detail = disposition
                          ? part.units ? `${part.units} × ${disposition}` : disposition
                          : part.kind === "session" && part.units
                            ? t("returns.sessionsStopped", { count: part.units })
                            : null;
                        const label = part.kind === "restore" ? t("returns.restoreSession") : detail ? `${part.label} · ${detail}` : part.label;
                        return (
                        <li key={`${part.contentKey ?? part.kind}:${index}`} className="flex justify-between gap-3">
                          <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                          <span className="font-sans tabular-nums">{money(part.amount)}</span>
                        </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
                );
              })}
            </ul>
            <p className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">{t("returns.whereItGoes")}</p>
            <ul className="grid gap-1" data-return-destinations="">
              {list.map((item, index) => <li key={index} className={item.kind === "external" ? "font-semibold" : undefined}>{destinationText(item)}</li>)}
              {!list.some((item) => item.kind !== "restore") ? <li>{t("returns.noPayout")}</li> : null}
            </ul>
            {due ? <p className="text-xs text-muted-foreground" data-return-due="">{t("returns.refundDueBy", { date: date(due) })}</p> : null}
            {list.some((item) => item.kind === "external") ? <p className="font-medium" data-return-payer="">{t("returns.whoGivesBack", { name: cashier })}</p> : null}
          </section>
        ) : quote && "error" in quote ? (
          <p role="status" className={`${quoteBox} bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200`}>{quote.error}</p>
        ) : <div className={`${quoteBox} grid place-items-center bg-muted/50`}><Spinner label="Loading request" /></div>}
        {asked ? <blockquote data-sentence-budget="ignore" className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{asked.reason}”</blockquote> : null}
        <p className="text-xs text-muted-foreground">{now >= request.expiresAt ? "Expiring now" : `Expires in ${minutesLeft(request.expiresAt, now)} min`}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void decide("decline")}>
            {busy === "decline" ? <Spinner label="Declining" className="text-current" /> : null}
            {t("returns.decline")}
          </Button>
          {/* The label names every destination, as the cashier's Authorize does: it wraps inside the card instead of overflowing it. */}
          <Button type="button" className="h-auto min-h-11 w-full min-w-0 shrink whitespace-normal py-2.5 text-balance leading-snug [overflow-wrap:anywhere]"
            disabled={busy !== null || !preview} onClick={() => void decide("approve")} data-return-approve="">
            {busy === "approve" ? <Spinner label="Approving" className="text-current" /> : null}
            {preview ? authorizeLabel(list, true) : t("returns.approveReturn", { amount })}
          </Button>
        </div>
      </div>
    </li>
  );
}
