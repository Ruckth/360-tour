"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { MAX_TRANSFER_LINES } from "convex/shared/commerce/caps";
import { useRef, useState, type FormEvent } from "react";
import { EditorSheet, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createOperationKey, parseStockError, parseWholeQuantity } from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import { useStockDirtyGuard } from "./StockFormGuard";
import { StockLineEditor, type StockLineFieldErrors } from "./StockLineEditor";
import { StockVariantPickerDialog } from "./StockVariantPicker";

type TransferDetail = NonNullable<FunctionReturnType<typeof api.commerce.stockExpansion.transferDetail>>;

export function CreateTransferSheet({
  originId,
  originName,
  destinations,
  onClose,
  onCreated,
  draft,
}: {
  draft?: TransferDetail;
  originId: Id<"branches">;
  originName: string;
  destinations: readonly { id: Id<"branches">; name: string }[];
  onClose: () => void;
  onCreated: (transferId: Id<"stockTransfers">) => void;
}) {
  const createTransfer = useMutation(api.commerce.stockExpansion.createTransfer);
  const editTransfer = useMutation(api.commerce.stockExpansion.editTransfer);
  const [destinationId, setDestinationId] = useState<string>(draft?.transfer.destinationId ?? destinations[0]?.id ?? "");
  const [note, setNote] = useState(draft?.transfer.note ?? "");
  const [lines, setLines] = useState<StockLineDraft[]>(() => draft?.lines.map((line) => ({
    variantId: line.variantId, productName: line.productName ?? "Item", variantLabel: line.label ?? "",
    sku: line.sku, onHand: line.onHand, quantityText: String(line.quantity),
  })) ?? []);
  const [lineErrors, setLineErrors] = useState<StockLineFieldErrors>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingCreate = useRef<{ payload: string; requestId: string } | null>(null);
  const availability = useQuery(api.commerce.stockExpansion.transferAvailability,
    lines.length ? { branchId: originId, variantIds: lines.map((line) => line.variantId) } : "skip");

  const originalDestination = draft?.transfer.destinationId ?? destinations[0]?.id ?? "";
  const originalLines = draft?.lines.map((line) => [line.variantId, String(line.quantity)]) ?? [];
  const isDirty = destinationId !== originalDestination || note.trim() !== (draft?.transfer.note ?? "") ||
    JSON.stringify(lines.map((line) => [line.variantId, line.quantityText])) !== JSON.stringify(originalLines);
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const errs: StockLineFieldErrors = {};
    let firstInvalidId: string | undefined;
    if (!destinationId) {
      setError("Choose a destination branch.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one item to transfer.");
      return;
    }
    const payloadLines: { variantId: Id<"productVariants">; quantity: number }[] = [];
    for (const line of lines) {
      const parsed = parseWholeQuantity(line.quantityText, { allowZero: false });
      if (!parsed.ok || !parsed.value) {
        errs[line.variantId] = { quantity: parsed.ok ? "Enter a quantity." : parsed.error };
        firstInvalidId ??= `transfer-line-qty-${line.variantId}`;
      } else {
        payloadLines.push({ variantId: line.variantId, quantity: parsed.value });
      }
    }
    setLineErrors(errs);
    if (Object.keys(errs).length > 0) {
      if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
      return;
    }

    setSaving(true);
    try {
      const content = { destinationId: destinationId as Id<"branches">, note: note.trim() || undefined, lines: payloadLines };
      const payload = JSON.stringify([content.destinationId, content.note, payloadLines.map((line) => [line.variantId, line.quantity]).sort()]);
      if (pendingCreate.current?.payload !== payload) {
        pendingCreate.current = { payload, requestId: createOperationKey("transfer-create") };
      }
      const id = draft
        ? await editTransfer({ ...content, transferId: draft.transfer._id, revision: draft.transfer.revision })
        : await createTransfer({ ...content, originId, requestId: pendingCreate.current.requestId });
      onCreated(id);
    } catch (cause) {
      setError(parseStockError(cause, "Could not create transfer draft.").message);
      setSaving(false);
    }
  }

  return (
    <>
      <EditorSheet
        open
        wide
        onClose={requestClose}
        header={
          <>
            <SheetTitle>{draft ? `Edit ${draft.transfer.reference}` : "New branch transfer"}</SheetTitle>
            <SheetDescription>Sending from {originName}. Stock deducts when the transfer is sent.</SheetDescription>
          </>
        }
      >
        <SheetForm
          onSubmit={handleSubmit}
          onCancel={requestClose}
          saving={saving}
          error={error}
          submitLabel={draft ? "Save draft changes" : "Create transfer draft"}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="transfer-dest">Destination branch</Label>
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger id="transfer-dest">
                <SelectValue placeholder="Choose destination" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((dest) => (
                  <SelectItem key={dest.id} value={dest.id}>
                    {dest.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <StockLineEditor
            lines={lines}
            onChange={(next) => {
              setLines(next);
              setLineErrors({});
            }}
            lineErrors={lineErrors}
            onAddClick={() => setPickerOpen(true)}
            addLabel="Add item"
            maxLines={MAX_TRANSFER_LINES}
            idPrefix="transfer-line"
          />

          {availability?.map((row) => {
            const item = lines.find((line) => line.variantId === row.variantId);
            return item ? (
              <p key={row.variantId} className="text-sm text-muted-foreground">
                {item.sku || item.productName} · On hand {row.onHand} · Dispatchable {row.sellable}
                {Number(item.quantityText) > row.sellable ? " · Requested quantity exceeds stock available after holds and expiry." : ""}
              </p>
            ) : null;
          })}
          <div className="grid gap-1.5">
            <Label htmlFor="transfer-note">Note (optional)</Label>
            <Input
              id="transfer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Dispatch reference or driver note"
            />
          </div>
        </SheetForm>
      </EditorSheet>

      <StockVariantPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        branchId={originId}
        selectedIds={lines.map((line) => line.variantId)}
        maxLines={MAX_TRANSFER_LINES}
        title="Add items to transfer"
        onSelectMany={(items) => {
          setLines((current) => [
            ...current,
            ...items.map((item) => ({
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              quantityText: "1",
            })),
          ]);
        }}
      />
    </>
  );
}
