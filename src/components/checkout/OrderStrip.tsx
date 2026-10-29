"use client";

import type { Id } from "convex/_generated/dataModel";
import { CalendarDays, Link2, ListOrdered, Plus, Search, UserRound, UserRoundPlus, X } from "lucide-react";
import { useDeferredValue, useRef, useState, type FormEvent } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { formatReceiptNumber } from "convex/lib/billMath";
import { useCheckoutBackend, type Attachable, type Customer, type CustomerId, type NewCustomer, type OrderFilter, type OrderId, type OrderView } from "./backend";
import { TOUCH_TARGETS, orderTime } from "./checkout-ui";
import { InlineErrorBoundary } from "./ErrorBoundary";
import type { Run } from "./useOrderWrites";

type Panel = "customer" | "booking" | "orders" | null;

/**
 * The order on screen: its number (or "New order"), the booking it belongs to and, separately,
 * the customer who pays, plus Orders (unpaid, paid, voided) and New order. The booking's guest
 * and the customer can be different people; linking a customer never changes the booking.
 */
export function OrderStrip({
  view,
  title,
  run,
  onOrderChange,
}: {
  view: OrderView | null | undefined;
  title: string;
  run: Run;
  onOrderChange: (orderId: OrderId | null) => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const [panel, setPanel] = useState<Panel>(null);
  const order = view?.order;
  // The order's own booking, else the first it charges; `more` counts the other bookings it charges.
  const source = view?.source ?? null;
  const more = Math.max((view?.sources.length ?? 0) - 1, 0);
  const customer = view?.customer ?? null;
  const dialogSession = useRef(0);
  const changePanel = (next: Panel) => {
    dialogSession.current += 1;
    setPanel(next);
  };
  const close = () => changePanel(null);

  // Customer writes go through the order's write queue like every other change. The dialog stays
  // open until they succeed, and a failure is shown in the dialog with what was typed kept.
  async function link(customerId: CustomerId): Promise<string | null> {
    const session = dialogSession.current;
    const outcome: { error: string | null } = { error: null };
    await run(async (orderId) => {
      try {
        return await actions.linkCustomer({ orderId, customerId });
      } catch (err) {
        outcome.error = errorText(err, "Couldn't link the customer. Try again.");
        return null;
      }
    }, () => {
      // The queue guards the original order; this token also guards a reopened dialog.
      if (outcome.error === null && dialogSession.current === session) close();
    });
    return outcome.error;
  }
  /**
   * Creates the profile, then links it. When the profile was saved but linking failed, its id is
   * returned so a retry only links it and never saves the same person twice.
   */
  async function create(details: NewCustomer, saved?: CustomerId): Promise<CreateOutcome> {
    const session = dialogSession.current;
    const outcome: CreateOutcome = { customerId: saved, error: null };
    await run(async (orderId) => {
      let customerId = saved;
      try {
        customerId ??= await actions.createCustomer(details);
      } catch (err) {
        outcome.error = errorText(err, "Couldn't save the customer. Try again.");
        return null;
      }
      outcome.customerId = customerId;
      try {
        return await actions.linkCustomer({ orderId, customerId });
      } catch (err) {
        outcome.error = `${details.name.trim()} is saved as a customer but isn't linked to this order yet: ${errorText(err, "the link didn't save.")} Try again to link them.`;
        return null;
      }
    }, () => {
      // The queue guards the original order; this token also guards a reopened dialog.
      if (outcome.error === null && dialogSession.current === session) close();
    });
    return outcome;
  }
  function unlink() {
    close();
    void run(async (orderId) => (orderId ? actions.unlinkCustomer({ orderId }) : null));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2 sm:px-6">
      <div className="min-w-0 max-w-full">
        <p className="text-sm font-semibold" data-testid="order-title">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {source ? (
            <>
              <CalendarDays aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
              {source.name} · {source.reference}
              {source.guestName ? ` · Guest: ${source.guestName}` : ""}
              {more ? ` · +${more} more ${more === 1 ? "booking" : "bookings"}` : ""}
            </>
          ) : (
            "No booking"
          )}
          {view?.parentOrder ? ` · Follows ${view.parentOrder.title}` : ""}
        </p>
      </div>

      {/* Each button is its dialog's trigger, so closing the dialog puts focus back on it. */}
      <Dialog open={panel === "customer"} onOpenChange={(open) => changePanel(open ? "customer" : null)}>
        <DialogTrigger asChild>
          <Button variant="outline" className="max-w-[60vw]" aria-label={customer ? `Customer: ${customer.name}. Change customer` : "Add customer"}>
            {customer ? <UserRound aria-hidden className="size-4" /> : <UserRoundPlus aria-hidden className="size-4" />}
            <span className="truncate">{customer ? customer.name : "Add customer"}</span>
          </Button>
        </DialogTrigger>
        <DialogContent className={cn("max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto", TOUCH_TARGETS)}>
          {panel === "customer" ? <CustomerPicker view={view ?? null} onLink={link} onCreate={create} onUnlink={unlink} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "booking"} onOpenChange={(open) => changePanel(open ? "booking" : null)}>
        <DialogTrigger asChild>
          <Button variant="ghost">
            <Link2 aria-hidden className="size-4" /> Add booking
          </Button>
        </DialogTrigger>
        <DialogContent className={cn("max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto", TOUCH_TARGETS)}>
          {panel === "booking" ? <AttachList orderId={order?._id ?? null} run={run} onDone={close} /> : null}
        </DialogContent>
      </Dialog>

      <div className="ml-auto flex gap-2">
        <Dialog open={panel === "orders"} onOpenChange={(open) => changePanel(open ? "orders" : null)}>
          <DialogTrigger asChild>
            <Button variant="ghost">
              <ListOrdered aria-hidden className="size-4" />
              <span>Orders</span>
            </Button>
          </DialogTrigger>
          <DialogContent className={cn("max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto", TOUCH_TARGETS)}>
            <DialogHeader>
              <DialogTitle>Orders</DialogTitle>
              <DialogDescription>Open an unpaid order to keep selling or take payment, or a paid one to see its receipt. Saved orders reopen here on any device.</DialogDescription>
            </DialogHeader>
            {panel === "orders" ? <OrdersBrowser currentId={order?._id} onOpen={(id) => { close(); onOrderChange(id); }} /> : null}
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => onOrderChange(null)} disabled={!order} aria-label="New order">
          <Plus aria-hidden className="size-4" />
          <span className="hidden sm:inline">New order</span>
        </Button>
      </div>
    </div>
  );
}

