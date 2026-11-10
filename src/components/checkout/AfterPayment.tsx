"use client";

import { CalendarClock, Check, Link2, Search } from "lucide-react";
import { useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { formatReceiptNumber } from "convex/lib/billMath";
import { cn } from "@/lib/utils";
import type { Id } from "convex/_generated/dataModel";
import { newAttemptKey, useCheckoutBackend, type LinkCandidate, type OrderLine, type OrderLink, type OrderView } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { scheduleLabel } from "./checkout-ui";

/** Paid rows that can be applied to an appointment (service) or stay (room) after payment. */
const linkTarget = (line: OrderLine) => (line.fee || line.net <= 0 ? null : line.kind === "service" ? "appointment" : line.kind === "room" ? "booking" : null);

/**
 * After payment: payment, scheduling and booking are separate. Each paid service or room row can be
 * linked to its appointment or stay (pos.linkPaidLine) and unlinked with a reason. Outside the
 * printed receipt, which never changes.
 */
export function AfterPayment({ view }: { view: OrderView }) {
  const rows = view.lines.filter((line) => linkTarget(line));
  if (!rows.length) return null;
  const active = new Map(view.links.filter((link) => link.status === "active").map((link) => [link.lineId, link]));
  const services = rows.filter((line) => line.kind === "service");
  const rooms = rows.filter((line) => line.kind === "room");
  const unlinkedServices = services.filter((line) => !active.has(line._id)).length;
  const unlinkedRooms = rooms.filter((line) => !active.has(line._id)).length;
  const paid = view.order.status === "paid";
  return (
    <section aria-label="After payment" className="grid w-full max-w-md gap-3 print:hidden">
      <h2 className="font-semibold">After payment</h2>
      <dl className="grid gap-1 text-sm">
        <Status label="Payment" value={paid ? `Paid · ${formatReceiptNumber(view.order.receiptNumber ?? 0)}` : "Void"} done={paid} />
        {services.length ? <Status label="Scheduling" value={unlinkedServices ? `${unlinkedServices} to link to an appointment` : "Linked"} done={!unlinkedServices} /> : null}
        {rooms.length ? <Status label="Booking" value={unlinkedRooms ? `${unlinkedRooms} not applied to a stay` : "Applied to a stay"} done={!unlinkedRooms} /> : null}
      </dl>
      <ul className="grid gap-2">
        {rows.map((line) => <LinkRow key={line._id} view={view} line={line} link={active.get(line._id) ?? null} paid={paid} />)}
      </ul>
    </section>
  );
}

function Status({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", done ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300")}>{value}</dd>
    </div>
  );
}

function LinkRow({ view, line, link, paid }: { view: OrderView; line: OrderLine; link: OrderLink | null; paid: boolean }) {
  const [open, setOpen] = useState<"link" | "unlink" | null>(null);
  const target = linkTarget(line)!;
  const when = line.kind === "service" ? scheduleLabel(line.schedule) : null;
  return (
    <li className="grid gap-1 rounded-lg border border-border p-3 text-sm" data-testid="after-payment-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{line.name}{line.qty > 1 ? ` ×${line.qty}` : ""} · {formatMoney(line.net)}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", link ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300")}>
          {link ? `Linked · ${link.target.reference}` : target === "appointment" ? "No appointment" : "No stay"}
        </span>
      </div>
      {when ? <p className="text-xs text-muted-foreground">Planned: {when}</p> : null}
      {link ? <p className="text-xs text-muted-foreground">{link.target.name}{link.target.guestName ? ` · ${link.target.guestName}` : ""} · by {link.linkedBy}</p> : null}
      {paid ? (
        <div>
          {link ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen("unlink")}>Unlink…</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen("link")}>
              <Link2 aria-hidden className="size-3.5" /> {target === "appointment" ? "Link appointment" : "Link to stay"}
            </Button>
          )}
        </div>
      ) : null}
      {open === "link" ? <LinkDialog view={view} line={line} target={target} onClose={() => setOpen(null)} /> : null}
      {open === "unlink" && link ? <UnlinkDialog view={view} line={line} link={link} onClose={() => setOpen(null)} /> : null}
    </li>
  );
}

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
      setError(errorText(err, fallback));
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
                No {target === "appointment" ? "unpaid appointments" : "stays"} found.{" "}
                <a className="underline" href={target === "appointment" ? adminStaffTabPath("calendar") : "/admin/hotel"} target="_blank" rel="noreferrer">
                  {target === "appointment" ? "Book an appointment" : "Create a booking"}
                </a>
                , then search again.
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
            <Label htmlFor={`link-reason-${line._id}`}>Reason (required)</Label>
            <Textarea id={`link-reason-${line._id}`} value={reason} maxLength={500} disabled={saving} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest booked the prepaid massage for Thursday" />
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

/** What the link changes and what it leaves alone, before it is confirmed. */
function Review({ view, line, chosen }: { view: OrderView; line: OrderLine; chosen: LinkCandidate }) {
  const receipt = formatReceiptNumber(view.order.receiptNumber ?? 0);
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
      <p className="text-muted-foreground">Not changed: receipt {receipt}, its tenders and total. No new payment is taken.</p>
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
          <Label htmlFor={`unlink-reason-${link._id}`}>Reason (required)</Label>
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
