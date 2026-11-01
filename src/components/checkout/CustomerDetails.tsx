"use client";

import { useDeferredValue, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/components/admin/labels";
import { errorText } from "@/lib/staff-bookings";
import { customerPhoneError } from "@/lib/booking/phone";
import { newAttemptKey, useCheckoutBackend, type CheckoutActions, type CustomerDetail, type CustomerId, type CustomerPage, type NewCustomer } from "./backend";
import { historyTime } from "./OrderHistory";
import { InlineErrorBoundary } from "./ErrorBoundary";

export function CustomerDetails({ customerId, onBack, onOpen, onPending }: {
  customerId: CustomerId; onBack: () => void; onOpen: (id: CustomerId) => void; onPending: (pending: boolean) => void;
}) {
  const profile = useCheckoutBackend().useCustomer(customerId);
  return <>
    <DialogHeader><DialogTitle>Customer details</DialogTitle><DialogDescription>Correct this profile without creating a duplicate. Issued receipts keep their original details.</DialogDescription></DialogHeader>
    {profile === undefined ? <Spinner label="Loading customer" /> : profile === null ? <p role="alert">Customer not found.</p> : <Profile key={customerId} profile={profile} onBack={onBack} onOpen={onOpen} onPending={onPending} />}
    {!profile ? <Button variant="outline" onClick={onBack}>Back to customers</Button> : null}
  </>;
}

function Profile({ profile, onBack, onOpen, onPending }: { profile: CustomerDetail; onBack: () => void; onOpen: (id: CustomerId) => void; onPending: (pending: boolean) => void }) {
  const actions = useCheckoutBackend().useActions();
  const [mode, setMode] = useState<"view" | "edit" | "merge">("view");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  async function write(task: () => Promise<unknown>, success: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); onPending(true); setError(""); setNotice("");
    try { await task(); setMode("view"); setNotice(success); }
    catch (err) { setError(errorText(err, "Couldn't save this customer. Your details are kept; try again.")); }
    finally { busy.current = false; setPending(false); onPending(false); }
  }
  return <div className="grid gap-4" aria-busy={pending}>
    <Button variant="outline" className="justify-self-start" disabled={pending} onClick={mode === "view" ? onBack : () => { setMode("view"); setError(""); }}> {mode === "view" ? "Back to customers" : "Cancel"}</Button>
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {profile.mergeProgress ? <div role="status" className="grid gap-2 text-sm">
      <p>{profile.mergeProgress.status === "completed" ? "Merge completed" : "Merge in progress"} · {profile.mergeProgress.movedOrders} order references moved.</p>
      {profile.mergeProgress.status === "running" ? <><p>The source is frozen. Remaining references will move in bounded batches; issued receipts stay unchanged. If progress stops, resume safely.</p><Button variant="outline" disabled={pending} onClick={() => void write(() => actions.resumeCustomerMerge({ sourceId: profile._id }), "Merge progress refreshed.")}>Resume merge</Button></> : null}
    </div> : null}
    {profile.mergedInto ? <><p className="text-sm">This profile was merged. Its identity and history are retained.</p><Button disabled={pending} onClick={() => onOpen(profile.mergedInto!)}>Open kept customer</Button></> : null}
    {mode === "edit" ? <EditCustomer profile={profile} pending={pending} onSave={(form, expectedRevision) => write(() => actions.updateCustomer({ customerId: profile._id, expectedRevision, ...form }), "Customer saved.")} /> : mode === "merge" ? <MergeCustomer source={profile} pending={pending} onMerge={args => write(() => actions.mergeCustomers(args), "Merge started. Check progress below, then open the kept customer to continue.")} /> : <>
      <div className="grid gap-1 text-sm [overflow-wrap:anywhere]">
        <p className="font-semibold">{profile.name}</p><p>{profile.phone || "No phone"}</p><p>{profile.email || "No email"}</p>
        {profile.notes ? <p className="mt-2 whitespace-pre-wrap">{profile.notes}</p> : null}
        {profile.archivedAt ? <p className="mt-2 text-muted-foreground">Archived · hidden from active customer search</p> : null}
      </div>
      {!profile.mergedInto ? <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => setMode("edit")}>Edit details</Button>
        <Button variant="outline" disabled={pending} onClick={() => void write(() => actions.setCustomerArchived({ customerId: profile._id, expectedRevision: profile.revision, archived: !profile.archivedAt }), profile.archivedAt ? "Customer restored." : "Customer archived.")}>{profile.archivedAt ? "Restore customer" : "Archive customer"}</Button>
        <Button variant="ghost" disabled={pending} onClick={() => setMode("merge")}>Merge duplicate…</Button>
      </div> : null}
      <InlineErrorBoundary resetKey={profile._id} message="Couldn't load customer orders. Retry to continue."><CustomerOrders customerId={profile._id} /></InlineErrorBoundary>
      <InlineErrorBoundary resetKey={profile._id} message="Couldn't load customer history. Retry to continue."><CustomerHistory customerId={profile._id} /></InlineErrorBoundary>
    </>}
  </div>;
}