const EMPTY_FORM: NewCustomer = { name: "", phone: "", email: "" };

/** The result of Add and link: an error to show, and the profile's id once it was saved (even if linking failed). */
type CreateOutcome = { customerId: CustomerId | undefined; error: string | null };
/** Resolves to an error message, or null once linked (the dialog then closes). */
type LinkFn = (customerId: CustomerId) => Promise<string | null>;
type CreateFn = (details: NewCustomer, saved?: CustomerId) => Promise<CreateOutcome>;
type SavedCustomer = { customerId: CustomerId; name: string };

const SEARCH_FAILED = "Couldn't search customers. Check your connection and try again.";

function CustomerPicker({
  view,
  onLink,
  onCreate,
  onUnlink,
}: {
  view: OrderView | null;
  onLink: LinkFn;
  onCreate: CreateFn;
  onUnlink: () => void;
}) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<NewCustomer | null>(null);
  // A profile Add and link saved but couldn't link; offered here so it isn't saved again.
  const [saved, setSaved] = useState<SavedCustomer | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const deferred = useDeferredValue(query);
  const typed = query.trim();
  const current = view?.customer ?? null;
  const source = view?.source ?? null;

  async function pick(customerId: CustomerId) {
    if (linking) return;
    setLinking(true);
    setError("");
    const failed = await onLink(customerId);
    if (failed) {
      setError(failed);
      setLinking(false);
    }
  }

  if (form) return <CustomerForm initial={form} onCancel={() => setForm(null)} onLink={onLink} onCreate={onCreate} onSaved={setSaved} />;

  const fromQuery = (): NewCustomer => {
    if (/^[+\d\s()-]+$/.test(typed)) return { ...EMPTY_FORM, phone: typed };
    if (typed.includes("@")) return { ...EMPTY_FORM, email: typed };
    return { ...EMPTY_FORM, name: typed };
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Customer</DialogTitle>
        <DialogDescription>
          Who pays for this order. Optional, and separate from the booking&apos;s guest. Find a customer by name, phone or email, or add a new one.
        </DialogDescription>
      </DialogHeader>
      {current ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <CustomerLabel customer={current} />
          <Button variant="outline" size="sm" onClick={onUnlink}>
            <X aria-hidden className="size-3.5" /> Remove
          </Button>
        </div>
      ) : null}
      {saved && saved.customerId !== current?._id ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-400/40 dark:bg-amber-400/10">
          <span>{saved.name} is saved as a customer but isn&apos;t linked to this order yet.</span>
          <Button size="sm" disabled={linking} onClick={() => pick(saved.customerId)}>Link</Button>
        </div>
      ) : null}
      {view?.legacyGuest ? (
        <p className="text-xs text-muted-foreground">
          This order was named “{view.legacyGuest.name}” before customers existed. That name is not a customer; link one to keep a record.
        </p>
      ) : null}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers" aria-label="Search customers" className="pl-9" autoFocus />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {/* A failed search stays in this dialog with a retry; the order on screen is untouched. */}
      <InlineErrorBoundary resetKey={deferred.trim()} message={SEARCH_FAILED}>
        <CustomerResults query={deferred} currentId={current?._id} disabled={linking} onPick={pick} />
      </InlineErrorBoundary>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setForm(fromQuery())}>
          <UserRoundPlus aria-hidden className="size-4" /> New customer
        </Button>
        {source?.guestName ? (
          <Button variant="ghost" onClick={() => setForm({ name: source.guestName ?? "", phone: source.guestPhone ?? "", email: source.guestEmail ?? "" })}>
            Use booking guest&apos;s details
          </Button>
        ) : null}
      </div>
    </>
  );
}

