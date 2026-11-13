"use client";

import type { Id } from "convex/_generated/dataModel";
import { CalendarDays, ChevronRight, Link2, ListOrdered, Plus, Search, UserRound, UserRoundPlus, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText } from "@/lib/staff-bookings";
import { customerPhoneError } from "convex/shared/phone";
import { cn } from "@/lib/utils";
import { formatReceiptNumber } from "convex/shared/orderMath";
import { useCheckoutBackend, type Attachable, type Customer, type CustomerId, type NewCustomer, type OrderFilter, type OrderId, type OrderView } from "./backend";
import { orderTime } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { InlineErrorBoundary } from "./ErrorBoundary";
import type { Run } from "./useOrderWrites";
import { OrderLifecycle } from "./OrderLifecycle";
import { CustomerDetails } from "./CustomerDetails";

type Panel = "customer" | "booking" | "orders" | null;

/**
 * The order on screen: its number (or "New order", on narrow screens only; wide ones show it in
 * the order panel), the booking it belongs to and, separately, the customer who pays, plus Orders
 * (unpaid, paid, voided) and New order. The booking's guest and the customer can be different
 * people; linking a customer never changes the booking.
 */
export function OrderStrip({
  view,
  title,
  run,
  onOrderChange,
  canStartNew = false,
  displayControl,
}: {
  view: OrderView | null | undefined;
  title: string;
  run: Run;
  onOrderChange: (orderId: OrderId | null) => void;
  /** Invalid/missing source links can be cleared even when there is no loaded order. */
  canStartNew?: boolean;
  /** Rendered beside Orders, e.g. the customer display button (not in the dev preview). */
  displayControl?: ReactNode;
}) {
  const actions = useCheckoutBackend().useActions();
  // Cashiers can't list orders (an operations area); they open one by its number.
  const cashier = useStaffAccess().role === "cashier";
  const [panel, setPanel] = useState<Panel>(null);
  const [ordersPending, setOrdersPending] = useState(false);
  const [customerPending, setCustomerPending] = useState(false);
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2 sm:px-6">
      <div className="min-w-0 max-w-full">
        {/* Wide screens name the order once, in the order panel beside the catalog (shown from lg). */}
        <p className="text-sm font-semibold lg:hidden" data-testid="order-title">{title}</p>
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
      <Dialog open={panel === "customer"} onOpenChange={(open) => { if (!customerPending) changePanel(open ? "customer" : null); }}>
        <DialogTrigger asChild>
          <Button variant="outline" className="max-w-[60vw]" disabled={order?.state === "discarded"} aria-label={customer ? `Customer: ${customer.name}. Change customer` : "Add customer"}>
            {customer ? <UserRound aria-hidden className="size-4" /> : <UserRoundPlus aria-hidden className="size-4" />}
            <span className="truncate">{customer ? customer.name : "Add customer"}</span>
          </Button>
        </DialogTrigger>
        <CheckoutDialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
          {panel === "customer" ? <CustomerPicker view={view ?? null} onLink={link} onCreate={create} onUnlink={unlink} onPending={setCustomerPending} /> : null}
        </CheckoutDialogContent>
      </Dialog>

      <Dialog open={panel === "booking"} onOpenChange={(open) => changePanel(open ? "booking" : null)}>
        <DialogTrigger asChild>
          <Button variant="ghost" disabled={order?.state === "discarded"}>
            <Link2 aria-hidden className="size-4" /> Add booking
          </Button>
        </DialogTrigger>
        <CheckoutDialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          {panel === "booking" ? <AttachList orderId={order?._id ?? null} run={run} onDone={close} /> : null}
        </CheckoutDialogContent>
      </Dialog>

      <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
        {displayControl}
        <Dialog open={panel === "orders"} onOpenChange={(open) => { if (!ordersPending) changePanel(open ? "orders" : null); }}>
          <DialogTrigger asChild>
            <Button variant="ghost">
              <ListOrdered aria-hidden className="size-4" />
              <span>Orders</span>
            </Button>
          </DialogTrigger>
          <CheckoutDialogContent onEscapeKeyDown={(e) => { if (ordersPending) e.preventDefault(); }} onPointerDownOutside={(e) => { if (ordersPending) e.preventDefault(); }} panel className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Orders</DialogTitle>
              <DialogDescription>{cashier ? "Open an unpaid order or one of today’s receipts by its number." : "Open an unpaid order to keep selling or take payment, or a paid one to see its receipt. Saved orders reopen here on any device."}</DialogDescription>
            </DialogHeader>
            {panel === "orders" ? (cashier ? <OrderLookup onOpen={(id) => { close(); onOrderChange(id); }} /> : <OrdersBrowser onPending={setOrdersPending} currentId={order?._id} onOpen={(id) => { close(); onOrderChange(id); }} />) : null}
          </CheckoutDialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => onOrderChange(null)} disabled={!order && !canStartNew} aria-label="New order">
          <Plus aria-hidden className="size-4" />
          <span>New order</span>
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
  onPending,
}: {
  view: OrderView | null;
  onLink: LinkFn;
  onCreate: CreateFn;
  onUnlink: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<NewCustomer | null>(null);
  // A profile Add and link saved but couldn't link; offered here so it isn't saved again.
  const [saved, setSaved] = useState<SavedCustomer | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [profileId, setProfileId] = useState<CustomerId | null>(null);
  const [archived, setArchived] = useState(false);
  const deferred = useDeferredValue(query);
  const typed = query.trim();
  const current = view?.customer ?? null;
  const source = view?.source ?? null;
  // Cashiers get contact cards only: no profiles, history or archive (customers.checkoutCustomer).
  const cashier = useStaffAccess().role === "cashier";

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
  if (profileId) return <InlineErrorBoundary resetKey={profileId} message="Couldn't load this customer. Check your connection and retry."><CustomerDetails key={profileId} customerId={profileId} onBack={() => setProfileId(null)} onOpen={setProfileId} onPending={onPending} /></InlineErrorBoundary>;

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
          {cashier ? null : <Button variant="outline" size="sm" onClick={() => setProfileId(current._id)}>View / edit</Button>}
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

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers" aria-label="Search customers" className="pl-9" autoFocus />
      </div>
      {cashier ? null : <Button variant="ghost" className="justify-self-start" onClick={() => setArchived(!archived)}>{archived ? "Show active customers" : "Show archived customers"}</Button>}
      {archived ? <p className="text-sm text-muted-foreground">Archived profiles stay linked to existing orders. Open a profile to restore it.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {/* A failed search stays in this dialog with a retry; the order on screen is untouched. */}
      <InlineErrorBoundary resetKey={`${deferred.trim()}:${archived}`} message={SEARCH_FAILED}>
        <CustomerResults query={deferred} archived={archived} currentId={current?._id} disabled={linking} onPick={pick} onOpen={cashier ? undefined : setProfileId} />
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

function CustomerResults({ query, archived, currentId, disabled, onPick, onOpen }: { query: string; archived: boolean; currentId: CustomerId | undefined; disabled: boolean; onPick: (id: CustomerId) => void; onOpen?: (id: CustomerId) => void }) {
  const { results, status, loadMore } = useCheckoutBackend().useCustomerPage(query, archived);
  const typed = query.trim();
  return (
    <><ul className="grid max-h-72 gap-1 overflow-y-auto" aria-label="Customers">
      {status === "LoadingFirstPage" ? <li className="px-3 py-2"><Spinner label="Searching" /></li> : null}
      {results.map((customer) => (
        <li key={customer._id} className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || archived || Boolean(customer.mergedInto) || customer._id === currentId}
            onClick={() => onPick(customer._id)}
            className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
          >
            <CustomerLabel customer={customer} />
          </button>
          {onOpen ? <Button variant="outline" size="sm" disabled={disabled} onClick={() => onOpen(customer._id)} aria-label={`View or edit ${customer.name}`}>Details</Button> : null}
        </li>
      ))}
      {status === "Exhausted" && results.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">{typed.length >= 2 ? `No customer matches “${typed}”.` : onOpen ? `No ${archived ? "archived" : "active"} customers.` : "Type a name, phone or email."}</li> : null}
    </ul>
    {status === "CanLoadMore" || status === "LoadingMore" ? <Button variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(20)}>Load more customers</Button> : null}</>
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
    const phoneError = !savedId ? customerPhoneError(form.phone) : undefined;
    if (phoneError) {
      setError(phoneError);
      return;
    }
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
  const { results: matches, status, loadMore } = useCheckoutBackend().useCustomerPage(contact, false);
  if (!contact || (!matches.length && status === "Exhausted")) return null;
  return (
    <div className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-400/40 dark:bg-amber-400/10">
      <p className="px-1 text-xs font-medium">Already a customer with this contact?</p>
      {status === "LoadingFirstPage" ? <Spinner label="Checking existing customers" /> : null}
      {matches.map((customer) => (
        <button key={customer._id} type="button" disabled={disabled} onClick={() => onPick(customer._id)} className="rounded-md px-2 py-1.5 text-left hover:bg-amber-100 disabled:opacity-60 dark:hover:bg-amber-400/20">
          <CustomerLabel customer={customer} />
        </button>
      ))}
      {status === "CanLoadMore" || status === "LoadingMore" ? <Button type="button" variant="outline" disabled={disabled || status === "LoadingMore"} onClick={() => loadMore(20)}>Load more contact matches</Button> : null}
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
  const lookup = backend.useAttachLookupStatus({ orderId, query });
  const searching = query.trim().length >= 2;

  // Stays open while there is more to add, so a stay and its appointment take one visit.
  // A failed add closes the list so the page's error banner isn't hidden behind it.
  async function attach(row: Attachable) {
    const target = row.kind === "booking" ? { bookingId: row.id as Id<"bookings"> } : { appointmentId: row.id as Id<"appointments"> };
    const more = rows?.some((other) => other.id !== row.id && other.onOrder === null && !other.unavailableReason);
    const ok = await run((current) => actions.attach({ orderId: current, ...target }));
    if (!ok || !more) onDone();
  }

  return (
    <>
      {lookup?.complete === false ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-400/40 dark:bg-amber-400/10">
          {lookup.bookingsIncomplete
            ? "This contact has a long booking history, so the search is incomplete. Search the stay by its reference, or open checkout from its booking."
            : "Some older appointments can't be found by phone or email yet. Search them by reference or guest name, or ask an admin to finish the appointment lookup migration."}
        </p>
      ) : null}
      {(rows === undefined || (rows.length === 0 && lookup === undefined)) && (orderId || searching) ? (
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
          {searching || orderId ? (lookup?.complete === false ? "No matches in the records searched." : "No unpaid bookings or appointments found.") : "Search for a booking by its reference, the guest's phone, email or name."}
        </p>
      )}
    </>
  );
}

/** A cashier's way back to an order: its number. Older receipts read as not available. */
export function OrderLookup({ onOpen }: { onOpen: (orderId: OrderId) => void }) {
  const [text, setText] = useState("");
  const [number, setNumber] = useState<number | null>(null);
  const found = useCheckoutBackend().useFindOrder(number);
  const opened = useRef<number | null>(null);
  useEffect(() => {
    if (number === null || !found || opened.current === number) return;
    opened.current = number;
    onOpen(found);
  }, [number, found, onOpen]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(text.replace(/\D/g, ""));
    opened.current = null;
    setNumber(Number.isSafeInteger(value) && value > 0 ? value : null);
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Label htmlFor="order-lookup">Order number</Label>
      <div className="flex gap-2">
        <Input id="order-lookup" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 1043" autoFocus />
        <Button type="submit" disabled={!text.replace(/\D/g, "")}>Open</Button>
      </div>
      {number !== null && found === undefined ? <Spinner label="Finding order" /> : null}
      {number !== null && found === null ? <p role="status" className="text-sm text-muted-foreground">Not available.</p> : null}
    </form>
  );
}

const FILTERS: Array<{ value: OrderFilter; label: string; empty: string }> = [
  { value: "unpaid", label: "Unpaid", empty: "No unpaid orders. Save & close keeps an order here until it is paid." },
  { value: "paid", label: "Paid", empty: "No paid orders yet." },
  { value: "discarded", label: "Discarded", empty: "No discarded orders. Discarding keeps contents and history; bookings are not cancelled." },
  { value: "void", label: "Voided", empty: "No voided orders." },
];

export function OrdersBrowser({ currentId, onOpen, onPending = () => {} }: { currentId: OrderId | undefined; onOpen: (orderId: OrderId) => void; onPending?: (pending: boolean) => void }) {
  const [filter, setFilter] = useState<OrderFilter>("unpaid");
  const [action, setAction] = useState<{ id: OrderId; mode: "discard" | "restore" } | null>(null);
  return (
    <div className="grid gap-3">
      {action ? <InlineErrorBoundary resetKey={action.id} message="Couldn't review this order. Try again."><OrderLifecycle key={`${action.id}:${action.mode}`} orderId={action.id} mode={action.mode} onPending={onPending} onDone={() => setAction(null)} onOpen={onOpen} /></InlineErrorBoundary> : <>
      <ToggleGroup value={filter} onValueChange={setFilter} aria-label="Show orders" className="flex-wrap justify-self-start">
        {FILTERS.map((f) => <ToggleGroupItem key={f.value} value={f.value}>{f.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">Discard moves the order to Discarded and keeps its items and history. Its bookings stay active and can be added to another order.</p>
      <InlineErrorBoundary key={filter} message="Couldn't load orders. Check your connection and try again.">
        <OrdersList filter={filter} currentId={currentId} onOpen={onOpen} onAction={(id, mode) => setAction({ id, mode })} />
      </InlineErrorBoundary>
      </>}
    </div>
  );
}

const PAGE = 20;

function OrdersList({ filter, currentId, onOpen, onAction }: { filter: OrderFilter; currentId: OrderId | undefined; onOpen: (orderId: OrderId) => void; onAction: (id: OrderId, mode: "discard" | "restore") => void }) {
  const { results, status, loadMore } = useCheckoutBackend().useOrders(filter);
  if (status === "LoadingFirstPage") return <Spinner label="Loading orders" />;
  if (!results.length && status === "Exhausted") return <p className="text-sm text-muted-foreground">{FILTERS.find((f) => f.value === filter)!.empty}</p>;
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
                {row.discarded ? <span className="block text-xs text-muted-foreground">Discarded {orderTime(row.discarded.at)} · {row.discarded.by ?? "Unknown"}{row.discarded.reason ? ` · ${row.discarded.reason}` : ""}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-right">
                  <span className="block text-xs text-muted-foreground">{row.state === "unpaid" ? "Due" : row.state === "paid" ? "Paid" : row.state === "discarded" ? "Discarded" : "Voided"}</span>
                  <span className={cn("block text-sm font-semibold tabular-nums", row.state === "void" && "text-muted-foreground line-through")}>
                    {formatMoney(row.state === "unpaid" ? row.due : row.total, row.currency)}
                  </span>
                  {row.refundedAmountSatang ? <span className="block text-xs text-muted-foreground tabular-nums">Refunded {formatMoney(row.refundedAmountSatang, row.currency)}</span> : null}
                </span>
                {/* The row itself opens the order. */}
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </span>
            </button>
            {filter === "unpaid" || filter === "discarded" ? <Button variant="ghost" size="sm" className={cn("mb-2 -ml-2", filter === "unpaid" && "text-destructive hover:text-destructive")} aria-label={`${filter === "unpaid" ? "Discard" : "Restore"} ${row.title}`} onClick={() => onAction(row._id, filter === "unpaid" ? "discard" : "restore")}>{filter === "unpaid" ? "Discard" : "Restore…"}</Button> : null}
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
