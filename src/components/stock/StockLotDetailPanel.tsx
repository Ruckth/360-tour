"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useRef, useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import list from "./StockRecordList.module.css";
import { Callout, ChoiceGroup, EditorSheet, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { resortMidnight } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { createOperationKey, parseStockError, parseWholeQuantity } from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import type { BalancePickerRow } from "./StockVariantPicker";

export function LotDetailPanel({
  branchId,
  branchName,
  variant,
  requestedLotId,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName?: string;
  variant: BalancePickerRow;
  requestedLotId?: string | null;
  onSuccess: (msg: string) => void;
}) {
  const balances = useQuery(api.commerce.stockExpansion.lotBalances, { branchId, variantId: variant.variantId });
  const enableTracking = useMutation(api.commerce.stockExpansion.enableLotTracking);
  const adjustLot = useMutation(api.commerce.stockExpansion.adjustLot);
  const countLot = useMutation(api.commerce.stockExpansion.countLot);
  const startSession = useMutation(api.commerce.stockExpansion.startLotCountSession);
  const finishSession = useMutation(api.commerce.stockExpansion.finishLotCountSession);
  const scope = { branchId, variantId: variant.variantId };
  const session = useQuery(api.commerce.stockExpansion.readLotCountSession, balances?.canAdjust && balances.tracking ? scope : "skip");

  const [conversionOpen, setConversionOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "remove" | "count">(requestedLotId ? "count" : "add");
  const [lotCode, setLotCode] = useState("");
  const [lotExpiry, setLotExpiry] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  // Pin observed lot on-hand balance when lot is selected so live changes require explicit review
  const [reviewedLot, setReviewedLot] = useState<{ lotId: Id<"stockLots">; onHand: number; revision: number } | null>(null);
  const [searchCode, setSearchCode] = useState("");
  const [searchedCode, setSearchedCode] = useState("");
  const historicalLot = useQuery(api.commerce.stockExpansion.findCountLot,
    mode === "count" && searchedCode ? { branchId, variantId: variant.variantId, code: searchedCode } : "skip");
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => createOperationKey("lot-op"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkedLotSettled, setLinkedLotSettled] = useState(false);

  const isLotDirty = qtyText.trim() !== "" || reason.trim() !== "" || lotCode.trim() !== "" || lotExpiry !== "";
  useUnsavedGuard(isLotDirty);

  if (balances === undefined) return <SkeletonRows label="Loading lot balances" rows={3} />;

  const selectableLots = new Map<string, { lotId: Id<"stockLots">; onHand: number; revision: number; code?: string; expiresAt: number }>();
  if (mode === "count") {
    for (const lot of session?.lots ?? []) selectableLots.set(lot.lotId, lot);
    if (historicalLot) selectableLots.set(historicalLot.lotId, historicalLot);
  }
  for (const lot of balances.lots) selectableLots.set(lot.lotId, lot);
  const lotChoices = [...selectableLots.values()];
  const linkedLot = requestedLotId ? selectableLots.get(requestedLotId) : undefined;
  if (requestedLotId && !linkedLotSettled && balances.canAdjust && balances.tracking && session !== undefined) {
    setLinkedLotSettled(true);
    if (linkedLot) {
      setSelectedLotId(linkedLot.lotId);
      setReviewedLot({ lotId: linkedLot.lotId, onHand: linkedLot.onHand, revision: linkedLot.revision });
    }
  }
  const liveSelectedLot = selectedLotId ? lotChoices.find((row) => row.lotId === selectedLotId) : undefined;
  const preview = parseWholeQuantity(qtyText, { allowZero: true });
  const isLotCountStale = Boolean(
    mode === "count" &&
      reviewedLot &&
      liveSelectedLot &&
      liveSelectedLot.lotId === reviewedLot.lotId &&
      (liveSelectedLot.onHand !== reviewedLot.onHand || liveSelectedLot.revision !== reviewedLot.revision),
  );

  function selectLot(nextLotId: string) {
    setSelectedLotId(nextLotId);
    const match = lotChoices.find((row) => row.lotId === nextLotId);
    setReviewedLot(match ? { lotId: match.lotId, onHand: match.onHand, revision: match.revision } : null);
    setError("");
    setRequestId(createOperationKey("lot-op"));
  }

  async function handleEnable() {
    setError("");
    setBusy(true);
    try {
      await enableTracking({ branchId, variantId: variant.variantId });
      onSuccess("Lot tracking enabled for this item.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not enable lot tracking.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjustLot(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsedQty = parseWholeQuantity(qtyText, { allowZero: mode === "count" });
    if (!parsedQty.ok || parsedQty.value === undefined) {
      setError(parsedQty.ok ? "Enter a quantity." : parsedQty.error);
      document.getElementById("lot-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError(mode === "count" ? "Enter a reason for the lot count." : "Enter a reason for the lot adjustment.");
      document.getElementById("lot-reason")?.focus();
      return;
    }
    if (mode === "add" && (!lotCode.trim() || !lotExpiry)) {
      setError("Enter both lot code and expiry date.");
      document.getElementById(lotCode.trim() ? "lot-exp" : "lot-code")?.focus();
      return;
    }
    if ((mode === "remove" || mode === "count") && !selectedLotId) {
      setError("Choose the lot first.");
      document.getElementById("lot-select")?.focus();
      return;
    }
    if (isLotCountStale) {
      setError("Lot balance changed since you selected it. Review the updated balance above before posting.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "count") {
        if (!reviewedLot || reviewedLot.lotId !== selectedLotId) {
          setError("Selected lot is no longer listed. Pick a lot and try again.");
          setBusy(false);
          return;
        }
        await countLot({
          branchId,
          variantId: variant.variantId,
          lotId: reviewedLot.lotId,
          expectedOnHand: reviewedLot.onHand,
          expectedRevision: reviewedLot.revision,
          sessionId: session?._id,
          quantity: parsedQty.value,
          requestId,
          reason: reason.trim(),
        });
        setQtyText("");
        setReason("");
        setReviewedLot(null);
        setSelectedLotId("");
        setRequestId(createOperationKey("lot-op"));
        onSuccess("Verified lot count posted.");
        return;
      }
      await adjustLot({
        branchId,
        variantId: variant.variantId,
        requestId,
        reason: reason.trim(),
        quantity: parsedQty.value,
        change:
          mode === "add"
            ? { kind: "add", lot: { code: lotCode.trim(), expiresAt: resortMidnight(lotExpiry) } }
            : { kind: "remove", lotId: selectedLotId as Id<"stockLots"> },
      });
      setQtyText("");
      setReason("");
      setRequestId(createOperationKey("lot-op"));
      onSuccess("Lot adjustment posted.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not post lot update.").message);
    } finally {
      setBusy(false);
    }
  }

  async function manageSession(action: "start" | "finish") {
    setBusy(true);
    setError("");
    try {
      if (action === "start") {
        await startSession(scope);
        setMode("count");
        setQtyText("");
        setReason("");
        setSelectedLotId("");
        setReviewedLot(null);
        setRequestId(createOperationKey("lot-op"));
      } else if (session) {
        await finishSession({ ...scope, sessionId: session._id });
        onSuccess("Lot count session completed.");
      }
    } catch (cause) {
      setError(parseStockError(cause, "Could not update count session.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}

      <Card className="p-0">
        <dl className={cn("grid divide-x divide-border py-2 text-center", balances.assigned > 0 ? "grid-cols-5" : "grid-cols-4")}>
          <div className="min-w-0 px-1">
            <dt className="text-xs text-muted-foreground">On hand</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">{balances.onHand}</dd>
          </div>
          <div className="min-w-0 px-1">
            <dt className="text-xs text-muted-foreground">Reserved</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{balances.held}</dd>
          </div>
          {balances.assigned > 0 ? <div className="min-w-0 px-1">
            <dt className="text-xs text-muted-foreground">In bins</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">{balances.assigned}</dd>
          </div> : null}
          <div className="min-w-0 px-1">
            <dt className="text-xs text-muted-foreground" title="Expired units outside bins and reservations">Expired</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">{balances.expired}</dd>
          </div>
          <div className="min-w-0 px-1">
            <dt className="text-xs text-muted-foreground">Sellable</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{balances.sellable}</dd>
          </div>
        </dl>
      </Card>

      {!balances.tracking ? (
        <Callout
          tone="info"
          title="Lot tracking is not enabled for this variant"
          action={
            balances.canEnable ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void handleEnable()}>
                Enable lot tracking
              </Button>
            ) : balances.canConvert ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setConversionOpen(true)}>
                Reconcile existing stock
              </Button>
            ) : null
          }
        >
          {balances.enableBlocker ?? (balances.canEnable
            ? "Track batch codes and expiry dates for this item."
            : "Company stock lead access is required to enable lot tracking.")}
        </Callout>
      ) : (
        <>
          <Card className={cn("overflow-hidden", list.frame)}>
            {balances.lots.length === 0 ? (
              <EmptyState>No active lots in stock at this branch yet.</EmptyState>
            ) : (
              <table role="table" className={list.table}>
                <thead className="admin-eyebrow">
                  <tr>
                    <th scope="col">Lot code</th>
                    <th scope="col">Expires</th>
                    <th scope="col" className="text-right">On hand</th>
                    <th scope="col" className="text-right">Reserved</th>
                    {balances.assigned > 0 ? <th scope="col" className="text-right">In bins</th> : null}
                    <th scope="col" className="text-right">Sellable</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.lots.map((lot) => (
                    <tr key={lot.lotId} className={lot.lotId === requestedLotId ? "bg-muted/50" : undefined}>
                      <td data-label="Lot code" className="font-mono font-medium">
                        {lot.code ?? lot.lotId}
                      </td>
                      <td data-label="Expires" className="tabular-nums text-xs">
                        {staffDate(lot.expiresAt)}{lot.expired ? " · Expired" : ""}
                      </td>
                      <td data-label="On hand" className="font-mono tabular-nums text-right">
                        {lot.onHand}
                      </td>
                      <td data-label="Reserved" className="font-mono tabular-nums text-right">
                        {lot.reserved}
                      </td>
                      {balances.assigned > 0 ? <td data-label="In bins" className="font-mono tabular-nums text-right">
                        {lot.assigned}
                      </td> : null}
                      <td data-label="Sellable" className="font-mono tabular-nums text-right">
                        {lot.available}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {balances.canAdjust ? (
            <Card className="px-3">
              <details open={session || requestedLotId ? true : undefined}>
                <summary className="cursor-pointer py-2.5 text-sm font-semibold">
                  {session ? "Count session in progress" : "Count or adjust lots"}
                </summary>
                <div className="grid gap-4 border-t pb-3 pt-3">
                  {session ? (
                    <section aria-label="Lot count session" className="grid gap-2">
                      <p className="font-medium">Count session · {session.lots.filter((lot) => lot.counted).length} of {session.lots.length} lots counted</p>
                      <ul className="grid gap-1 text-sm">
                        {session.lots.map((lot) => <li key={lot.lotId}>{lot.code} · {lot.counted ? "Counted" : "Pending"}</li>)}
                      </ul>
                      <Button type="button" variant="outline" className="w-fit" disabled={busy || session.lots.some((lot) => !lot.counted)}
                        onClick={() => void manageSession("finish")}>Complete count session</Button>
                    </section>
                  ) : balances.lots.length ? (
                    <Button type="button" variant="outline" className="w-fit" disabled={busy || session === undefined}
                      onClick={() => void manageSession("start")}>Start count session</Button>
                  ) : null}
                  <form onSubmit={handleAdjustLot} className="grid gap-4">
                    {requestedLotId && linkedLotSettled && !linkedLot ? (
                      <p role="status" className="text-sm text-muted-foreground">This lot is outside the current list. Find it by its exact code before counting.</p>
                    ) : null}
                    {isLotCountStale && reviewedLot && liveSelectedLot ? (
                      <StockStaleBanner
                        title="Lot balance changed while counting"
                        description={`Stock activity changed the reviewed position for ${liveSelectedLot.code ?? liveSelectedLot.lotId}. Current on hand is ${liveSelectedLot.onHand}. Verify the shelf quantity again before posting.`}
                        actionLabel="Review updated balance"
                        onReview={() => {
                          setReviewedLot({ lotId: liveSelectedLot.lotId, onHand: liveSelectedLot.onHand, revision: liveSelectedLot.revision });
                          setError("");
                          setRequestId(createOperationKey("lot-op"));
                        }}
                      />
                    ) : null}
                    <ChoiceGroup
                      name="lot-adj-mode"
                      label="Action"
                      value={mode}
                      onChange={(next) => {
                        setMode(next);
                        setQtyText("");
                        setReason("");
                        setLotCode("");
                        setLotExpiry("");
                        setSelectedLotId("");
                        setReviewedLot(null);
                        setSearchCode("");
                        setSearchedCode("");
                        setError("");
                        setRequestId(createOperationKey("lot-op"));
                      }}
                      columns="sm:grid-cols-3"
                      options={[
                        { value: "count", label: "Verify lot count", hint: "Reconcile shelf qty for one lot" },
                        { value: "add", label: "Add to lot", hint: "Record lot code & expiry" },
                        { value: "remove", label: "Remove from lot", hint: "Deduct expired or damaged units" },
                      ]}
                    />
                    {mode === "add" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="lot-code">Lot code</Label>
                          <Input
                            id="lot-code"
                            value={lotCode}
                            onChange={(event) => {
                              setLotCode(event.target.value);
                              setRequestId(createOperationKey("lot-op"));
                            }}
                            placeholder="e.g. LOT-2026-11"
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor="lot-exp">Expiry date</Label>
                          <DatePicker
                            id="lot-exp"
                            value={lotExpiry}
                            onValueChange={(val) => {
                              setLotExpiry(val);
                              setRequestId(createOperationKey("lot-op"));
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-1.5">
                        {mode === "count" ? (
                          <div className="grid gap-1.5">
                            <Label htmlFor="lot-code-search">Find existing lot by exact code</Label>
                            <div className="flex gap-2">
                              <Input id="lot-code-search" value={searchCode} onChange={(event) => setSearchCode(event.target.value)} />
                              <Button type="button" variant="outline" onClick={() => setSearchedCode(searchCode.trim())} disabled={!searchCode.trim()}>Find lot</Button>
                            </div>
                            {searchedCode && historicalLot === null ? <p role="status" className="text-xs text-muted-foreground">No matching lot at this branch.</p> : null}
                            {historicalLot ? <Button type="button" variant="outline" className="w-fit" onClick={() => selectLot(historicalLot.lotId)}>
                              Count {historicalLot.code} · {historicalLot.onHand} on hand
                            </Button> : null}
                          </div>
                        ) : null}
                        <Label htmlFor="lot-select">Lot</Label>
                        <Select value={selectedLotId} onValueChange={selectLot}>
                          <SelectTrigger id="lot-select">
                            <SelectValue placeholder="Choose lot" />
                          </SelectTrigger>
                          <SelectContent>
                            {lotChoices.map((lot) => (
                              <SelectItem key={lot.lotId} value={lot.lotId}>
                                {lot.code ?? lot.lotId} · {lot.onHand} on hand · exp {staffDate(lot.expiresAt)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="lot-qty">
                          {mode === "count" ? "Counted quantity on shelf" : "Quantity"}
                        </Label>
                        <NumberField
                          id="lot-qty"
                          value={qtyText}
                          onChange={(event) => {
                            setQtyText(event.target.value);
                            setRequestId(createOperationKey("lot-op"));
                          }}
                          placeholder="0"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="lot-reason">Reason</Label>
                        <Input
                          id="lot-reason"
                          value={reason}
                          onChange={(event) => {
                            setReason(event.target.value);
                            setRequestId(createOperationKey("lot-op"));
                          }}
                          placeholder={mode === "count" ? "Reason for verified lot count" : "Reason for lot adjustment"}
                        />
                      </div>
                    </div>
                    {mode === "count" && reviewedLot && preview.ok && preview.value !== undefined ? (
                      <p role="status" className="text-sm">
                        Reviewed on hand {reviewedLot.onHand} · Counted {preview.value} · Adjustment {preview.value > reviewedLot.onHand ? "+" : ""}{preview.value - reviewedLot.onHand}
                      </p>
                    ) : null}
                    <div className="flex justify-end">
                      <Button type="submit" disabled={busy}>
                        {mode === "count" ? "Post verified lot count" : "Save lot adjustment"}
                      </Button>
                    </div>
                  </form>
                </div>
              </details>
            </Card>
          ) : (
            <Callout tone="info" title="View-only lot balances">
              Stock lead access is required to post lot counts or adjustments for {branchName ?? "this branch"}.
            </Callout>
          )}
        </>
      )}
      {conversionOpen ? <LotConversionSheet
        branchId={branchId}
        variantId={variant.variantId}
        onClose={() => setConversionOpen(false)}
        onSuccess={onSuccess}
      /> : null}
    </div>
  );
}

type ConversionLot = { key: string; code: string; expiry: string; quantity: string };

function LotConversionSheet({ branchId, variantId, onClose, onSuccess }: {
  branchId: Id<"branches">;
  variantId: Id<"productVariants">;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const liveReview = useQuery(api.commerce.stockExpansion.lotConversionBalances, { branchId, variantId });
  const convert = useMutation(api.commerce.stockExpansion.convertLotTracking);
  const [reviewed, setReviewed] = useState<typeof liveReview>();
  const review = reviewed ?? liveReview;
  const changed = !!reviewed && !!liveReview && JSON.stringify(reviewed.branches.map(row => [row.branchId, row.revision])) !==
    JSON.stringify(liveReview.branches.map(row => [row.branchId, row.revision]));
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [draft, setDraft] = useState<Partial<Record<Id<"branches">, ConversionLot[]>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { requestClose } = useStockDirtyGuard(Object.keys(draft).length > 0, onClose, busy);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!review || review.blocker) return;
    setError("");
    const branches: { branchId: Id<"branches">; expectedRevision: number; lots: { code: string; expiresAt: number; quantity: number }[] }[] = [];
    for (const row of review.branches) {
      const lots = [];
      for (const lot of draft[row.branchId] ?? []) {
        const quantity = parseWholeQuantity(lot.quantity);
        if (!lot.code.trim() || !lot.expiry || !quantity.ok || !quantity.value) {
          setError(`Enter a code, expiry date and positive whole quantity for every lot at ${row.name}.`);
          return;
        }
        lots.push({ code: lot.code.trim(), expiresAt: resortMidnight(lot.expiry), quantity: quantity.value });
      }
      if (lots.reduce((sum, lot) => sum + lot.quantity, 0) !== row.onHand) {
        setError(`Lot quantities at ${row.name} must add up to ${row.onHand} units.`);
        return;
      }
      branches.push({ branchId: row.branchId, expectedRevision: row.revision, lots });
    }
    const fingerprint = JSON.stringify(branches.map(row => ({
      ...row, lots: [...row.lots].sort((a, b) => a.code.localeCompare(b.code)),
    })).sort((a, b) => a.branchId.localeCompare(b.branchId)));
    if (pending.current?.fingerprint !== fingerprint) {
      if (changed) {
        setError("Stock activity changed a reviewed branch. Restart after recounting the lots.");
        return;
      }
      pending.current = { fingerprint, requestId: createOperationKey("lot-conversion") };
    }
    setBusy(true);
    try {
      await convert({ branchId, variantId, branches, requestId: pending.current.requestId });
      onClose();
      onSuccess("Branch balances reconciled and lot tracking enabled.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not enable lot tracking.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorSheet open wide onClose={requestClose} header={<>
      <SheetTitle>Reconcile existing stock into lots</SheetTitle>
      <SheetDescription>Enter the physical lot codes, expiries and quantities at every branch before enabling tracking.</SheetDescription>
    </>}>
      {review === undefined ? <SkeletonRows label="Loading branch balances" rows={3} /> :
        review.blocker ? <Callout tone="warning">{review.blocker}</Callout> :
        <SheetForm onSubmit={submit} onCancel={requestClose} saving={busy} error={error} submitLabel="Enable lot tracking">
          {changed ? <Callout tone="warning" title="A reviewed branch changed"
            action={<Button type="button" variant="outline" disabled={busy} onClick={() => {
              setReviewed(liveReview);
              setDraft({});
              setError("");
              pending.current = null;
            }}>Restart review</Button>}>
            Recount stock at the affected branch before submitting new lot quantities.
          </Callout> : null}
          {!review.branches.length ? <p className="text-sm text-muted-foreground">Every branch has zero stock. Lot tracking starts with the next receipt.</p> : null}
          {review.branches.map((row) => {
            const lots = draft[row.branchId] ?? [];
            return <section key={row.branchId} className="grid gap-3 rounded-lg border p-3">
              <h3 className="font-medium">{row.name} · {row.onHand} on hand</h3>
              {lots.map((lot, index) => {
                const change = (field: "code" | "expiry" | "quantity", value: string) =>
                  setDraft((current) => ({ ...current, [row.branchId]: lots.map((entry) => entry.key === lot.key ? { ...entry, [field]: value } : entry) }));
                return <fieldset key={lot.key} className="grid gap-2 sm:grid-cols-3" disabled={busy}>
                  <legend className="text-sm font-medium">Lot {index + 1}</legend>
                  <label className="grid gap-1 text-sm">Code <Input value={lot.code} onChange={(event) => change("code", event.target.value)} /></label>
                  <div className="grid gap-1">
                    <Label htmlFor={`${lot.key}-expiry`}>Expiry date</Label>
                    <DatePicker id={`${lot.key}-expiry`} value={lot.expiry} onValueChange={(value) => change("expiry", value)} />
                  </div>
                  <label className="grid gap-1 text-sm">Quantity <NumberField value={lot.quantity} onChange={(event) => change("quantity", event.target.value)} /></label>
                  <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() =>
                    setDraft((current) => ({ ...current, [row.branchId]: lots.filter((entry) => entry.key !== lot.key) }))}>Remove lot</Button>
                </fieldset>;
              })}
              <Button type="button" variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => {
                setReviewed(review);
                setDraft((current) => ({ ...current, [row.branchId]: [...lots, { key: createOperationKey("conversion-lot"), code: "", expiry: "", quantity: "" }] }));
              }}>Add lot</Button>
            </section>;
          })}
        </SheetForm>}
    </EditorSheet>
  );
}