function CustomerResults({ query, currentId, disabled, onPick }: { query: string; currentId: CustomerId | undefined; disabled: boolean; onPick: (id: CustomerId) => void }) {
  const results = useCheckoutBackend().useCustomerSearch(query);
  const typed = query.trim();
  return (
    <ul className="grid max-h-72 gap-1 overflow-y-auto" aria-label="Customers">
      {typed.length >= 2 && results === undefined ? <li className="px-3 py-2"><Spinner label="Searching" /></li> : null}
      {(typed.length >= 2 ? results ?? [] : []).map((customer) => (
        <li key={customer._id}>
          <button
            type="button"
            disabled={disabled || customer._id === currentId}
            onClick={() => onPick(customer._id)}
            className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
          >
            <CustomerLabel customer={customer} />
          </button>
        </li>
      ))}
      {typed.length >= 2 && results?.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No customer matches “{typed}”.</li> : null}
    </ul>
  );
}

function CustomerLabel({ customer }: { customer: Pick<Customer, "name" | "phone" | "email"> }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{customer.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}</span>
    </span>
  );
}

/**
 * A new profile. Existing customers with the same phone or email are offered first, so nobody is
 * added twice by accident. Stays open, with what was typed, until the profile is saved and linked.
 * Once saved, a retry only links it, and the details are locked to what was saved.
 */
