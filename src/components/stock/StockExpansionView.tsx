"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowRightLeft, Layers, Plus, Send, ShieldAlert } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import {
  Callout,
  EditorSheet,
  NoticeBar,
  NumberField,
  SheetForm,
  useNotice,
} from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { Tone } from "@/components/admin/status-tones";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "@/platform/navigation";
import {
  createOperationKey,
  parseStockError,
  parseWholeQuantity,
  STOCK_PAGE_SIZE,
} from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import { useResolvedStockVariants, useStockDirtyGuard } from "./StockFormGuard";
import { StockLineEditor, type StockLineFieldErrors } from "./StockLineEditor";
import { LotDetailPanel } from "./StockLotDetailPanel";
import { StockVariantPickerDialog } from "./StockVariantPicker";

type TransferState = FunctionReturnType<typeof api.commerce.stockExpansion.listTransfers>["page"][number]["state"];

const TRANSFER_STATE_META: Record<TransferState, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  inTransit: { label: "In transit", tone: "info" },
  received: { label: "Received", tone: "success" },
  short: { label: "Closed short", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function StockExpansionView() {
  const { current: branch, branches } = useAdminBranch();
  const { notice, show, clear } = useNotice();
  const router = useRouter();
  const searchParams = useSearchParams();
  const variantIdParam = searchParams.get("variantId") as Id<"productVariants"> | null;

  const [tab, setTab] = useState<"transfers" | "lots" | "holds">(() => (variantIdParam ? "lots" : "transfers"));
  const [direction, setDirection] = useState<"origin" | "destination">("origin");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTransferId, setActiveTransferId] = useState<Id<"stockTransfers"> | null>(null);
  const [syncedVariantParam, setSyncedVariantParam] = useState<string | null>(variantIdParam);
  const [lotPickerOpen, setLotPickerOpen] = useState(false);

  if (variantIdParam !== syncedVariantParam) {
    setSyncedVariantParam(variantIdParam);
    if (variantIdParam) setTab("lots");
  }

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");

  const urlVariantIds = useMemo(
    () => (variantIdParam ? [variantIdParam] : []),
    [variantIdParam],
  );
  const { items: resolvedUrlVariants, loading: urlVariantLoading } = useResolvedStockVariants(
    branch?.id ?? null,
    urlVariantIds,
    {
      enabled: Boolean(access?.read),
      includeRecountFallback: true,
    },
  );
  const selectedLotVariant = resolvedUrlVariants[0];
  const urlVariantMissing = variantIdParam && !urlVariantLoading && !selectedLotVariant;

  const { results: transfers, status: transferStatus, loadMore } = usePaginatedQuery(
    api.commerce.stockExpansion.listTransfers,
    branch && access?.read && tab === "transfers" ? { branchId: branch.id, direction } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  if (!branch) return null;
  if (access === undefined) return <SkeletonRows label="Loading transfers and lots" rows={4} />;
  if (!access.read) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}.
      </Callout>
    );
  }

  const otherBranches = branches.filter((b) => b.id !== branch.id && b.state === "active");

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Transfers, lots & holds</h2>
          <p className="text-sm text-muted-foreground">
            Move stock between branches with distinct send and receive handoffs, inspect lot expiry balances, and review active holds.
          </p>
        </div>
        {tab === "transfers" && access.requester && otherBranches.length > 0 ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <ArrowRightLeft aria-hidden className="size-4" />
            New transfer
          </Button>
        ) : null}
      </div>

      <SegmentedTabs
        id="stock-expansion"
        label="Inventory expansion views"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "transfers", label: "Branch transfers" },
          { value: "lots", label: "Lots & expiry" },
          { value: "holds", label: "Holds & reservations" },
        ]}
      />

      {tab === "transfers" ? (
        <div {...tabPanelProps("stock-expansion", "transfers")} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedTabs
              label="Transfer direction"
              value={direction}
              onValueChange={setDirection}
              tabs={[
                { value: "origin", label: `Sending from ${branch.name}` },
                { value: "destination", label: `Receiving at ${branch.name}` },
              ]}
            />
          </div>

          <Card className="overflow-hidden">
            {transferStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading branch transfers" rows={4} />
            ) : transfers.length === 0 ? (
              <EmptyState
                action={
                  direction === "origin" && access.requester && otherBranches.length > 0 ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus aria-hidden className="size-4" />
                      Create transfer draft
                    </Button>
                  ) : null
                }
              >
                {direction === "origin"
                  ? `No outgoing transfers from ${branch.name} yet.`
                  : `No incoming transfers to ${branch.name} yet.`}
              </EmptyState>
            ) : (
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className={STACKED_TABLE.th}>
                      {direction === "origin" ? "Destination" : "Origin"}
                    </th>
                    <th scope="col" className={STACKED_TABLE.th}>Status</th>
                    <th scope="col" className={STACKED_TABLE.th}>Created</th>
                    <th scope="col" className={STACKED_TABLE.th}>Sent</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Action</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {transfers.map((transfer) => (
                    <tr key={transfer._id} className={STACKED_TABLE.row}>
                      <td
                        data-label={direction === "origin" ? "Destination" : "Origin"}
                        className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-medium text-foreground")}
                      >
                        {transfer.otherBranch || "Branch"}
                      </td>
                      <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                        <StatusBadge {...TRANSFER_STATE_META[transfer.state]} />
                      </td>
                      <td data-label="Created" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                        {staffDateTime(transfer.createdAt)}
                      </td>
                      <td data-label="Sent" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                        {transfer.sentAt ? staffDateTime(transfer.sentAt) : "—"}
                      </td>
                      <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveTransferId(transfer._id)}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {transferStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
                Load more transfers
              </Button>
            </div>
          ) : null}
        </div>
      ) : tab === "lots" ? (
        <div {...tabPanelProps("stock-expansion", "lots")} className="grid gap-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {selectedLotVariant
                  ? `${selectedLotVariant.productName} · ${selectedLotVariant.label}${selectedLotVariant.sku ? ` (${selectedLotVariant.sku})` : ""} · ${branch.name}`
                  : urlVariantLoading
                    ? `Loading selected item for ${branch.name}…`
                    : `Choose a stock item to inspect lot & expiry balances at ${branch.name}`}
              </p>
              <p className="text-xs text-muted-foreground">
                View FEFO expiry dates, sellable vs held quantities, enable lot tracking on new items, or post lot counts and adjustments.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setLotPickerOpen(true)}>
              <Layers aria-hidden className="size-4" />
              {selectedLotVariant ? "Change item" : "Select item"}
            </Button>
          </Card>

          {urlVariantLoading && !selectedLotVariant ? (
            <SkeletonRows label="Loading selected lot item" rows={3} />
          ) : urlVariantMissing ? (
            <Callout tone="warning" title="Selected item unavailable">
              That stock item could not be loaded for {branch.name} — it may be archived or unavailable. Choose another item above.
            </Callout>
          ) : selectedLotVariant ? (
            <LotDetailPanel
              key={`${branch.id}:${selectedLotVariant.variantId}`}
              branchId={branch.id}
              branchName={branch.name}
              variant={selectedLotVariant}
              onSuccess={(msg) => show(msg, "success")}
            />
          ) : null}
        </div>
      ) : (
        <div {...tabPanelProps("stock-expansion", "holds")} className="grid gap-4">
          <Callout
            tone="info"
            title="Supplier held goods & stock reservations"
            action={
              <ButtonLink href="/admin/stock/purchasing?tab=holds" size="sm">
                Open Purchasing Held Goods
              </ButtonLink>
            }
          >
            Excess or substitute supplier deliveries held for buyer decision are managed in the Purchasing Held Goods queue. Active stock reservations per item are visible in the Lots & expiry tab above (Held vs Sellable).
          </Callout>
          <Card className="grid gap-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert aria-hidden className="size-4 text-amber-600" />
              <span>Inspect held & reserved units for a specific item</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick any variant to check its exact On hand, Held (reserved), and Sellable availability at {branch.name}.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setTab("lots");
                  setLotPickerOpen(true);
                }}
              >
                Pick item to check holds
              </Button>
            </div>
          </Card>
        </div>
      )}

      <StockVariantPickerDialog
        open={lotPickerOpen}
        onOpenChange={setLotPickerOpen}
        branchId={branch.id}
        title="Select item for lot & hold balances"
        onSelect={(item) => {
          router.replace(`/admin/stock/expansion?variantId=${encodeURIComponent(item.variantId)}`);
        }}
      />

      {createOpen ? (
        <CreateTransferSheet
          originId={branch.id}
          originName={branch.name}
          destinations={otherBranches}
          onClose={() => setCreateOpen(false)}
          onCreated={(transferId) => {
            setCreateOpen(false);
            setActiveTransferId(transferId);
            show("Transfer draft created.", "success");
          }}
        />
      ) : null}

      {activeTransferId ? (
        <TransferDetailSheet
          branchId={branch.id}
          transferId={activeTransferId}
          onClose={() => setActiveTransferId(null)}
          onSuccess={(msg) => show(msg, "success")}
        />
      ) : null}
    </div>
  );
}

