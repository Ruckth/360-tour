"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { flushSync } from "react-dom";
import { ArrowRightLeft, ArrowLeft, Filter, Layers, Plus, Send } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import list from "./StockRecordList.module.css";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import {
  Callout,
  EditorSheet,
  NoticeBar,
  NumberField,
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
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { staffDate, staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "@/platform/navigation";
import {
  createOperationKey,
  parseStockError,
  parseWholeQuantity,
  sanitizeStockReturnTo,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
} from "./stock-format";
import { useResolvedStockVariants, useStockDirtyGuard } from "./StockFormGuard";
import { LotDetailPanel } from "./StockLotDetailPanel";
import { MovementInspectSheet } from "./MovementInspectSheet";
import { CreateTransferSheet } from "./CreateTransferSheet";
import { StockVariantPickerDialog } from "./StockVariantPicker";

type TransferState = FunctionReturnType<typeof api.commerce.stockExpansion.listTransfers>["page"][number]["state"];

type TransferDetail = NonNullable<FunctionReturnType<typeof api.commerce.stockExpansion.transferDetail>>;
type TransferLine = TransferDetail["lines"][number];

function receiptFields(line: TransferLine): { id: string; lotId?: Id<"stockLots">; label: string; remaining: number }[] {
  return line.lots.length
    ? line.lots.map((lot) => ({ id: lot.lotId, lotId: lot.lotId, label: `${lot.code ?? lot.lotId}${lot.expiresAt ? ` · expires ${staffDate(lot.expiresAt)}` : ""}`, remaining: lot.quantity - lot.received }))
    : [{ id: line._id, lotId: undefined, label: "Receive now", remaining: line.quantity - line.received }];
}

function transferItem(line: TransferLine | undefined) {
  return line ? [line.productName, line.label, line.sku].filter(Boolean).join(" · ") || "Item" : "Item";
}

const TRANSFER_STATE_META: Record<TransferState, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  inTransit: { label: "In transit", tone: "info" },
  received: { label: "Received", tone: "success" },
  short: { label: "Closed short", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

type TransferDirection = "origin" | "destination";
type TransferFilter = TransferState | "all";

function TransferStatusFilter({ state, onChange }: { state: TransferFilter; onChange: (value: TransferFilter) => void }) {
  return (
    <Select value={state} onValueChange={(value) => onChange(value as TransferFilter)}>
      <SelectTrigger aria-label="Transfer status" className="w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        {Object.entries(TRANSFER_STATE_META).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function StockExpansionView() {
  const { current: branch, branches } = useAdminBranch();
  const { notice, show, clear } = useNotice();
  const router = useRouter();
  const searchParams = useSearchParams();
  const variantIdParam = searchParams.get("variantId") as Id<"productVariants"> | null;
  const lotIdParam = searchParams.get("lotId");
  const activeTransferId = searchParams.get("transferId");
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));
  const viewParam = searchParams.get("view");
  const tab = viewParam === "transfers" || viewParam === "lots" || viewParam === "holds"
    ? viewParam : !activeTransferId && variantIdParam ? "lots" : "transfers";
  const direction: TransferDirection = searchParams.get("direction") === "destination" ? "destination" : "origin";
  const state = (Object.keys(TRANSFER_STATE_META) as TransferState[]).find(value => value === searchParams.get("status")) ?? "all";
  const [createOriginId, setCreateOriginId] = useState<Id<"branches"> | null>(null);
  const [lotPickerOpen, setLotPickerOpen] = useState(false);

  function updateSearch(values: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.replace(params.size ? `/admin/stock/expansion?${params}` : "/admin/stock/expansion", { scroll: false });
  }
  function setActiveTransferId(id: Id<"stockTransfers"> | null) {
    updateSearch({ transferId: id });
  }
  function setDirection(value: TransferDirection) {
    updateSearch({ direction: value === "destination" ? value : null, status: value === "destination" ? "inTransit" : null });
  }
  function setState(value: TransferFilter) {
    updateSearch({ status: value === "all" ? null : value });
  }
  function openLots(id: Id<"productVariants">) {
    updateSearch({ variantId: id, lotId: null, view: "lots" });
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
    branch && access?.read && tab === "transfers" ? { branchId: branch.id, direction, state: state === "all" ? undefined : state } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  if (createOriginId && createOriginId !== branch?.id) setCreateOriginId(null);

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
          <p className="text-xs text-muted-foreground">{branch.name}</p>
        </div>
        {returnTo ? <ButtonLink href={returnTo} variant="ghost" size="sm"><ArrowLeft aria-hidden className="size-4" />Back to {stockReturnLabel(returnTo, "Stock")}</ButtonLink> : null}
        {tab === "transfers" && access.requester && otherBranches.length > 0 ? (
          <Button type="button" onClick={() => setCreateOriginId(branch.id)}>
            <ArrowRightLeft aria-hidden className="size-4" />
            New transfer
          </Button>
        ) : null}
      </div>

      <SegmentedTabs
        id="stock-expansion"
        label="Inventory expansion views"
        value={tab}
        onValueChange={(next) => updateSearch({ view: next })}
        tabs={[
          { value: "transfers", label: "Branch transfers" },
          { value: "lots", label: "Lots & expiry" },
          { value: "holds", label: "Holds & reservations" },
        ]}
      />

      {tab === "transfers" ? (
        <div {...tabPanelProps("stock-expansion", "transfers")} className="grid gap-4">
          <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
            <SegmentedTabs
              label="Transfer direction"
              value={direction}
              onValueChange={setDirection}
              tabs={[
                { value: "origin", label: `Sending from ${branch.name}` },
                { value: "destination", label: `Receiving at ${branch.name}` },
              ]}
            />
            <TransferStatusFilter state={state} onChange={setState} />
          </div>
          <div className="flex items-center justify-between gap-2 sm:hidden">
            <p className="min-w-0 text-xs text-muted-foreground" role="status">
              {direction === "origin" ? "Outgoing" : "Incoming"} · {state === "all" ? "All statuses" : TRANSFER_STATE_META[state].label}
            </p>
            <Sheet>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="min-h-11">
                  <Filter aria-hidden className="size-4" />Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <SheetHeader>
                  <SheetTitle>Transfer filters</SheetTitle>
                  <SheetDescription>Filter transfers for {branch.name}.</SheetDescription>
                </SheetHeader>
                <Select value={direction} onValueChange={(value) => setDirection(value as TransferDirection)}>
                  <SelectTrigger aria-label="Transfer direction" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="origin">Outgoing</SelectItem>
                    <SelectItem value="destination">Incoming</SelectItem>
                  </SelectContent>
                </Select>
                <TransferStatusFilter state={state} onChange={setState} />
                <SheetClose asChild><Button type="button" className="min-h-11">Done</Button></SheetClose>
              </SheetContent>
            </Sheet>
          </div>

          <Card className={cn("overflow-hidden", list.frame)}>
            {transferStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading branch transfers" rows={4} />
            ) : transfers.length === 0 ? (
              <EmptyState
                action={
                  direction === "origin" && access.requester && otherBranches.length > 0 ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreateOriginId(branch.id)}>
                      <Plus aria-hidden className="size-4" />
                      Create transfer draft
                    </Button>
                  ) : null
                }
              >
                {state !== "all"
                  ? `No ${direction === "origin" ? "outgoing" : "incoming"} transfers match ${TRANSFER_STATE_META[state].label.toLowerCase()} at ${branch.name}.`
                  : direction === "origin"
                    ? `No outgoing transfers from ${branch.name} yet.`
                    : `No incoming transfers to ${branch.name} yet.`}
              </EmptyState>
            ) : (
              <table role="table" className={list.table}>
                <thead className="admin-eyebrow">
                  <tr>
                    <th scope="col">
                      {direction === "origin" ? "Destination" : "Origin"}
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">Sent</th>
                    <th scope="col" className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr key={transfer._id} className={list.rowWithActions}>
                      <td
                        data-label={direction === "origin" ? "Destination" : "Origin"}
                        className="font-medium text-foreground"
                      >
                        <p>{transfer.otherBranch || "Branch"}</p>
                        <p className="font-mono text-xs text-muted-foreground">{transfer.reference}</p>
                      </td>
                      <td data-label="Status">
                        <StatusBadge {...TRANSFER_STATE_META[transfer.state]} />
                      </td>
                      <td data-label="Created" className="text-xs tabular-nums text-muted-foreground">
                        {staffDateTime(transfer.createdAt)}
                      </td>
                      <td data-label="Sent" className="text-xs tabular-nums text-muted-foreground">
                        {transfer.sentAt ? staffDateTime(transfer.sentAt) : "—"}
                      </td>
                      <td className="lg:text-right">
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
          <Card className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {selectedLotVariant
                  ? `${selectedLotVariant.productName} · ${selectedLotVariant.label}${selectedLotVariant.sku ? ` (${selectedLotVariant.sku})` : ""} · ${branch.name}`
                  : urlVariantLoading
                    ? `Loading selected item for ${branch.name}…`
                    : `Choose a stock item to inspect lot & expiry balances at ${branch.name}`}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setLotPickerOpen(true)}>
              <Layers aria-hidden className="hidden size-4 sm:block" />
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
              key={`${branch.id}:${selectedLotVariant.variantId}:${lotIdParam ?? ""}`}
              branchId={branch.id}
              branchName={branch.name}
              variant={selectedLotVariant}
              requestedLotId={lotIdParam}
              onSuccess={(msg) => show(msg, "success")}
            />
          ) : null}
          <BranchExpiry
            key={`${branch.id}:${variantIdParam ?? ""}`}
            branchId={branch.id}
            initiallyOpen={!variantIdParam}
            onSelect={openLots}
          />
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
            Review excess or substitute supplier deliveries in the Purchasing Held Goods queue.
          </Callout>
          <BranchReservations branchId={branch.id} />
        </div>
      )}

      <StockVariantPickerDialog
        open={lotPickerOpen}
        onOpenChange={setLotPickerOpen}
        branchId={branch.id}
        title="Select item for lot & hold balances"
        onSelect={(item) => {
          openLots(item.variantId);
        }}
      />

      {createOriginId === branch.id ? (
        <CreateTransferSheet
          originId={branch.id}
          originName={branch.name}
          destinations={otherBranches}
          onClose={() => setCreateOriginId(null)}
          onCreated={(transferId) => {
            setCreateOriginId(null);
            setActiveTransferId(transferId);
            show("Transfer draft created.", "success");
          }}
        />
      ) : null}

      {activeTransferId ? (
        <TransferDetailSheet
          key={`${branch.id}:${activeTransferId}`}
          branchId={branch.id}
          transferId={activeTransferId}
          destinations={otherBranches}
          access={access}
          onClose={() => setActiveTransferId(null)}
          onSuccess={(msg) => show(msg, "success")}
        />
      ) : null}
    </div>
  );
}