function CustomerForm({
  initial,
  onCancel,
  onLink,
  onCreate,
  onSaved,
}: {
  initial: NewCustomer;
  onCancel: () => void;
  onLink: LinkFn;
  onCreate: CreateFn;
  onSaved: (customer: SavedCustomer) => void;
}) {
  const [form, setForm] = useState(initial);
  const [savedId, setSavedId] = useState<CustomerId | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Set synchronously, so a double tap can't send a second create before the first re-renders.
  const busy = useRef(false);
  const contact = useDeferredValue((form.phone ?? "").replace(/\D/g, "").length >= 4 ? form.phone ?? "" : (form.email ?? "").includes("@") ? form.email ?? "" : "");
  const set = (key: keyof NewCustomer) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function attempt(task: () => Promise<string | null>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    const failed = await task();
    busy.current = false;
    // On success the dialog closes; nothing to update.
    if (failed) {
      setError(failed);
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    void attempt(async () => {
      const details = { name: form.name, phone: form.phone?.trim() || undefined, email: form.email?.trim() || undefined };
      const { customerId, error: failed } = await onCreate(details, savedId);
      if (failed && customerId && !savedId) {
        setSavedId(customerId);
        onSaved({ customerId, name: details.name.trim() });
      }
      return failed;
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
      <DialogHeader>
        <DialogTitle>New customer</DialogTitle>
        <DialogDescription>Saved as a reusable profile and linked to this order.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="customer-name">Name</Label>
        <Input id="customer-name" value={form.name} onChange={set("name")} maxLength={120} required autoFocus readOnly={Boolean(savedId)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="customer-phone">Phone (optional)</Label>
        <Input id="customer-phone" type="tel" value={form.phone ?? ""} onChange={set("phone")} maxLength={40} readOnly={Boolean(savedId)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="customer-email">Email (optional)</Label>
        <Input id="customer-email" type="email" value={form.email ?? ""} onChange={set("email")} maxLength={200} readOnly={Boolean(savedId)} />
      </div>
      {/* After saving, the new profile itself would match; it isn't offered as a duplicate. */}
      {savedId ? null : (
        <InlineErrorBoundary resetKey={contact} message="Couldn't check for an existing customer with this contact. You can still add the new customer.">
          <ContactMatches contact={contact} disabled={pending} onPick={(id) => void attempt(() => onLink(id))} />
        </InlineErrorBoundary>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Back</Button>
        <Button type="submit" disabled={pending || !form.name.trim()}>
          {pending ? <Spinner label="Saving customer" className="text-current" /> : null}
          {savedId ? "Link customer" : "Add and link"}
        </Button>
      </div>
    </form>
  );
}

function ContactMatches({ contact, disabled, onPick }: { contact: string; disabled: boolean; onPick: (id: CustomerId) => void }) {
  const matches = useCheckoutBackend().useCustomerSearch(contact);
  if (!contact || !matches?.length) return null;
  return (
    <div className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-400/40 dark:bg-amber-400/10">
      <p className="px-1 text-xs font-medium">Already a customer with this contact?</p>
      {matches.map((customer) => (
        <button key={customer._id} type="button" disabled={disabled} onClick={() => onPick(customer._id)} className="rounded-md px-2 py-1.5 text-left hover:bg-amber-100 disabled:opacity-60 dark:hover:bg-amber-400/20">
          <CustomerLabel customer={customer} />
        </button>
      ))}
    </div>
  );
}

function AttachList({ orderId, run, onDone }: { orderId: OrderId | null; run: Run; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a booking</DialogTitle>
        <DialogDescription>
          Unpaid stays and appointments: this order&apos;s booking, the customer&apos;s bookings, or search by reference, phone, email or guest name. Only what you add is charged.
        </DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference, phone, email or name" aria-label="Search bookings" className="pl-9" autoFocus />
      </div>
      {/* A failed lookup (suggestions or search) stays in this dialog with a retry; the order on screen is untouched. */}
      <InlineErrorBoundary resetKey={deferred.trim()} message="Couldn't load bookings. Check your connection and try again.">
        <AttachResults orderId={orderId} query={deferred} run={run} onDone={onDone} />
      </InlineErrorBoundary>
      <Button variant="outline" onClick={onDone}>Done</Button>
    </>
  );
}

function AttachResults({ orderId, query, run, onDone }: { orderId: OrderId | null; query: string; run: Run; onDone: () => void }) {
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const rows = backend.useAttachable({ orderId, query });
  const lookup = backend.useAttachLookupStatus();
  const searching = query.trim().length >= 2;

  // Stays open while there is more to add, so a stay and its appointment take one visit.
  // A failed add closes the list so the page's error banner isn't hidden behind it.
  async function attach(row: Attachable) {
    const target = row.kind === "booking" ? { bookingId: row.id as Id<"bookings"> } : { appointmentId: row.id as Id<"serviceAppointments"> };
    const more = rows?.some((other) => other.id !== row.id && other.onOrder === null && !other.unavailableReason);
    const ok = await run((current) => actions.attach({ orderId: current, ...target }));
    if (!ok || !more) onDone();
  }

  return (
    <>
      {lookup?.complete === false ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-400/40 dark:bg-amber-400/10">
          Some older appointments can&apos;t be found by phone or email yet. Search them by reference or guest name, or ask an admin to finish the appointment lookup migration.
        </p>
      ) : null}
      {rows === undefined && (orderId || searching) ? (
        <Spinner label="Loading bookings" />
      ) : rows?.length ? (
        <ul className="grid max-h-[50dvh] gap-2 overflow-y-auto">
          {rows.map((row) => {
            const here = row.onOrder !== null && row.onOrder._id === orderId;
            const elsewhere = row.onOrder !== null && !here;
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                  <span className="block truncate text-xs text-muted-foreground">Guest: {row.guestName || "Unnamed"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(row.price, row.currency)}
                    {row.deposit ? ` · ${formatMoney(row.deposit, row.currency)} already paid` : ""}
                  </span>
                  {row.unavailableReason ? <span className="mt-1 block text-xs text-destructive">{row.unavailableReason}</span> : null}
                </span>
                <Button size="sm" variant={here || elsewhere ? "ghost" : "default"} disabled={here || elsewhere || Boolean(row.unavailableReason)} onClick={() => attach(row)}>
                  {here ? "On this order" : elsewhere ? `On ${row.onOrder?.title}` : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {searching || orderId ? "No unpaid bookings or appointments found." : "Search for a booking by its reference, the guest's phone, email or name."}
        </p>
      )}
    </>
  );
}

const FILTERS: Array<{ value: OrderFilter; label: string; empty: string }> = [
  { value: "unpaid", label: "Unpaid", empty: "No unpaid orders. Save & close keeps an order here until it is paid." },
  { value: "paid", label: "Paid", empty: "No paid orders yet." },
  { value: "void", label: "Voided", empty: "No voided orders." },
];

function OrdersBrowser({ currentId, onOpen }: { currentId: OrderId | undefined; onOpen: (orderId: OrderId) => void }) {
  const [filter, setFilter] = useState<OrderFilter>("unpaid");
  return (
    <div className="grid gap-3">
      <ToggleGroup value={filter} onValueChange={setFilter} aria-label="Show orders" className="justify-self-start">
        {FILTERS.map((f) => <ToggleGroupItem key={f.value} value={f.value}>{f.label}</ToggleGroupItem>)}
      </ToggleGroup>
      {/* Keyed by filter: each list pages on its own, and a failed one can be retried. */}
      <InlineErrorBoundary key={filter} message="Couldn't load orders. Check your connection and try again.">
        <OrdersList filter={filter} currentId={currentId} onOpen={onOpen} />
      </InlineErrorBoundary>
    </div>
  );
}

const PAGE = 20;

function OrdersList({ filter, currentId, onOpen }: { filter: OrderFilter; currentId: OrderId | undefined; onOpen: (orderId: OrderId) => void }) {
  const { results, status, loadMore } = useCheckoutBackend().useOrders(filter);
  if (status === "LoadingFirstPage") return <Spinner label="Loading orders" />;
  if (!results.length) return <p className="text-sm text-muted-foreground">{FILTERS.find((f) => f.value === filter)!.empty}</p>;
  return (
    <div className="grid gap-2">
      <ul className="max-h-[55dvh] divide-y divide-border overflow-y-auto" aria-label={`${FILTERS.find((f) => f.value === filter)!.label} orders`}>
        {results.map((row) => (
          <li key={row._id}>
            <button
              type="button"
              onClick={() => onOpen(row._id)}
              aria-current={row._id === currentId ? "true" : undefined}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {row.title}
                  {row._id === currentId ? <span className="font-normal text-muted-foreground"> · on screen</span> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.customerName ?? "No customer", row.bookingReference && (row.otherBookings ? `${row.bookingReference} +${row.otherBookings}` : row.bookingReference)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {row.itemCount} {row.itemCount === 1 ? "item" : "items"} · {orderTime(row.updatedAt)}
                  {row.receiptNumber !== undefined ? ` · ${formatReceiptNumber(row.receiptNumber)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] text-muted-foreground">{row.state === "unpaid" ? "Due" : row.state === "paid" ? "Paid" : "Voided"}</span>
                <span className={cn("block text-sm font-semibold tabular-nums", row.state === "void" && "text-muted-foreground line-through")}>
                  {formatMoney(row.state === "unpaid" ? row.due : row.total, row.currency)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE)}>
          {status === "LoadingMore" ? <Spinner label="Loading more orders" className="text-current" /> : null}
          Load more
        </Button>
      ) : null}
    </div>
  );
}
