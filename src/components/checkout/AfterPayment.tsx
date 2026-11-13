"use client";

import { CalendarClock, Check, Link2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REASON_CHIPS } from "@/components/ui/reason-chips";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatReceiptNumber } from "convex/lib/billMath";
import { cn } from "@/lib/utils";
import type { Id } from "convex/_generated/dataModel";
import { newAttemptKey, useCheckoutBackend, type LinkCandidate, type OrderLine, type OrderLink, type OrderView } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { checkoutErrorText } from "./refunds";

/** Paid rows that can be applied to an appointment (service) or stay (room) after payment. */
/** A row with line refunds can't be linked (LINE_HAS_REFUNDS); a linked row has none. */
export const linkTarget = (line: OrderLine) => (line.fee || line.net <= 0 || line.refundedAmountSatang ? null : line.kind === "service" ? "appointment" : line.kind === "room" ? "booking" : null);

/** Linking moves paid money (paymentFix): a cashier links only when the rules allow it. */
export function useCanLink() {
  const access = useStaffAccess();
  return access.role !== "cashier" || access.cashierRules.paymentFix === "cashier";
}

/**
 * After payment, on the receipt line itself: payment, scheduling and booking are separate, so a
 * paid service or room row links to its appointment or stay (pos.linkPaidLine) and unlinks with a
 * reason, right beside its Refund. Screen-only: the printed receipt never changes. Staff who can't
 * link see the link state only.
 */