function CreateTransferSheet({
  originId,
  originName,
  destinations,
  onClose,
  onCreated,
}: {
  originId: Id<"branches">;
  originName: string;
  destinations: readonly { id: Id<"branches">; name: string }[];
  onClose: () => void;
  onCreated: (transferId: Id<"stockTransfers">) => void;
}) {
  const createTransfer = useMutation(api.commerce.stockExpansion.createTransfer);
  const [destinationId, setDestinationId] = useState<string>(destinations[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<StockLineDraft[]>([]);
  const [lineErrors, setLineErrors] = useState<StockLineFieldErrors>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => createOperationKey("transfer-create"));

  const isDirty = lines.length > 0 || note.trim() !== "";
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
      const id = await createTransfer({
        originId,
        destinationId: destinationId as Id<"branches">,
        requestId,
        note: note.trim() || undefined,
        lines: payloadLines,
      });
      onCreated(id);
    } catch (cause) {
      setError(parseStockError(cause, "Could not create transfer draft.").message);
      setRequestId(createOperationKey("transfer-create"));
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
            <SheetTitle>New branch transfer</SheetTitle>
            <SheetDescription>Sending from {originName}. Stock deducts when the transfer is sent.</SheetDescription>
          </>
        }
      >
        <SheetForm
          onSubmit={handleSubmit}
          onCancel={requestClose}
          saving={saving}
          error={error}
          submitLabel="Create transfer draft"
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
              setRequestId(createOperationKey("transfer-create"));
            }}
            lineErrors={lineErrors}
            onAddClick={() => setPickerOpen(true)}
            addLabel="Add item"
            idPrefix="transfer-line"
          />

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
        title="Add item to transfer"
        onSelect={(item) => {
          setLines((current) => [
            ...current,
            {
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              quantityText: "1",
            },
          ]);
        }}
      />
    </>
  );
}