function EditCustomer({ profile, pending, onSave }: { profile: CustomerDetail; pending: boolean; onSave: (form: NewCustomer, expectedRevision: number) => Promise<void> }) {
  const [form, setForm] = useState<NewCustomer>({ name: profile.name, phone: profile.phone ?? "", email: profile.email ?? "", notes: profile.notes ?? "" });
  const revision = useRef(profile.revision);
  const [error, setError] = useState("");
  const set = (field: keyof NewCustomer, value: string) => setForm({ ...form, [field]: value });
  function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = form.phone?.trim() !== profile.phone?.trim() ? customerPhoneError(form.phone) : undefined;
    setError(invalid ?? "");
    if (!invalid) void onSave(form, revision.current);
  }
  return <form onSubmit={submit} className="grid gap-3">
    <div className="grid gap-2"><Label htmlFor="customer-edit-name">Name</Label><Input id="customer-edit-name" required maxLength={120} value={form.name} onChange={e => set("name", e.target.value)} disabled={pending} autoFocus /></div>
    <div className="grid gap-2"><Label htmlFor="customer-edit-phone">Phone (optional)</Label><Input id="customer-edit-phone" type="tel" maxLength={40} value={form.phone} onChange={e => set("phone", e.target.value)} disabled={pending} /></div>
    <div className="grid gap-2"><Label htmlFor="customer-edit-email">Email (optional)</Label><Input id="customer-edit-email" type="email" maxLength={200} value={form.email} onChange={e => set("email", e.target.value)} disabled={pending} /></div>
    <div className="grid gap-2"><Label htmlFor="customer-edit-notes">Notes (optional)</Label><Textarea id="customer-edit-notes" maxLength={1000} value={form.notes} onChange={e => set("notes", e.target.value)} disabled={pending} /></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button type="submit" disabled={pending || !form.name.trim()}>{pending ? "Saving…" : "Save customer"}</Button>
  </form>;
}

function More({ page, label }: { page: CustomerPage<unknown>; label: string }) {
  if (page.status !== "CanLoadMore" && page.status !== "LoadingMore") return null;
  return <Button variant="outline" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(20)}>{page.status === "LoadingMore" ? "Loading…" : label}</Button>;
}

function CustomerOrders({ customerId }: { customerId: CustomerId }) {
  const page = useCheckoutBackend().useCustomerOrders(customerId);
  return <section aria-label="Customer orders" className="grid gap-2"><h3 className="font-semibold">Orders</h3>
    {page.status === "LoadingFirstPage" ? <Spinner label="Loading customer orders" /> : null}
    {page.results.length === 0 && page.status === "Exhausted" ? <p className="text-sm text-muted-foreground">No orders linked to this profile.</p> : null}
    <ul className="divide-y divide-border">{page.results.map(order => <li key={order._id} className="flex justify-between gap-3 py-2 text-sm"><span>{order.title} · {order.state}</span><span className="tabular-nums">{formatMoney(order.total, order.currency)}</span></li>)}</ul><More page={page} label="Load more customer orders" />
  </section>;
}

function businessFields(value: unknown, previous?: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = { ...(value as Record<string, unknown>) };
  if (previous && typeof previous === "object") for (const key of ["phone", "email", "notes"]) {
    if (key in previous && !Object.hasOwn(record, key)) record[key] = null;
  }
  const labels: Record<string, string> = { name: "Name", phone: "Phone", email: "Email", notes: "Notes", archived: "Archived", sourceId: "Source reference", destinationId: "Kept reference", movedOrders: "Orders moved" };
  const fields = Object.entries(labels).filter(([key]) => Object.hasOwn(record, key)).map(([key, label]) => `${label}: ${record[key] === null || record[key] === undefined || record[key] === "" ? "Cleared" : typeof record[key] === "boolean" ? record[key] ? "Yes" : "No" : String(record[key])}`);
  for (const [key, label] of [["source", "Source"], ["destination", "Kept customer"]]) {
    const details = businessFields(record[key]);
    if (details) fields.push(`${label}: ${details}`);
  }
  return fields.join(" · ");
}

function CustomerHistory({ customerId }: { customerId: CustomerId }) {
  const page = useCheckoutBackend().useCustomerHistory(customerId);
  return <section aria-label="Customer history" className="grid gap-2"><h3 className="font-semibold">History</h3>
    <p className="text-xs text-muted-foreground">History begins when recording was enabled; earlier changes may not be listed.</p>
    {page.status === "LoadingFirstPage" ? <Spinner label="Loading customer history" /> : null}
    {page.results.length === 0 && page.status === "Exhausted" ? <p className="text-sm text-muted-foreground">No recorded changes yet.</p> : null}
    <ol className="grid gap-3">{page.results.map(entry => <li key={entry._id} className="text-sm [overflow-wrap:anywhere]"><p className="capitalize">{entry.kind.replaceAll("_", " ")} · Recorded {historyTime(entry.recordedAt)}</p><p className="text-xs text-muted-foreground">{entry.actor} · Effective {historyTime(entry.effectiveAt)} · Bangkok</p>{entry.reason ? <p>{entry.reason}</p> : null}{businessFields(entry.before) ? <p className="mt-1 whitespace-pre-wrap text-xs">Before: {businessFields(entry.before)}</p> : null}{businessFields(entry.after, entry.before) ? <p className="mt-1 whitespace-pre-wrap text-xs">After: {businessFields(entry.after, entry.before)}</p> : null}</li>)}</ol><More page={page} label="Load more customer history" />
  </section>;
}