function BranchExpiry({ branchId, initiallyOpen, onSelect }: {
  branchId: Id<"branches">;
  initiallyOpen: boolean;
  onSelect: (id: Id<"productVariants">) => void;
}) {
  const [expiryWindow, setExpiryWindow] = useState<"due" | "expired" | "week" | "month">("due");
  const [open, setOpen] = useState(initiallyOpen);
  const { results, status, loadMore } = usePaginatedQuery(api.commerce.stockExpansion.branchExpiry,
    open ? { branchId, window: expiryWindow } : "skip", { initialNumItems: STOCK_PAGE_SIZE });
  return (
    <Card className="px-3">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer py-2.5 text-sm font-semibold">Branch lot expiry queue</summary>
        <div className="grid gap-3 border-t pb-3 pt-2">
          <Select value={expiryWindow} onValueChange={(value) => setExpiryWindow(value as typeof expiryWindow)}>
            <SelectTrigger aria-label="Expiry window" className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="due">Expired + next 30 days</SelectItem>
              <SelectItem value="expired">Expired only</SelectItem>
              <SelectItem value="week">Next 7 days</SelectItem>
              <SelectItem value="month">Next 30 days</SelectItem>
            </SelectContent>
          </Select>
          {status === "LoadingFirstPage" ? <SkeletonRows label="Loading expiry queue" rows={2} /> :
            !results.length ? <EmptyState>No lots with stock expire within this window.</EmptyState> :
              <ul className="divide-y divide-border">
                {results.map((lot) => (
                  <li key={lot._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="font-medium">{[lot.name, lot.label, lot.sku].filter(Boolean).join(" · ") || "Item"}</p>
                      <p className="text-xs text-muted-foreground">{lot.code ?? "Lot"} · {lot.onHand} on hand · {lot.expired ? "Expired" : "Expires"} {staffDate(lot.expiresAt)}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => onSelect(lot.variantId)}>View item lots</Button>
                  </li>
                ))}
              </ul>}
          {status === "CanLoadMore" ? <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>Load more lots</Button> : null}
        </div>
      </details>
    </Card>
  );
}