export function LineLink({ view, line }: { view: OrderView; line: OrderLine }) {
  const [open, setOpen] = useState<"link" | "unlink" | null>(null);
  const canLink = useCanLink();
  const target = linkTarget(line);
  const link = view.links.find((row) => row.lineId === line._id && row.status === "active") ?? null;
  const paid = view.order.status === "paid";
  if (!target || !paid) return null;
  return (
    <>
      {link ? (
        <span data-testid="line-link" className={cn("inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-medium", TONE_LINKED)}>
          <Check aria-hidden className="size-3.5" /> Linked · {link.target.reference}
        </span>
      ) : null}
      {canLink ? (
        link ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 px-3 font-sans text-xs" aria-label={`Unlink ${line.name}`} onClick={() => setOpen("unlink")}>Unlink…</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="h-8 px-3 font-sans text-xs" onClick={() => setOpen("link")}>
            <Link2 aria-hidden className="size-3.5" /> {target === "appointment" ? "Link appointment" : "Link to stay"}
          </Button>
        )
      ) : null}
      {open === "link" ? <LinkDialog view={view} line={line} target={target} onClose={() => setOpen(null)} /> : null}
      {open === "unlink" && link ? <UnlinkDialog view={view} line={line} link={link} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

const TONE_LINKED = "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300";

/** Saves one reviewed write with one attempt key, so a retried click never links or unlinks twice. */
function useOnceWrite() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newAttemptKey());
  const lock = useRef(false);
  async function save(write: (idempotencyKey: string) => Promise<unknown>, fallback: string) {
    if (lock.current) return false;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await write(key.current);
      return true;
    } catch (err) {
      // The key stays: a refused attempt wrote nothing, and one whose answer was lost replays.
      setError(checkoutErrorText(err, fallback));
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return { saving, error, save };
}

function LinkDialog({ view, line, target, onClose }: { view: OrderView; line: OrderLine; target: "appointment" | "booking"; onClose: () => void }) {
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<LinkCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [notifyGuest, setNotifyGuest] = useState(false);
  const candidates = backend.useLinkCandidates({ orderId: view.order._id, lineId: line._id, query });
  const cashier = useStaffAccess().role === "cashier";
  // The only appointment or stay that fits opens straight on its review; Back still shows the list.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || query || !candidates) return;
    autoPicked.current = true;
    const fits = candidates.filter((candidate) => !candidate.problem);
    if (fits.length === 1) setChosen(fits[0]);
  }, [candidates, query]);
  const { saving, error, save } = useOnceWrite();
  const what = target === "appointment" ? "appointment" : "stay";

  async function confirm() {
    if (!chosen) return;
    const ok = await save((idempotencyKey) => actions.linkPaidLine({
      orderId: view.order._id, lineId: line._id,
      ...(chosen.kind === "appointment" ? { appointmentId: chosen.id as Id<"serviceAppointments"> } : { bookingId: chosen.id as Id<"bookings"> }),
      expectedCorrectionRevision: view.paymentRecord.correctionRevision, expectedTargetRevision: chosen.revision, idempotencyKey, reason,
      ...(chosen.kind === "booking" ? { notifyGuest } : {}),
    }), `Couldn't link this ${what}.`);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <CheckoutDialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{chosen ? `Review link · ${line.name}` : `Link ${line.name} to its ${what}`}</DialogTitle>
          <DialogDescription>{formatMoney(line.net)} paid on {view.order.title}, receipt {formatReceiptNumber(view.order.receiptNumber ?? 0)}.</DialogDescription>
        </DialogHeader>
        {chosen ? (
          <Review view={view} line={line} chosen={chosen} />
        ) : (
          <div className="grid gap-3">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={`Find the ${what}`} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference, phone, email or guest name" autoFocus />
            </div>
            {candidates === undefined ? <Spinner label="Searching" /> : null}
            {candidates?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {target === "appointment" ? "unpaid appointments" : "stays"} found.
                {cashier ? null : (
                  <>
                    {" "}
                    <a className="underline" href={target === "appointment" ? adminStaffTabPath("calendar") : "/admin/hotel"} target="_blank" rel="noreferrer">
                      {target === "appointment" ? "Book an appointment" : "Create a booking"}
                    </a>
                    , then search again.
                  </>
                )}
              </p>
            ) : null}
            <ul className="grid max-h-80 gap-2 overflow-y-auto">
              {candidates?.map((candidate) => (
                <li key={candidate.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3 text-sm" data-testid="link-candidate">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{candidate.name}</span>
                    <span className="block text-xs text-muted-foreground">{candidate.detail} · {candidate.guestName} · {candidate.kind === "booking" ? `owes ${formatMoney(candidate.owed)}` : formatMoney(candidate.price)}</span>
                    {candidate.problem ? <span className="block text-xs text-amber-800 dark:text-amber-300">{candidate.problem}</span> : null}
                  </span>
                  <Button size="sm" variant="outline" disabled={Boolean(candidate.problem)} onClick={() => setChosen(candidate)}>
                    {candidate.problem ? "Can't link" : "Review"}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {chosen ? (
          <div className="grid gap-2">
            <ReasonField value={reason} onChange={setReason} chips={REASON_CHIPS.link} id={`link-reason-${line._id}`} disabled={saving} />
            {chosen.kind === "booking" ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={notifyGuest} disabled={saving} onChange={(e) => setNotifyGuest(e.target.checked)} />
                Send booking payment confirmation email
              </label>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {chosen ? <Button variant="outline" disabled={saving} onClick={() => setChosen(null)}>Back</Button> : <Button variant="outline" onClick={onClose}>Cancel</Button>}
          {chosen ? (
            <Button disabled={!reason.trim() || saving} onClick={confirm}>
              {saving ? <Spinner className="text-current" /> : <Check aria-hidden className="size-4" />} Confirm link
            </Button>
          ) : null}
        </DialogFooter>
      </CheckoutDialogContent>
    </Dialog>
  );
}

/** What the link changes, before it is confirmed. (The receipt, its tenders and total never change; no new payment is taken.) */
function Review({ view, line, chosen }: { view: OrderView; line: OrderLine; chosen: LinkCandidate }) {
  const planned = line.schedule?.date;
  const after = Math.max(chosen.owed - line.net, 0);
  return (
    <div className="grid gap-2 text-sm" data-testid="link-review">
      <p className="font-medium">{chosen.name} · {chosen.detail} · {chosen.guestName}</p>
      {chosen.kind === "appointment" ? (
        <>
          <p>Appointment: unpaid {formatMoney(chosen.price)} → paid {formatMoney(line.net)} by {view.order.title}</p>
          {chosen.price !== line.net ? <p className="text-amber-800 dark:text-amber-300">The appointment price {formatMoney(chosen.price)} becomes {formatMoney(line.net)}, what this order charged for it.</p> : null}
          {planned && chosen.date && planned !== chosen.date ? (
            <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300"><CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" /> The row was planned for {planned}; the appointment is on {chosen.date}.</p>
          ) : null}
        </>
      ) : (
        <p>Stay: owes {formatMoney(chosen.owed)} → {after ? `still owes ${formatMoney(after)}` : "paid"} · adds a checkout payment of {formatMoney(line.net)} from {view.order.title}</p>
      )}
    </div>
  );
}

function UnlinkDialog({ view, line, link, onClose }: { view: OrderView; line: OrderLine; link: OrderLink; onClose: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const [reason, setReason] = useState("");
  const { saving, error, save } = useOnceWrite();
  async function confirm() {
    const ok = await save((idempotencyKey) => actions.unlinkPaidLine({
      orderId: view.order._id, linkId: link._id, expectedCorrectionRevision: view.paymentRecord.correctionRevision, idempotencyKey, reason,
    }), "Couldn't undo the link.");
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <CheckoutDialogContent role="alertdialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unlink {line.name} from {link.target.reference}?</DialogTitle>
          <DialogDescription>
            The {link.kind === "appointment" ? "appointment goes back to unpaid" : "stay loses this payment"}; the receipt stays as issued.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`unlink-reason-${link._id}`}>Reason</Label>
          <Textarea id={`unlink-reason-${link._id}`} value={reason} maxLength={500} disabled={saving} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || saving} onClick={confirm}>
            {saving ? <Spinner className="text-current" /> : null} Unlink
          </Button>
        </DialogFooter>
      </CheckoutDialogContent>
    </Dialog>
  );
}
