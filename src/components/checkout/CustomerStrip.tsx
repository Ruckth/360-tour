"use client";

import type { Id } from "convex/_generated/dataModel";
import { ChevronDown, Layers, Link2, Plus, Search, UserRound } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useCheckoutBackend, type Attachable, type BillId, type BillView, type Guest } from "./backend";
import type { Run } from "./BillPanel";
import { TOUCH_TARGETS, heldAt } from "./checkout-ui";

type Panel = "guest" | "attach" | "held" | null;

/** Who the bill is for (walk-in by default), attaching their unpaid bookings, and held bills. */
export function CustomerStrip({
  view,
  label,
  run,
  onBillChange,
}: {
  view: BillView | null | undefined;
  label: string;
  run: Run;
  onBillChange: (billId: BillId | null) => void;
}) {
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const openBills = backend.useOpenBills();
  const [panel, setPanel] = useState<Panel>(null);
  const bill = view?.bill;
  const guest: Guest | null = bill?.guestName ? { name: bill.guestName, phone: bill.guestPhone, email: bill.guestEmail } : null;
  const otherBills = (openBills ?? []).filter((b) => b._id !== bill?._id);
  const close = () => setPanel(null);

  function pickGuest(next: Guest | null) {
    close();
    void run((billId) => actions.setCustomer({ billId, guest: next }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 sm:px-6">
      {/* Each button is its dialog's trigger, so closing the dialog puts focus back on it. */}
      <Dialog open={panel === "guest"} onOpenChange={(open) => setPanel(open ? "guest" : null)}>
        <DialogTrigger asChild>
          <Button variant="outline" className="max-w-[60vw]">
            <UserRound aria-hidden className="size-4" />
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent className={cn("max-w-md", TOUCH_TARGETS)}>
          {panel === "guest" ? <GuestPicker hasGuest={Boolean(guest)} onPick={pickGuest} /> : null}
        </DialogContent>
      </Dialog>
      {guest ? (
        <Dialog open={panel === "attach"} onOpenChange={(open) => setPanel(open ? "attach" : null)}>
          <DialogTrigger asChild>
            <Button variant="ghost">
              <Link2 aria-hidden className="size-4" /> Attach booking
            </Button>
          </DialogTrigger>
          <DialogContent className={cn("max-w-lg", TOUCH_TARGETS)}>
            {panel === "attach" ? <AttachList guest={guest} billId={bill?._id} run={run} onDone={close} /> : null}
          </DialogContent>
        </Dialog>
      ) : null}
      <div className="ml-auto flex gap-2">
        <Dialog open={panel === "held"} onOpenChange={(open) => setPanel(open ? "held" : null)}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              aria-label={`Held bills${otherBills.length ? `, ${otherBills.length} other unpaid ${otherBills.length === 1 ? "bill" : "bills"}` : ""}`}
            >
              <Layers aria-hidden className="size-4" />
              <span className="hidden sm:inline">Held bills</span>
              {otherBills.length ? <span aria-hidden className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{otherBills.length}</span> : null}
            </Button>
          </DialogTrigger>
          <DialogContent className={cn("max-w-md", TOUCH_TARGETS)}>
            <DialogHeader>
              <DialogTitle>Held bills</DialogTitle>
              <DialogDescription>Unpaid bills from any device. Open one to carry on.</DialogDescription>
            </DialogHeader>
            {openBills === undefined ? (
              <Spinner label="Loading bills" />
            ) : otherBills.length ? (
              <ul className="grid gap-2">
                {otherBills.map((b) => (
                  <li key={b._id}>
                    <button
                      type="button"
                      onClick={() => { close(); onBillChange(b._id); }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{b.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {b.itemCount} {b.itemCount === 1 ? "item" : "items"} · {b.status === "held" ? "held" : "open"} ·{" "}
                          {heldAt(b.updatedAt)}
                        </span>
                      </span>
                      {/* The bill total; deposits already paid come off what is due once it is open. */}
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] text-muted-foreground">Total</span>
                        <span className="block text-sm font-semibold tabular-nums">{formatMoney(b.total, b.currency)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No other unpaid bills.</p>
            )}
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => onBillChange(null)} disabled={!bill} aria-label="New bill">
          <Plus aria-hidden className="size-4" />
          <span className="hidden sm:inline">New bill</span>
        </Button>
      </div>
    </div>
  );
}

function GuestPicker({ hasGuest, onPick }: { hasGuest: boolean; onPick: (guest: Guest | null) => void }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const results = useCheckoutBackend().useGuestSearch(deferred);
  const typed = query.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Customer</DialogTitle>
        <DialogDescription>Find a guest by name, phone, email or booking code.</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guests" aria-label="Search guests" className="pl-9" autoFocus />
      </div>
      <ul className="grid max-h-72 gap-1 overflow-y-auto">
        {(typed.length >= 2 ? results ?? [] : []).map((guest) => (
          <li key={`${guest.name}|${guest.phone ?? guest.email ?? ""}`}>
            <button type="button" onClick={() => onPick(guest)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted">
              <span className="block text-sm font-semibold">{guest.name}</span>
              <span className="block text-xs text-muted-foreground">{[guest.phone, guest.email].filter(Boolean).join(" · ") || "No contact details"}</span>
            </button>
          </li>
        ))}
        {typed.length >= 2 && results === undefined ? <li className="px-3 py-2"><Spinner label="Searching" /></li> : null}
        {typed ? (
          <li>
            <button type="button" onClick={() => onPick({ name: typed })} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
              Use “{typed}” as the guest name
            </button>
          </li>
        ) : null}
      </ul>
      {hasGuest ? (
        <Button variant="outline" onClick={() => onPick(null)}>Back to walk-in</Button>
      ) : null}
    </>
  );
}

function AttachList({ guest, billId, run, onDone }: { guest: Guest; billId: BillId | undefined; run: Run; onDone: () => void }) {
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const rows = backend.useAttachable(guest);

  // Stays open while the guest has more to attach, so a stay and an appointment take one visit.
  // A failed attach closes the list so the page's error banner isn't hidden behind it.
  async function attach(row: Attachable) {
    const target = row.kind === "booking" ? { bookingId: row.id as Id<"bookings"> } : { appointmentId: row.id as Id<"serviceAppointments"> };
    const more = rows?.some((other) => other.id !== row.id && other.onBill === null);
    const ok = await run((current) => actions.attach({ billId: current, ...target }));
    if (!ok || !more) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attach to {guest.name}&apos;s bill</DialogTitle>
        <DialogDescription>Unpaid stays and appointments for this guest. Only what you attach is charged.</DialogDescription>
      </DialogHeader>
      {rows === undefined ? (
        <Spinner label="Loading bookings" />
      ) : rows.length ? (
        <ul className="grid gap-2">
          {rows.map((row) => {
            const here = row.onBill !== null && row.onBill === billId;
            const elsewhere = row.onBill !== null && !here;
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(row.price)}
                    {row.deposit ? ` · ${formatMoney(row.deposit)} already paid` : ""}
                  </span>
                </span>
                <Button size="sm" variant={here || elsewhere ? "ghost" : "default"} disabled={here || elsewhere} onClick={() => attach(row)}>
                  {here ? "On this bill" : elsewhere ? "On another bill" : "Attach"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No unpaid bookings or appointments found for this guest.</p>
      )}
      <Button variant="outline" onClick={onDone}>Done</Button>
    </>
  );
}
