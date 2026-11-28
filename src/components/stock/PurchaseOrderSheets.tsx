"use client";

/** Sheets opened from a purchase order: amendment (new revision), close remainder and a reason prompt. */
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { resortTodayIso } from "convex/shared/time";
import { useState, type FormEvent } from "react";
import { EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { createOperationKey, parseOptionalSatang, parseStockError, parseWholeQuantity } from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import { StockVariantPickerDialog } from "./StockVariantPicker";

type OrderDetailResult = FunctionReturnType<typeof api.commerce.purchasing.order>;
type OrderRow = OrderDetailResult["order"];
type OrderLineRow = OrderDetailResult["lines"][number];

export function ReasonSheet({
  title, description, submitLabel, placeholder, onClose, onSubmit,
}: {
  title: string; description: string; submitLabel: string; placeholder: string;
  onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { requestClose } = useStockDirtyGuard(reason.trim() !== "", onClose, saving);
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("Enter a reason.");
      document.getElementById("reason-sheet-input")?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(reason.trim());
    } catch (cause) {
      setError(parseStockError(cause, "Could not save.").message);
      setSaving(false);
    }
  }
  return (
    <EditorSheet open onClose={requestClose} header={<><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></>}>
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel={submitLabel}>
        <div className="grid gap-1.5">
          <Label htmlFor="reason-sheet-input">Reason</Label>
          <Input id="reason-sheet-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}

type AddedLine = {
  variantId: Id<"productVariants">; label: string; quantityText: string; unitCostText: string; priceTbc: boolean;
  /** From the order's approved request: at most `available` units, no direct-order policy needed. */
  requestLineId?: Id<"purchaseRequestLines">; available?: number;
};

export function AmendOrderSheet({
  order,
  lines,
  branchId,
  canAddDirect,
  requestLines,
  requestReference,
  onClose,
  onAmended,
  amendMutation,
}: {
  order: OrderRow;
  lines: OrderLineRow[];
  branchId: Id<"branches">;
  /** New lines without a source request need the direct-order policy (the server checks it too). */
  canAddDirect: boolean;
  /** Approved lines of the order's own request that can be added without the direct-order policy. */
  requestLines: OrderDetailResult["addableRequestLines"];
  requestReference?: string;
  onClose: () => void;
  onAmended: () => void;
  amendMutation: (args: {
    orderId: Id<"purchaseOrders">;
    expectedRevision: number;
    reason: string;
    expectedDate?: string;
    supplierReference?: string;
    lines: { orderLineId: Id<"purchaseOrderLines">; due?: number; unitCost?: number }[];
    addLines?: { variantId: Id<"productVariants">; quantity: number; unitCost?: number; priceTbc?: boolean; requestLineId?: Id<"purchaseRequestLines"> }[];
    operationKey: string;
  }) => Promise<{ id: string }>;
}) {
  const [added, setAdded] = useState<AddedLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState(order.revision);
  const [initialState] = useState(() => ({
    expectedDate: order.expectedDate ?? "",
    supplierReference: order.supplierReference ?? "",
    dueByLine: Object.fromEntries(lines.map((line) => [line._id, String(line.due)])),
    costByLine: Object.fromEntries(
      lines.map((line) => [line._id, line.unitCost !== undefined ? (line.unitCost / 100).toString() : ""]),
    ),
  }));
  const [expectedDate, setExpectedDate] = useState(initialState.expectedDate);
  const [supplierReference, setSupplierReference] = useState(initialState.supplierReference);
  const [reason, setReason] = useState("");
  const [dueByLine, setDueByLine] = useState<Record<string, string>>(initialState.dueByLine);
  const [costByLine, setCostByLine] = useState<Record<string, string>>(initialState.costByLine);
  const [lineErrors, setLineErrors] = useState<Record<string, { due?: string; cost?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("po-amend"));

  // Something the supplier will see changed; the reason alone is not an amendment (the server rejects NO_CHANGES too).
  const hasChanges =
    added.length > 0 ||
    expectedDate !== initialState.expectedDate ||
    supplierReference.trim() !== initialState.supplierReference.trim() ||
    lines.some(
      (line) =>
        (dueByLine[line._id] ?? "").trim() !== (initialState.dueByLine[line._id] ?? "") ||
        (costByLine[line._id] ?? "").trim() !== (initialState.costByLine[line._id] ?? ""),
    );
  const isDirty = hasChanges || reason.trim() !== "";
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = order.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const nextLineErrors: Record<string, { due?: string; cost?: string }> = {};
    let firstInvalidId: string | undefined;
    const payloadLines: { orderLineId: Id<"purchaseOrderLines">; due?: number; unitCost?: number }[] = [];
    for (const line of lines) {
      const parsedDue = parseWholeQuantity(dueByLine[line._id] ?? "", { allowZero: true, label: "Due quantity" });
      if (!parsedDue.ok || parsedDue.value === undefined) {
        nextLineErrors[line._id] = {
          ...(nextLineErrors[line._id] ?? {}),
          due: parsedDue.ok ? "Invalid due quantity." : parsedDue.error,
        };
        firstInvalidId ??= `amend-due-${line._id}`;
      }
      const parsedCost = parseOptionalSatang(costByLine[line._id] ?? "");
      if (!parsedCost.ok) {
        nextLineErrors[line._id] = {
          ...(nextLineErrors[line._id] ?? {}),
          cost: parsedCost.error,
        };
        firstInvalidId ??= `amend-cost-${line._id}`;
      }
      if (parsedDue.ok && parsedDue.value !== undefined && parsedCost.ok) {
        // Send only what changed, so an untouched line never reads as an amendment.
        const dueChanged = parsedDue.value !== line.due;
        const costChanged = parsedCost.value !== undefined && parsedCost.value !== line.unitCost;
        if (dueChanged || costChanged) {
          payloadLines.push({
            orderLineId: line._id,
            ...(dueChanged ? { due: parsedDue.value } : {}),
            ...(costChanged ? { unitCost: parsedCost.value } : {}),
          });
        }
      }
    }
    const addLines: { variantId: Id<"productVariants">; quantity: number; unitCost?: number; priceTbc?: boolean; requestLineId?: Id<"purchaseRequestLines"> }[] = [];
    for (const line of added) {
      const qty = parseWholeQuantity(line.quantityText, { label: "Quantity", max: line.available });
      const cost = parseOptionalSatang(line.unitCostText);
      if (!qty.ok || qty.value === undefined) {
        nextLineErrors[`add-${line.variantId}`] = { due: qty.ok ? "Enter a quantity." : qty.error };
        firstInvalidId ??= `amend-add-qty-${line.variantId}`;
        continue;
      }
      if (!cost.ok) {
        nextLineErrors[`add-${line.variantId}`] = { cost: cost.error };
        firstInvalidId ??= `amend-add-cost-${line.variantId}`;
        continue;
      }
      if (cost.value === undefined && !line.priceTbc && !order.forHoldId && !order.replacesReturnId) {
        nextLineErrors[`add-${line.variantId}`] = { cost: "Enter a unit cost or mark Price to be confirmed." };
        firstInvalidId ??= `amend-add-cost-${line.variantId}`;
        continue;
      }
      addLines.push({
        variantId: line.variantId, quantity: qty.value, ...(cost.value !== undefined ? { unitCost: cost.value } : {}),
        ...(line.priceTbc && cost.value === undefined ? { priceTbc: true } : {}), ...(line.requestLineId ? { requestLineId: line.requestLineId } : {}),
      });
    }
    setLineErrors(nextLineErrors);
    if (firstInvalidId) {
      setError("Fix the highlighted line values before issuing the amendment.");
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (!hasChanges) {
      setError("Nothing changed. Edit a quantity, cost, date or reference, or add a line, before issuing an amendment.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for amending this issued order.");
      document.getElementById("amend-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This order changed while amending. Review the updated order above before issuing the amendment.");
      return;
    }

    setSaving(true);
    try {
      await amendMutation({
        orderId: order._id,
        expectedRevision: reviewedRevision,
        reason: reason.trim(),
        expectedDate: expectedDate || undefined,
        supplierReference: supplierReference.trim() || undefined,
        lines: payloadLines,
        ...(addLines.length ? { addLines } : {}),
        operationKey: opKey,
      });
      onAmended();
    } catch (cause) {
      setError(parseStockError(cause, "Could not amend order.").message);
      setOpKey(createOperationKey("po-amend"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Amend {order.reference}</SheetTitle>
          <SheetDescription>
            Update the expected date, quantities still due or future unit costs, or add a line the supplier agreed to ship. Creates a new issued revision.
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Issue amendment"
        submitDisabled={!hasChanges} footerSummary={hasChanges ? undefined : "Change a quantity, cost, date or reference, or add a line."}>
        {isStale ? (
          <StockStaleBanner
            title="Purchase order changed while amending"
            description={`This order moved from revision ${reviewedRevision} to ${order.revision}. Your typed amendment is preserved — review the updated order before issuing.`}
            actionLabel="Review updated order"
            onReview={() => {
              setReviewedRevision(order.revision);
              setError("");
              setOpKey(createOperationKey("po-amend"));
            }}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="amend-expected">Expected delivery date</Label>
            <DatePicker id="amend-expected" value={expectedDate} onValueChange={setExpectedDate} clearable
              min={order.expectedDate && order.expectedDate < resortTodayIso() ? order.expectedDate : resortTodayIso()} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="amend-ref">Supplier reference</Label>
            <Input id="amend-ref" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
          </div>
        </div>

        <ul className="grid gap-3">
          {lines.map((line) => {
            const err = lineErrors[line._id];
            return (
              <li
                key={line._id}
                className={cn(
                  "grid gap-2.5 rounded-lg border border-border p-3.5",
                  (err?.due || err?.cost) && "border-destructive/60",
                )}
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {line.item.productName} · {line.item.variantLabel}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">Accepted so far: {line.accepted}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`amend-due-${line._id}`}>New still-due quantity</Label>
                    <NumberField
                      id={`amend-due-${line._id}`}
                      value={dueByLine[line._id] ?? ""}
                      aria-invalid={err?.due ? true : undefined}
                      aria-describedby={err?.due ? `amend-due-${line._id}-err` : undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDueByLine((c) => ({ ...c, [line._id]: val }));
                        setLineErrors((c) => (c[line._id]?.due ? { ...c, [line._id]: { ...c[line._id], due: undefined } } : c));
                        setOpKey(createOperationKey("po-amend"));
                      }}
                    />
                    <FieldError id={`amend-due-${line._id}-err`}>{err?.due}</FieldError>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`amend-cost-${line._id}`}>Unit cost (THB)</Label>
                    <NumberField
                      id={`amend-cost-${line._id}`}
                      prefix="฿"
                      inputMode="decimal"
                      value={costByLine[line._id] ?? ""}
                      aria-invalid={err?.cost ? true : undefined}
                      aria-describedby={err?.cost ? `amend-cost-${line._id}-err` : undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCostByLine((c) => ({ ...c, [line._id]: val }));
                        setLineErrors((c) => (c[line._id]?.cost ? { ...c, [line._id]: { ...c[line._id], cost: undefined } } : c));
                        setOpKey(createOperationKey("po-amend"));
                      }}
                    />
                    <FieldError id={`amend-cost-${line._id}-err`}>{err?.cost}</FieldError>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {added.length > 0 ? (
          <ul className="grid gap-3" aria-label="New lines">
            {added.map((line) => {
              const err = lineErrors[`add-${line.variantId}`];
              const update = (patch: Partial<AddedLine>) => {
                setAdded((rows) => rows.map((row) => (row.variantId === line.variantId ? { ...row, ...patch } : row)));
                setOpKey(createOperationKey("po-amend"));
              };
              return (
                <li key={line.variantId} className="grid gap-2.5 rounded-lg border border-dashed border-border p-3.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium text-foreground">
                      New line · {line.label}
                      {line.requestLineId ? <span className="block text-xs font-normal text-muted-foreground">From {requestReference ?? "the request"} · up to {line.available} approved</span> : null}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAdded((rows) => rows.filter((row) => row.variantId !== line.variantId))}>
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1">
                      <Label htmlFor={`amend-add-qty-${line.variantId}`}>Quantity</Label>
                      <NumberField id={`amend-add-qty-${line.variantId}`} value={line.quantityText} aria-invalid={err?.due ? true : undefined}
                        onChange={(e) => update({ quantityText: e.target.value })} />
                      <FieldError id={`amend-add-qty-${line.variantId}-err`}>{err?.due}</FieldError>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`amend-add-cost-${line.variantId}`}>Unit cost (THB)</Label>
                      <NumberField id={`amend-add-cost-${line.variantId}`} prefix="฿" inputMode="decimal" value={line.unitCostText}
                        aria-invalid={err?.cost ? true : undefined} disabled={line.priceTbc}
                        onChange={(e) => update({ unitCostText: e.target.value })} />
                      <FieldError id={`amend-add-cost-${line.variantId}-err`}>{err?.cost}</FieldError>
                    </div>
                    <label className="inline-flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground">
                      <input type="checkbox" className="size-4 accent-foreground" checked={line.priceTbc}
                        onChange={(e) => update({ priceTbc: e.target.checked, unitCostText: e.target.checked ? "" : line.unitCostText })} />
                      Price to be confirmed
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {requestLines.some((line) => !added.some((row) => row.variantId === line.variantId)) ? (
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Add from {requestReference ?? "the approved request"}</p>
            <div className="flex flex-wrap gap-2">
              {requestLines.filter((line) => !added.some((row) => row.variantId === line.variantId)).map((line) => (
                <Button key={line.requestLineId} type="button" variant="outline" size="sm" onClick={() => {
                  setAdded((rows) => [...rows, {
                    variantId: line.variantId, label: `${line.item.productName} · ${line.item.variantLabel}${line.item.sku ? ` (${line.item.sku})` : ""}`,
                    quantityText: String(line.available), unitCostText: "", priceTbc: false, requestLineId: line.requestLineId, available: line.available,
                  }]);
                  setOpKey(createOperationKey("po-amend"));
                }}>
                  {line.item.productName} · {line.item.variantLabel} ({line.available} approved)
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {canAddDirect ? (
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setPickerOpen(true)}>
            Add a line
          </Button>
        ) : requestLines.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Adding a line needs this branch&apos;s direct-order policy, or an approved line on this order&apos;s request.
          </p>
        ) : null}
        <StockVariantPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          branchId={branchId}
          title="Add a line to this order"
          selectedIds={[...lines.map((line) => line.variantId), ...added.map((line) => line.variantId)]}
          onSelect={(item) => {
            if (lines.some((line) => line.variantId === item.variantId) || added.some((line) => line.variantId === item.variantId)) return;
            setAdded((rows) => [...rows, {
              variantId: item.variantId, label: `${item.productName} · ${item.label}${item.sku ? ` (${item.sku})` : ""}`,
              quantityText: "1", unitCostText: "", priceTbc: false,
            }]);
            setOpKey(createOperationKey("po-amend"));
          }}
        />

        <div className="grid gap-1.5">
          <Label htmlFor="amend-reason">Reason for amendment</Label>
          <Input
            id="amend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier updated delivery date and unit price"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}

export function CloseRemainderSheet({
  order,
  lines,
  sourceRequest,
  canCloseDemand,
  onClose,
  onClosed,
  closeMutation,
}: {
  order: OrderRow;
  lines: OrderLineRow[];
  sourceRequest: OrderDetailResult["sourceRequest"];
  /** Stock leads may also close the source request's remaining demand. */
  canCloseDemand: boolean;
  onClose: () => void;
  onClosed: () => void;
  closeMutation: (args: {
    orderId: Id<"purchaseOrders">;
    expectedRevision: number;
    reason: string;
    closeRequestDemand?: boolean;
    operationKey: string;
  }) => Promise<{ id: string }>;
}) {
  const [reviewedRevision, setReviewedRevision] = useState(order.revision);
  const [reason, setReason] = useState("");
  const [closeDemand, setCloseDemand] = useState(false);
  // Effects before confirming: On order falls by every due unit; request-backed due units become available to order again.
  const releasedToRequest = lines.filter((line) => line.requestLineId && line.due > 0).reduce((sum, line) => sum + line.due, 0);
  const requestOpen = sourceRequest?.status === "approved";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("po-close"));

  const { requestClose } = useStockDirtyGuard(reason.trim() !== "", onClose, saving);
  const isStale = order.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("Enter a reason for closing the remaining units.");
      document.getElementById("close-rem-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This order changed while open. Review the latest order state above before closing remainder.");
      return;
    }
    setSaving(true);
    try {
      await closeMutation({
        orderId: order._id,
        expectedRevision: reviewedRevision,
        reason: reason.trim(),
        ...(closeDemand ? { closeRequestDemand: true } : {}),
        operationKey: opKey,
      });
      onClosed();
    } catch (cause) {
      setError(parseStockError(cause, "Could not close remainder.").message);
      setOpKey(createOperationKey("po-close"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Close remainder on {order.reference}</SheetTitle>
          <SheetDescription>
            Cancels all {order.dueUnits} remaining due units and sets On order for them to zero. Prior receipts and open holds remain intact.
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel={order.acceptedUnits > 0 ? "Close short" : "Cancel order"}
      >
        {isStale ? (
          <StockStaleBanner
            title="Purchase order changed while open"
            description={`This order moved from revision ${reviewedRevision} to ${order.revision} (${order.dueUnits} still due). Your reason is preserved — review the latest state before closing.`}
            actionLabel="Review updated order"
            onReview={() => {
              setReviewedRevision(order.revision);
              setError("");
              setOpKey(createOperationKey("po-close"));
            }}
          />
        ) : null}
        <div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-label="What closing changes">
          <p className="font-medium text-foreground">What closing changes</p>
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            <li>On order −{order.dueUnits}</li>
            {lines.filter((line) => line.due > 0).map((line) => (
              <li key={line._id}>{line.item.productName} · {line.item.variantLabel}: {line.due} cancelled</li>
            ))}
            {sourceRequest && releasedToRequest > 0 ? (
              <li>
                {closeDemand
                  ? `${sourceRequest.reference} will be closed; no units become available to order again.`
                  : requestOpen
                    ? `${sourceRequest.reference} will show ${releasedToRequest} available to order again.`
                    : `${sourceRequest.reference} is ${sourceRequest.status.replaceAll("_", " ")}; its availability does not change.`}
              </li>
            ) : null}
          </ul>
        </div>
        {sourceRequest && requestOpen && canCloseDemand ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-foreground" checked={closeDemand} onChange={(e) => setCloseDemand(e.target.checked)} />
            Also close the remaining demand on {sourceRequest.reference}
          </label>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="close-rem-reason">Reason</Label>
          <Input
            id="close-rem-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier discontinued remaining items"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