function BranchReservations({ branchId }: { branchId: Id<"branches"> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.commerce.stockExpansion.branchReservations, { branchId }, { initialNumItems: STOCK_PAGE_SIZE });
  return (
    <Card className="grid gap-3 p-4">
      <h3 className="text-sm font-semibold">Active stock reservations</h3>
      {status === "LoadingFirstPage" ? <SkeletonRows label="Loading reservations" rows={2} /> :
        !results.length ? <EmptyState>No active reservations at this branch.</EmptyState> :
          <ul className="divide-y divide-border">
            {results.map((row) => (
              <li key={row._id} className="grid gap-1 py-2 text-sm sm:grid-cols-2">
                <p className="font-medium">{[row.name, row.label, row.sku].filter(Boolean).join(" · ") || "Item"}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-muted-foreground">{row.checkout ? "Checkout hold" : "Stock hold"} · {row.quantity} units · Expires {staffDateTime(row.expiresAt)}</p>
                  {row.orderId ? <ButtonLink variant="outline" size="sm" href={`/admin/checkout?order=${encodeURIComponent(row.orderId)}`}>Open order</ButtonLink> : null}
                </div>
              </li>
            ))}
          </ul>}
      {status === "CanLoadMore" ? <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>Load more reservations</Button> : null}
    </Card>
  );
}

