"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Building2, Check, History, Pencil, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, SearchBox, SkeletonRows, STACKED_TABLE, useDebounced } from "@/components/admin/admin-bulk";
import { Callout, EditorSheet, NoticeBar, SheetForm, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PurchaseEventHistory } from "./PurchaseEventHistory";
import { createOperationKey, parseStockError, STOCK_PAGE_SIZE, SUPPLIER_STATUS_META } from "./stock-format";
import type { SupplierStatus } from "./stock-types";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

export type SupplierRow = FunctionReturnType<typeof api.commerce.purchasing.suppliers>["page"][number];

/**
 * Inline supplier selector dialog with live search and quick inline creation for buyers.
 */
export function SupplierPickerField({
  branchId,
  value,
  selectedName,
  canCreate = false,
  required = false,
  disabled = false,
  onChange,
}: {
  branchId: Id<"branches">;
  value: Id<"suppliers"> | null;
  selectedName?: string;
  canCreate?: boolean;
  required?: boolean;
  disabled?: boolean;
  onChange: (supplier: { id: Id<"suppliers">; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 200);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("sup-add"));

  const addSupplier = useMutation(api.commerce.purchasing.addSupplier);
  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.purchasing.suppliers,
    open
      ? { branchId, status: "active", ...(debounced ? { search: debounced } : {}) }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  async function handleQuickAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!newName.trim()) {
      setError("Enter a supplier name.");
      return;
    }
    setSaving(true);
    try {
      const res = await addSupplier({
        branchId,
        name: newName.trim(),
        contactName: newContact.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
        operationKey: opKey,
      });
      onChange({ id: res.id as Id<"suppliers">, name: newName.trim() });
      setAdding(false);
      setNewName("");
      setNewContact("");
      setNewPhone("");
      setNewEmail("");
      setOpKey(createOperationKey("sup-add"));
      setOpen(false);
    } catch (cause) {
      setError(parseStockError(cause, "Could not add supplier.").message);
      setOpKey(createOperationKey("sup-add"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex-1 justify-start text-left font-normal"
        >
          <Building2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>
            {selectedName || (value ? "Selected supplier" : required ? "Choose supplier…" : "Optional supplier…")}
          </span>
        </Button>
        {value && !required ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{adding ? "Add supplier" : "Choose supplier"}</DialogTitle>
            <DialogDescription>
              {adding
                ? "Create an active supplier record to use immediately on orders."
                : "Select an active supplier or add a new one."}
            </DialogDescription>
          </DialogHeader>

          {adding ? (
            <form onSubmit={handleQuickAdd} className="grid gap-3">
              {error ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="quick-sup-name">Supplier name</Label>
                <Input
                  id="quick-sup-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Siam Wellness Supply"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="quick-sup-contact">Contact name (optional)</Label>
                  <Input
                    id="quick-sup-contact"
                    value={newContact}
                    onChange={(event) => setNewContact(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="quick-sup-phone">Phone (optional)</Label>
                  <Input
                    id="quick-sup-phone"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="quick-sup-email">Email (optional)</Label>
                <Input
                  id="quick-sup-email"
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                  Back to list
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Adding…" : "Save & select"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  label="Search suppliers"
                  placeholder="Search supplier name…"
                />
                {canCreate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNewName(search.trim());
                      setAdding(true);
                    }}
                  >
                    <Plus aria-hidden className="size-4" />
                    New
                  </Button>
                ) : null}
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {status === "LoadingFirstPage" ? (
                  <SkeletonRows label="Loading suppliers" rows={4} />
                ) : results.length === 0 ? (
                  <EmptyState>
                    {debounced ? `No active suppliers match “${debounced}”.` : "No active suppliers yet."}
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-border">
                    {results.map((supplier) => (
                      <li key={supplier._id}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange({ id: supplier._id, name: supplier.name });
                            setOpen(false);
                          }}
                          className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-foreground">{supplier.name}</span>
                            {supplier.contactName || supplier.phone || supplier.email ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </span>
                          {value === supplier._id ? <Check aria-hidden className="size-4 shrink-0" /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {status === "CanLoadMore" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
                  Load more suppliers
                </Button>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Buyer-only supplier directory: create, edit, activate/deactivate, and inspect history.
 */
export function SuppliersManagementPanel({
  branchId,
  canEdit,
}: {
  branchId: Id<"branches">;
  canEdit: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<SupplierStatus>("active");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 200);
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const [historyTarget, setHistoryTarget] = useState<SupplierRow | null>(null);
  const { notice, show, clear } = useNotice();

  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.purchasing.suppliers,
    { branchId, status: statusFilter, ...(debounced ? { search: debounced } : {}) },
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  return (
    <div className="grid gap-4">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            label="Supplier status"
            value={statusFilter}
            onValueChange={setStatusFilter}
            tabs={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            label="Search suppliers"
            placeholder="Search supplier name…"
          />
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus aria-hidden className="size-4" />
            Add supplier
          </Button>
        ) : null}
      </div>

      {!canEdit ? (
        <Callout tone="info">
          Supplier contact details and editing are limited to buyers. Issued orders retain the supplier snapshot they used.
        </Callout>
      ) : null}

      <Card className="overflow-hidden">
        {status === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading suppliers" rows={4} />
        ) : results.length === 0 ? (
          <EmptyState>
            {debounced ? `No ${statusFilter} suppliers match “${debounced}”.` : `No ${statusFilter} suppliers yet.`}
          </EmptyState>
        ) : (
          <table className={STACKED_TABLE.table}>
            <thead className={STACKED_TABLE.head}>
              <tr>
                <th scope="col" className={STACKED_TABLE.th}>Supplier</th>
                <th scope="col" className={STACKED_TABLE.th}>Contact</th>
                <th scope="col" className={STACKED_TABLE.th}>Status</th>
                <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {results.map((supplier) => (
                <tr key={supplier._id} className={STACKED_TABLE.row}>
                  <td data-label="Supplier" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                    <span className="font-medium text-foreground">{supplier.name}</span>
                    {supplier.note ? (
                      <span className="block text-xs text-muted-foreground">{supplier.note}</span>
                    ) : null}
                  </td>
                  <td data-label="Contact" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs text-muted-foreground")}>
                    {[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                    <StatusBadge {...SUPPLIER_STATUS_META[supplier.status]} />
                  </td>
                  <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryTarget(supplier)}
                      >
                        <History aria-hidden className="size-3.5" />
                        History
                      </Button>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(supplier)}
                        >
                          <Pencil aria-hidden className="size-3.5" />
                          Edit
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {status === "CanLoadMore" ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
            Load more suppliers
          </Button>
        </div>
      ) : null}

      {editing ? (
        <SupplierEditorSheet
          branchId={branchId}
          supplier={editing === "new" ? null : (results.find((row) => row._id === editing._id) ?? editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            show("Supplier saved.", "success");
          }}
        />
      ) : null}

      {historyTarget ? (
        <SupplierHistorySheet
          branchId={branchId}
          supplier={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}
    </div>
  );
}

function SupplierEditorSheet({
  branchId,
  supplier,
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const addSupplier = useMutation(api.commerce.purchasing.addSupplier);
  const editSupplier = useMutation(api.commerce.purchasing.editSupplier);

  const [reviewedRevision, setReviewedRevision] = useState<number | undefined>(() => supplier?.revision);
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const [status, setStatus] = useState<SupplierStatus>(supplier?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("sup-save"));

  const isDirty =
    name !== (supplier?.name ?? "") ||
    contactName !== (supplier?.contactName ?? "") ||
    phone !== (supplier?.phone ?? "") ||
    email !== (supplier?.email ?? "") ||
    note !== (supplier?.note ?? "") ||
    status !== (supplier?.status ?? "active");
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = Boolean(supplier && reviewedRevision !== undefined && supplier.revision !== reviewedRevision);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Supplier name is required.");
      document.getElementById("sup-name")?.focus();
      return;
    }
    if (isStale) {
      setError("This supplier changed while open. Review the updated revision above before saving.");
      return;
    }
    setSaving(true);
    try {
      if (supplier) {
        await editSupplier({
          branchId,
          supplierId: supplier._id,
          expectedRevision: reviewedRevision ?? supplier.revision,
          status,
          name: name.trim(),
          contactName: contactName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          note: note.trim() || undefined,
          operationKey: opKey,
        });
      } else {
        await addSupplier({
          branchId,
          name: name.trim(),
          contactName: contactName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          note: note.trim() || undefined,
          operationKey: opKey,
        });
      }
      onSaved();
    } catch (cause) {
      setError(parseStockError(cause, "Could not save supplier.").message);
      setOpKey(createOperationKey("sup-save"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>{supplier ? `Edit ${supplier.name}` : "Add supplier"}</SheetTitle>
          <SheetDescription>Shared supplier master across branches. Buyers manage contact details and status.</SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel={supplier ? "Save supplier" : "Add supplier"}
      >
        {isStale && supplier && reviewedRevision !== undefined ? (
          <StockStaleBanner
            title="Supplier changed while editing"
            description={`This supplier moved from revision ${reviewedRevision} to ${supplier.revision}. Your typed edits are preserved — review the latest revision before saving.`}
            actionLabel="Review updated revision"
            onReview={() => {
              setReviewedRevision(supplier.revision);
              setError("");
              setOpKey(createOperationKey("sup-save"));
            }}
          />
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="sup-name">Supplier name</Label>
          <Input id="sup-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sup-contact">Contact name</Label>
            <Input id="sup-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sup-phone">Phone</Label>
            <Input id="sup-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sup-email">Email</Label>
          <Input id="sup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sup-note">Notes</Label>
          <Input id="sup-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {supplier ? (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={status === "active"}
              onChange={(event) => setStatus(event.target.checked ? "active" : "inactive")}
              className="size-4 accent-foreground"
            />
            <span>Active supplier (inactive suppliers cannot be used on new issued orders)</span>
          </label>
        ) : null}
      </SheetForm>
    </EditorSheet>
  );
}

function SupplierHistorySheet({
  branchId,
  supplier,
  onClose,
}: {
  branchId: Id<"branches">;
  supplier: SupplierRow;
  onClose: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.purchasing.history,
    { branchId, entity: "supplier", entityId: supplier._id },
    { initialNumItems: 20 },
  );

  return (
    <EditorSheet
      open
      onClose={onClose}
      header={
        <>
          <SheetTitle>{supplier.name} · History</SheetTitle>
          <SheetDescription>Changes recorded for this supplier.</SheetDescription>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <PurchaseEventHistory
            events={results}
            loading={status === "LoadingFirstPage"}
            hasMore={status === "CanLoadMore"}
            loadingMore={status === "LoadingMore"}
            onLoadMore={() => loadMore(20)}
          />
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </EditorSheet>
  );
}