function MergeCustomer({ source, pending, onMerge }: { source: CustomerDetail; pending: boolean; onMerge: (args: Parameters<CheckoutActions["mergeCustomers"]>[0]) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [destinationId, setDestinationId] = useState<CustomerId | null>(null);
  const deferred = useDeferredValue(query);
  const page = useCheckoutBackend().useCustomerPage(deferred, false);
  return <div className="grid gap-3">
    <h3 className="font-semibold">Choose the customer to keep</h3>
    <p className="text-sm">Merge “{source.name}” into an explicitly selected profile. Names and contact matches do not prove these are the same person.</p>
    {!source.mergeEnabled ? <p role="status" className="text-sm text-muted-foreground">Merge submission is awaiting checkout safety integration. You can review the profiles; no records will change.</p> : null}
    <Input aria-label="Find customer to keep" value={query} onChange={e => { setQuery(e.target.value); setDestinationId(null); }} placeholder="Name, exact phone or email" disabled={pending} />
    <ul className="grid max-h-48 gap-1 overflow-y-auto">{page.results.filter(c => c._id !== source._id && !c.mergedInto).map(c => <li key={c._id}><Button className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" variant={destinationId === c._id ? "secondary" : "outline"} disabled={pending} onClick={() => setDestinationId(c._id)}>{c.name} · {c.phone || c.email || "No contact details"}</Button></li>)}</ul>
    {page.status === "LoadingFirstPage" ? <Spinner label="Finding customers" /> : null}<More page={page} label="Load more merge candidates" />
    {destinationId ? <InlineErrorBoundary resetKey={destinationId} message="Couldn't load the kept customer. Retry before reviewing the merge."><MergeReview key={destinationId} source={source} destinationId={destinationId} pending={pending} onMerge={onMerge} /></InlineErrorBoundary> : null}
  </div>;
}

function MergeReview({ source, destinationId, pending, onMerge }: { source: CustomerDetail; destinationId: CustomerId; pending: boolean; onMerge: (args: Parameters<CheckoutActions["mergeCustomers"]>[0]) => Promise<void> }) {
  const destination = useCheckoutBackend().useCustomer(destinationId);
  if (destination === undefined) return <Spinner label="Loading kept profile" />;
  if (!destination || destination.archivedAt || destination.mergedInto) return <p role="alert">This profile is no longer available. Choose another customer.</p>;
  return <ReviewedMerge source={source} destination={destination} pending={pending} onMerge={onMerge} />;
}

function ReviewedMerge({ source, destination, pending, onMerge }: { source: CustomerDetail; destination: CustomerDetail; pending: boolean; onMerge: (args: Parameters<CheckoutActions["mergeCustomers"]>[0]) => Promise<void> }) {
  const [reviewed] = useState(() => ({ source, destination }));
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const attempt = useRef<Parameters<CheckoutActions["mergeCustomers"]>[0] | null>(null);
  const changed = source.revision !== reviewed.source.revision || destination.revision !== reviewed.destination.revision;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || (!attempt.current && (changed || !reason.trim()))) return;
    if (!attempt.current) {
      attempt.current = { sourceId: reviewed.source._id, destinationId: reviewed.destination._id, sourceRevision: reviewed.source.revision, destinationRevision: reviewed.destination.revision, reason, idempotencyKey: newAttemptKey() };
      setAttempted(true);
    }
    await onMerge(attempt.current);
  }
  return <form className="grid gap-3" onSubmit={e => void submit(e)}>
    <div className="grid gap-2 text-sm [overflow-wrap:anywhere]"><p><strong>Keep:</strong> {reviewed.destination.name} · {reviewed.destination.phone || "No phone"} · {reviewed.destination.email || "No email"}</p><p><strong>Archive as duplicate:</strong> {reviewed.source.name} · {reviewed.source.phone || "No phone"} · {reviewed.source.email || "No email"}</p></div>
    <p className="text-sm">All source order references move to the kept profile. Both identities and histories remain. The kept profile’s contact details and notes stay as shown; issued receipts stay unchanged. This cannot be undone here. Large histories move in resumable batches. The source is frozen immediately; progress is shown on its retained profile.</p>
    {changed && !attempted ? <p role="alert" className="text-sm text-destructive">A profile changed. Cancel and review both profiles again before merging.</p> : null}
    <Label htmlFor="customer-merge-reason">Why are these the same customer?</Label><Textarea id="customer-merge-reason" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || attempted} />
    <Button type="submit" disabled={pending || !source.mergeEnabled || (!attempted && (changed || !reason.trim()))}>{pending ? "Merging…" : attempted ? "Retry same merge" : "Merge into kept customer"}</Button>
  </form>;
}