function TransferDetailSheet({
  branchId,
  transferId,
  destinations,
  access,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  transferId: string;
  destinations: readonly { id: Id<"branches">; name: string }[];
  access: FunctionReturnType<typeof api.commerce.stock.access>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const detail = useQuery(api.commerce.stockExpansion.transferDetail, { branchId, transferId });
  const {
    results: pagedEvents,
    status: eventsStatus,
    loadMore: loadMoreEvents,
  } = usePaginatedQuery(api.commerce.stockExpansion.transferEvents, detail ? { branchId, transferId: detail.transfer._id } : "skip", { initialNumItems: 10 });
  const confirm = useConfirm();
  const sendTransfer = useMutation(api.commerce.stockExpansion.sendTransfer);
  const receiveTransfer = useMutation(api.commerce.stockExpansion.receiveTransfer);
  const closeShort = useMutation(api.commerce.stockExpansion.closeTransferShort);
  const cancelTransfer = useMutation(api.commerce.stockExpansion.cancelTransfer);

  const [receiveInputs, setReceiveInputs] = useState<Record<string, string>>({});
  const [pendingReceipt, setPendingReceipt] = useState<{ payload: string; requestId: string } | null>(null);
  const canRetryCompletedReceipt = detail?.transfer.state === "received" && detail.permissions.receive && pendingReceipt !== null;
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [shortReason, setShortReason] = useState("");
  const [pendingShort, setPendingShort] = useState<{ payload: string; requestId: string } | null>(null);
  const retryClosedShort = detail?.transfer.state === "short" && detail.permissions.closeShort && pendingShort !== null;
  const [shortReview, setShortReview] = useState<{ lineId: Id<"stockTransferLines">; quantity: number }[] | null>(null);
  const [editing, setEditing] = useState<TransferDetail | null>(null);
  const [movementId, setMovementId] = useState<Id<"stockMovements"> | null>(null);
  const remainingLines = detail?.lines.filter((line) => line.received < line.quantity)
    .map((line) => ({ lineId: line._id, quantity: line.quantity - line.received })) ?? [];
  const reviewChanged = shortReview && JSON.stringify(shortReview) !== JSON.stringify(remainingLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDirty =
    Object.values(receiveInputs).some((val) => val.trim() !== "") ||
    (shortReview !== null && shortReason.trim() !== "");
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, busy);

  async function copyTransferLink() {
    setError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      onSuccess("Transfer link copied.");
    } catch {
      setError("Could not copy the transfer link. Copy it from the address bar.");
    }
  }

  async function handleSend() {
    if (!detail) return;
    const units = detail.lines.reduce((sum, line) => sum + line.quantity, 0);
    const ok = await confirm({
      title: "Send this transfer and deduct stock?",
      description: `${detail.origin ?? "Origin"} → ${detail.destination ?? "Destination"} · ${detail.lines.length} ${detail.lines.length === 1 ? "line" : "lines"} · ${units} ${units === 1 ? "unit" : "units"}`,
      confirmLabel: "Send transfer",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setBusy(true);
    try {
      await sendTransfer({ transferId: detail.transfer._id, revision: detail.transfer.revision });
      onSuccess("Transfer sent and marked in transit.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not send transfer.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!detail) return;
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
      await cancelTransfer({ transferId: detail.transfer._id, requestId: createOperationKey("transfer-cancel") });
      onSuccess("Transfer cancelled.");
      onClose();
    } catch (cause) {
      setError(parseStockError(cause, "Could not cancel transfer.").message);
      setBusy(false);
    }
  }

  async function handleReceive(event: FormEvent) {
    event.preventDefault();
    if (!detail || busy) return;
    setError("");
    const lines: { lineId: Id<"stockTransferLines">; quantity: number; allocations?: { lotId: Id<"stockLots">; quantity: number }[] }[] = [];
    for (const line of detail.lines) {
      let quantity = 0;
      const allocations: { lotId: Id<"stockLots">; quantity: number }[] = [];
      for (const field of receiptFields(line)) {
        const raw = (receiveInputs[field.id] ?? "").trim();
        if (!raw) continue;
        const parsed = parseWholeQuantity(raw, { allowZero: false });
        if (!parsed.ok || !parsed.value) {
          flushSync(() => setShowLineErrors(true));
          document.getElementById(`tr-recv-${field.id}`)?.focus();
          return;
        }
        quantity += parsed.value;
        if (field.lotId) allocations.push({ lotId: field.lotId, quantity: parsed.value });
      }
      if (quantity) lines.push({ lineId: line._id, quantity, allocations: allocations.length ? allocations : undefined });
    }
    const payload = JSON.stringify([transferId, lines]);
    if (pendingReceipt?.payload !== payload) {
      if (detail.transfer.state !== "inTransit") return;
      for (const line of detail.lines) {
        const invalid = receiptFields(line).find((field) => receiveInputs[field.id]?.trim() &&
          !parseWholeQuantity(receiveInputs[field.id], { allowZero: false, max: field.remaining }).ok);
        if (invalid) {
          flushSync(() => setShowLineErrors(true));
          document.getElementById(`tr-recv-${invalid.id}`)?.focus();
          return;
        }
      }
    }
    if (lines.length === 0) {
      setError("Enter at least one received quantity.");
      return;
    }
    setBusy(true);
    try {
      const operation = pendingReceipt?.payload === payload
        ? pendingReceipt : { payload, requestId: createOperationKey("transfer-recv") };
      setPendingReceipt(operation);
      await receiveTransfer({ transferId: detail.transfer._id, requestId: operation.requestId, lines });
      setPendingReceipt(null);
      setReceiveInputs({});
      setShowLineErrors(false);
      onSuccess("Transfer receipt posted.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not receive transfer.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseShort(event: FormEvent) {
    event.preventDefault();
    if (!detail || !shortReview || busy) return;
    const reason = shortReason.trim();
    if (!reason) {
      setError("Enter a shortage reason before closing short.");
      return;
    }
    const payload = JSON.stringify([reason, shortReview.map(line => [line.lineId, line.quantity]).sort()]);
    const matchingRequest = pendingShort?.payload === payload ? pendingShort : null;
    if ((detail.transfer.state !== "inTransit" || reviewChanged) && !(retryClosedShort && matchingRequest)) return;
    const operation = matchingRequest ?? { payload, requestId: createOperationKey("transfer-short") };
    setPendingShort(operation);
    setBusy(true);
    setError("");
    try {
      await closeShort({ branchId, transferId: detail.transfer._id, requestId: operation.requestId, reviewed: shortReview, reason });
      setPendingShort(null);
      setShortReview(null);
      onSuccess("Transfer closed short with shortage recorded.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not close transfer short.").message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return <CreateTransferSheet
      originId={branchId}
      originName={editing.origin ?? "Origin"}
      destinations={destinations}
      draft={editing}
      onClose={() => setEditing(null)}
      onCreated={() => { setEditing(null); onSuccess("Transfer draft updated."); }}
    />;
  }

  return (
    <>
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>{detail?.transfer.reference ?? "Branch transfer"}</SheetTitle>
          <SheetDescription>
            {detail ? (
              <>
                {detail.origin ?? "Origin"} → {detail.destination ?? "Destination"}
                <span className="mt-0.5 block tabular-nums">
                  {detail.lines.reduce((total, line) => total + line.quantity, 0)} units
                  {detail.transfer.state !== "draft" ? ` · ${detail.lines.reduce((total, line) => total + line.received, 0)} received` : ""}
                </span>
              </>
            ) : "Loading transfer…"}
          </SheetDescription>
        </>
      }
    >
      {detail === undefined ? (
        <div className="p-6"><SkeletonRows label="Loading transfer details" rows={4} /></div>
      ) : detail === null ? (
        <div className="p-6"><Callout tone="warning" title="Transfer unavailable">
          This transfer could not be found for the selected branch.
        </Callout></div>
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
                <Button type="button" variant="outline" size="sm" onClick={() => void copyTransferLink()}>
                  Copy link
                </Button>
                {detail.transfer.state === "draft" && detail.permissions.send ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(detail)}>
                    Edit draft
                  </Button>
                ) : null}
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
                    onClick={() => setShortReview(shortReview ? null : remainingLines)}
                  >
                    Close short
                  </Button>
                ) : null}
              </div>
            </div>

            {detail.transfer.note ? (
              <Callout tone="info" title="Dispatch note"><p className="whitespace-pre-wrap break-words">{detail.transfer.note}</p></Callout>
            ) : null}
            {detail.transfer.shortageReason ? (
              <Callout tone="warning" title="Shortage recorded">
                {detail.transfer.shortageReason}
              </Callout>
            ) : null}

            {shortReview ? (
              <form onSubmit={handleCloseShort} className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
                <p className="text-sm font-semibold">Outstanding units to close short</p>
                <ul className="grid gap-1 text-sm">
                  {shortReview.map((line) => <li key={line.lineId}>{transferItem(detail.lines.find((item) => item._id === line.lineId))} · {line.quantity}</li>)}
                </ul>
                {reviewChanged && !retryClosedShort ? <Callout tone="warning" title="Outstanding quantities changed"
                  action={<Button type="button" variant="outline" onClick={() => setShortReview(remainingLines)}>Review latest quantities</Button>}>
                  Review the quantities after the latest receipt.
                </Callout> : null}
                <Label htmlFor="short-reason">Shortage reason</Label>
                <Input
                  id="short-reason"
                  value={shortReason}
                  readOnly={retryClosedShort || busy}
                  onChange={(event) => setShortReason(event.target.value)}
                  placeholder="Describe missing or damaged units in transit"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setShortReview(null); setPendingShort(null); }}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" size="sm" disabled={busy || (!retryClosedShort && (detail.transfer.state !== "inTransit" || Boolean(reviewChanged) || remainingLines.length === 0))}>
                    {retryClosedShort ? "Verify recorded shortage" : "Confirm close short"}
                  </Button>
                </div>
              </form>
            ) : null}

            <form onSubmit={handleReceive} className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Transfer lines</h3>
                {detail.transfer.state === "inTransit" && detail.permissions.receive && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                    const remaining = detail.lines.flatMap(receiptFields).filter((field) => field.remaining > 0);
                    setReceiveInputs(Object.fromEntries(remaining.map((field) => [field.id, String(field.remaining)])));
                    setError("");
                    setShowLineErrors(false);
                  }}>Fill all remaining</Button>
                )}
              </div>
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
                      {line.onHand !== undefined ? <p className="text-xs text-muted-foreground">
                        On hand {line.onHand} · Dispatchable {line.sellable}
                        {line.sellable !== undefined && line.quantity > line.sellable ? " · Requested quantity exceeds stock available after holds and expiry." : ""}
                      </p> : null}
                      {receiptFields(line).map((field) => {
                        const raw = receiveInputs[field.id] ?? "";
                        const invalid = showLineErrors && Boolean(raw.trim()) &&
                          !parseWholeQuantity(raw, { allowZero: false, max: field.remaining }).ok;
                        const canReceive = detail.permissions.receive && (
                          (detail.transfer.state === "inTransit" && (field.remaining > 0 || raw)) || (canRetryCompletedReceipt && raw)
                        );
                        return canReceive ? (
                          <div key={field.id} className="grid gap-1.5 sm:max-w-xs">
                            <Label htmlFor={`tr-recv-${field.id}`}>{field.label} (max {field.remaining})</Label>
                            <NumberField
                              id={`tr-recv-${field.id}`}
                              value={raw}
                              placeholder={String(field.remaining)}
                              readOnly={canRetryCompletedReceipt}
                              aria-invalid={invalid || undefined}
                              aria-describedby={invalid ? `tr-error-${field.id}` : undefined}
                              onChange={(event) => setReceiveInputs((current) => ({ ...current, [field.id]: event.target.value }))}
                            />
                            {invalid ? <p role="alert" id={`tr-error-${field.id}`} className="text-xs text-destructive">
                              {line.productName} {line.label} · {field.remaining > 0 ? `Enter a whole quantity between 1 and ${field.remaining}.` : "Already fully received. Clear this quantity."}
                            </p> : null}
                          </div>
                        ) : field.lotId ? <p key={field.id} className="text-xs text-muted-foreground">{field.label} · {field.remaining} remaining</p> : null;
                      })}
                    </li>
                  );
                })}
              </ul>
              {detail.permissions.receive && (detail.transfer.state === "inTransit" || canRetryCompletedReceipt) ? (
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy}>
                    {canRetryCompletedReceipt ? "Verify posted receipt" : "Post transfer receipt"}
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
                      <p className="text-muted-foreground">
                        {ev.actor}{ev.actingBranchId === detail.transfer.originId ? ` · ${detail.origin ?? "Origin"}` : ev.actingBranchId === detail.transfer.destinationId ? ` · ${detail.destination ?? "Destination"}` : ""}
                      </p>
                      {ev.reason ? <p className="text-muted-foreground">{ev.reason}</p> : null}
                      {(ev.kind === "short" ? ev.shortages ?? [] : ev.receipts).map((evidence) => {
                        const item = detail.lines.find((line) => line._id === evidence.lineId);
                        return <div key={evidence.lineId} className="mt-1 grid gap-1">
                          <p>{transferItem(item)} · {evidence.quantity} {ev.kind === "short" ? "short" : "received"}</p>
                          {evidence.allocations.map((lot) => <p key={lot.lotId} className="text-muted-foreground">
                            {item?.lots.find((entry) => entry.lotId === lot.lotId)?.code ?? lot.lotId} · {lot.quantity}
                          </p>)}
                          {ev.actingBranchId === branchId ? <button type="button" className="w-fit underline" onClick={() => setMovementId(evidence.movementId)}>
                            View stock movement
                          </button> : null}
                        </div>;
                      })}
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
      {movementId ? <MovementInspectSheet
        branchId={branchId}
        movementId={movementId}
        access={access}
        reportContext={null}
        onClose={() => setMovementId(null)}
        onSuccess={onSuccess}
      /> : null}
    </>
  );
}