function TransferDetailSheet({
  branchId,
  transferId,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  transferId: Id<"stockTransfers">;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const detail = useQuery(api.commerce.stockExpansion.transferDetail, { branchId, transferId });
  const {
    results: pagedEvents,
    status: eventsStatus,
    loadMore: loadMoreEvents,
  } = usePaginatedQuery(api.commerce.stockExpansion.transferEvents, { branchId, transferId }, { initialNumItems: 10 });
  const confirm = useConfirm();
  const sendTransfer = useMutation(api.commerce.stockExpansion.sendTransfer);
  const receiveTransfer = useMutation(api.commerce.stockExpansion.receiveTransfer);
  const closeShort = useMutation(api.commerce.stockExpansion.closeTransferShort);
  const cancelTransfer = useMutation(api.commerce.stockExpansion.cancelTransfer);

  const [receiveInputs, setReceiveInputs] = useState<Record<string, string>>({});
  const [shortReason, setShortReason] = useState("");
  const [showShortForm, setShowShortForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDirty =
    Object.values(receiveInputs).some((val) => val.trim() !== "") ||
    (showShortForm && shortReason.trim() !== "");
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, busy);

  async function handleSend() {
    setError("");
    setBusy(true);
    try {
      await sendTransfer({ transferId });
      onSuccess("Transfer sent and marked in transit.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not send transfer.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    const ok = await confirm({
      title: "Cancel this draft transfer?",
      description: "Draft transfers have not deducted stock.",
      confirmLabel: "Cancel transfer",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setBusy(true);
    try {
      await cancelTransfer({ transferId, requestId: createOperationKey("transfer-cancel") });
      onSuccess("Transfer cancelled.");
      onClose();
    } catch (cause) {
      setError(parseStockError(cause, "Could not cancel transfer.").message);
      setBusy(false);
    }
  }

  async function handleReceive(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setError("");
    const lines: { lineId: Id<"stockTransferLines">; quantity: number }[] = [];
    for (const line of detail.lines) {
      const remaining = line.quantity - line.received;
      if (remaining <= 0) continue;
      const raw = (receiveInputs[line._id] ?? "").trim();
      if (!raw) continue;
      const parsed = parseWholeQuantity(raw, { allowZero: false, max: remaining });
      if (!parsed.ok || !parsed.value) {
        setError(parsed.ok ? "Enter a valid quantity to receive." : parsed.error);
        document.getElementById(`tr-recv-${line._id}`)?.focus();
        return;
      }
      lines.push({ lineId: line._id, quantity: parsed.value });
    }
    if (lines.length === 0) {
      setError("Enter at least one received quantity.");
      return;
    }
    setBusy(true);
    try {
      await receiveTransfer({
        transferId,
        requestId: createOperationKey("transfer-recv"),
        lines,
      });
      setReceiveInputs({});
      onSuccess("Transfer receipt posted.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not receive transfer.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseShort(event: FormEvent) {
    event.preventDefault();
    if (!shortReason.trim()) {
      setError("Enter a shortage reason before closing short.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await closeShort({
        branchId,
        transferId,
        requestId: createOperationKey("transfer-short"),
        reason: shortReason.trim(),
      });
      setShowShortForm(false);
      onSuccess("Transfer closed short with shortage recorded.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not close transfer short.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Branch transfer</SheetTitle>
          <SheetDescription>
            {detail ? `${detail.origin ?? "Origin"} → ${detail.destination ?? "Destination"}` : "Loading transfer…"}
          </SheetDescription>
        </>
      }
    >
      {!detail ? (
        <div className="p-6">
          <SkeletonRows label="Loading transfer details" rows={4} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-5 sm:px-6">
            {error ? (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge {...TRANSFER_STATE_META[detail.transfer.state]} />
              <div className="flex flex-wrap gap-2">
                {detail.transfer.state === "draft" && detail.permissions.send ? (
                  <Button type="button" size="sm" disabled={busy} onClick={() => void handleSend()}>
                    <Send aria-hidden className="size-4" />
                    Send transfer
                  </Button>
                ) : null}
                {detail.transfer.state === "draft" && detail.permissions.cancel ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleCancel()}>
                    Cancel draft
                  </Button>
                ) : null}
                {detail.transfer.state === "inTransit" && detail.permissions.closeShort ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setShowShortForm((v) => !v)}
                  >
                    Close short
                  </Button>
                ) : null}
              </div>
            </div>

            {detail.transfer.shortageReason ? (
              <Callout tone="warning" title="Shortage recorded">
                {detail.transfer.shortageReason}
              </Callout>
            ) : null}

            {showShortForm ? (
              <form onSubmit={handleCloseShort} className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
                <Label htmlFor="short-reason">Shortage reason</Label>
                <Input
                  id="short-reason"
                  value={shortReason}
                  onChange={(event) => setShortReason(event.target.value)}
                  placeholder="Describe missing or damaged units in transit"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowShortForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" size="sm" disabled={busy}>
                    Confirm close short
                  </Button>
                </div>
              </form>
            ) : null}

            <form onSubmit={handleReceive} className="grid gap-3">
              <h3 className="text-sm font-semibold text-foreground">Transfer lines</h3>
              <ul className="grid gap-2.5">
                {detail.lines.map((line) => {
                  const remaining = line.quantity - line.received;
                  return (
                    <li key={line._id} className="grid gap-2 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {line.productName ?? "Item"} · {line.label ?? ""}
                          </p>
                          {line.sku ? <p className="font-mono text-xs text-muted-foreground">{line.sku}</p> : null}
                        </div>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          Sent {line.quantity} · Received {line.received} · Remaining{" "}
                          <strong className="text-foreground">{remaining}</strong>
                        </span>
                      </div>
                      {detail.transfer.state === "inTransit" && detail.permissions.receive && remaining > 0 ? (
                        <div className="grid gap-1.5 sm:max-w-xs">
                          <Label htmlFor={`tr-recv-${line._id}`}>Receive now (max {remaining})</Label>
                          <NumberField
                            id={`tr-recv-${line._id}`}
                            value={receiveInputs[line._id] ?? ""}
                            placeholder={String(remaining)}
                            onChange={(event) =>
                              setReceiveInputs((current) => ({ ...current, [line._id]: event.target.value }))
                            }
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {detail.transfer.state === "inTransit" && detail.permissions.receive ? (
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy}>
                    Post transfer receipt
                  </Button>
                </div>
              ) : null}
            </form>

            {pagedEvents.length > 0 ? (
              <section aria-label="Transfer events" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">Transfer history</h3>
                <ol className="divide-y divide-border rounded-lg border border-border">
                  {pagedEvents.map((ev) => (
                    <li key={ev._id} className="grid gap-0.5 p-3 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium capitalize text-foreground">{ev.kind}</span>
                        <span className="tabular-nums text-muted-foreground">{staffDateTime(ev.createdAt)}</span>
                      </div>
                      {ev.reason ? <p className="text-muted-foreground">{ev.reason}</p> : null}
                    </li>
                  ))}
                </ol>
                {eventsStatus === "CanLoadMore" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => loadMoreEvents(10)}>
                    Load earlier transfer events
                  </Button>
                ) : null}
              </section>
            ) : null}
          </div>
          <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={requestClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </EditorSheet>
  );
}
