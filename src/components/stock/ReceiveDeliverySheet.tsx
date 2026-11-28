"use client";

import { useMutation, usePaginatedQuery, useQueries, useQuery, type RequestForQueries } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState, type FormEvent } from "react";
import {
  Callout,
  ChoiceGroup,
  EditorSheet,
  SheetForm,
} from "@/components/admin/marketing/MarketingBits";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { resortMidnight } from "@/lib/staff-bookings";
import { isStockWriteConflict, postStockWithRetry } from "@/lib/stock-posting";
import {
  createOperationKey,
  parseOptionalSatang,
  parseStockError,
  type RejectReasonCodeValue,
  parseWholeQuantity,
  STOCK_MAX_LINES,
  STOCK_PAGE_SIZE,
} from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import {
  ReceiveDeliveryMetaSection,
  ReceiveDirectSection,
  ReceiveHeldGoodsSection,
  ReceivePurchaseOrderSection,
  type HeldLineDraft,
  type MatchedOpenOrder,
  type PoLineFieldErrors,
  type ReceiveAcceptableHold,
} from "./ReceiveDeliverySections";
import { buildOrderReceiptLines, overReceiptErrors } from "./receive-order-lines";
import { useStockDirtyGuard } from "./StockFormGuard";
import type { StockLineFieldErrors } from "./StockLineEditor";
import { StockVariantPickerDialog, type BalancePickerRow } from "./StockVariantPicker";

type OrderListPage = FunctionReturnType<typeof api.commerce.purchasing.orders>;
type ReceiveOrderArgs = FunctionArgs<typeof api.commerce.purchasing.receivePurchaseOrder>;
type BackendFollowUp = NonNullable<ReceiveOrderArgs["followUp"]>;
type BackendUndercount = NonNullable<ReceiveOrderArgs["undercount"]>;

/** Correction follow-up context: omits variantId so staff pick the actual received item. */
export type ReceiveFollowUpProp = {
  adjustmentId: BackendFollowUp["adjustmentId"];
  quantity: BackendFollowUp["quantity"];
};

export type ReceiveUndercountProp = BackendUndercount;

let holdKeySeq = 0;
const NO_RECEIPT_DRAFT_LINES: StockLineDraft[] = [];
const NO_PREFILLED_VARIANTS: readonly Id<"productVariants">[] = [];

/**
 * Shared Receiving sheet used from Balances, Orders list, Order detail, Products, and receipt follow-ups.
 * - Starts PO accepted quantities blank (with explicit "Receive all remaining")
 * - Supports partial, rejected (including zero-accepted), and Held-for-buyer lines
 * - Supports accepting eligible open held goods (`holdId`) on linked replacement or amended original POs
 * - Supports linked correction `followUp` (derives the actual item's variantId at submit) and `undercount`
 * - Proactively prompts matched open POs before allowing direct-receipt bypass
 * - Pins PO revision on load and guards unsaved inputs with `useUnsavedGuard`
 */
export function ReceiveDeliverySheet({
  branchId,
  branchName,
  initialOrderId,
  initialMode,
  initialSupplier,
  allowDirectReceipt,
  canAddSupplier = false,
  followUp,
  undercount,
  initialLines = NO_RECEIPT_DRAFT_LINES,
  prefillVariantIds = NO_PREFILLED_VARIANTS,
  onClose,
  onPosted,
}: {
  branchId: Id<"branches">;
  branchName: string;
  initialOrderId?: Id<"purchaseOrders">;
  initialMode?: "po" | "direct";
  initialSupplier?: { id: Id<"suppliers">; name: string };
  allowDirectReceipt: boolean;
  canAddSupplier?: boolean;
  followUp?: ReceiveFollowUpProp;
  undercount?: ReceiveUndercountProp;
  initialLines?: StockLineDraft[];
  prefillVariantIds?: readonly Id<"productVariants">[];
  onClose: () => void;
  onPosted: (receiptId: Id<"supplierReceipts">) => void;
}) {
  const [mode, setMode] = useState<"po" | "direct">(() => {
    if (initialOrderId) return "po";
    if (initialMode === "direct" && allowDirectReceipt) return "direct";
    return "po";
  });
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"purchaseOrders"> | null>(initialOrderId ?? null);

  const [orderSearch, setOrderSearch] = useState("");
  const search = orderSearch.trim();
  const { results: openOrders, status: openOrdersStatus, loadMore: loadMoreOrders } = usePaginatedQuery(
    api.commerce.purchasing.orders,
    !initialOrderId && mode === "po"
      ? { branchId, view: search ? { kind: "openSearch", search } : { kind: "phase", phase: "open" } }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const orderDetail = useQuery(
    api.commerce.purchasing.order,
    mode === "po" && selectedOrderId ? { orderId: selectedOrderId } : "skip",
  );

  const receivePO = useMutation(api.commerce.purchasing.receivePurchaseOrder);
  const receiveDirect = useMutation(api.commerce.purchasing.receiveWithoutOrder);

  // Pin PO revision when an order loads so live amendments or concurrent receipts require explicit review
  const [reviewedOrder, setReviewedOrder] = useState<{
    orderId: Id<"purchaseOrders">;
    issuedRevision: number;
    revision: number;
    /** Due quantity per line when the receiver last reviewed the order (P43). */
    dueByLine?: Record<string, number>;
  } | null>(null);
  /** Lines whose due quantity changed in the revision the receiver just reviewed: earlier → current. */
  const [dueChanges, setDueChanges] = useState<{ lineId: string; label: string; before: number; after: number }[]>([]);

  if (orderDetail && (!reviewedOrder || reviewedOrder.orderId !== orderDetail.order._id)) {
    setReviewedOrder({
      orderId: orderDetail.order._id,
      issuedRevision: orderDetail.order.issuedRevision,
      revision: orderDetail.order.revision,
      dueByLine: Object.fromEntries(orderDetail.lines.map((line) => [line._id, line.due])),
    });
    if (dueChanges.length) setDueChanges([]);
  }

  const isOrderStale = Boolean(
    mode === "po" &&
      orderDetail &&
      reviewedOrder &&
      reviewedOrder.orderId === orderDetail.order._id &&
      (orderDetail.order.issuedRevision !== reviewedOrder.issuedRevision ||
        orderDetail.order.revision !== reviewedOrder.revision),
  );

  // PO line inputs (blank by default)
  const [acceptedByLine, setAcceptedByLine] = useState<Record<string, string>>({});
  const [rejectedByLine, setRejectedByLine] = useState<Record<string, string>>({});
  const [rejectReasonByLine, setRejectReasonByLine] = useState<Record<string, string>>({});
  const [rejectCodeByLine, setRejectCodeByLine] = useState<Record<string, RejectReasonCodeValue | undefined>>({});
  const [selectedHoldByLine, setSelectedHoldByLine] = useState<Record<string, Id<"purchaseHolds"> | "">>({});
  const [poLineErrors, setPoLineErrors] = useState<PoLineFieldErrors>({});
  const [holdAutoSelectedKey, setHoldAutoSelectedKey] = useState("");

  // Optional lot code + expiry per line (keyed by orderLineId on PO or variantId on direct receipt)
  const [lotCodeByKey, setLotCodeByKey] = useState<Record<string, string>>({});
  const [lotExpiryByKey, setLotExpiryByKey] = useState<Record<string, string>>({});

  // Direct receipt inputs
  const [supplier, setSupplier] = useState<{ id: Id<"suppliers">; name: string } | null>(initialSupplier ?? null);
  const [directLines, setDirectLines] = useState<StockLineDraft[]>(initialLines);
  const [directLineErrors, setDirectLineErrors] = useState<StockLineFieldErrors>({});
  const [directPickerOpen, setDirectPickerOpen] = useState(false);

  // Shared header + held goods + error recovery
  const [deliveryReference, setDeliveryReference] = useState("");
  const [invoiceTotalText, setInvoiceTotalText] = useState("");
  const [invoiceTotalError, setInvoiceTotalError] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [heldLines, setHeldLines] = useState<HeldLineDraft[]>([]);
  const [heldPickerOpen, setHeldPickerOpen] = useState(false);

  const [duplicateConflict, setDuplicateConflict] = useState<{
    receiptId: Id<"supplierReceipts">;
    reference: string;
  } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [serverOpenOrderMatches, setServerOpenOrderMatches] = useState<MatchedOpenOrder[] | null>(null);
  const [confirmBypassOpenOrders, setConfirmBypassOpenOrders] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("recv"));

  // Query lot-tracking status for all currently mounted PO or direct receipt rows (bounded <= 50)
  const mountedVariantIds = useMemo(() => {
    const ids = mode === "po" ? (orderDetail?.lines ?? []).map((l) => l.variantId) : directLines.map((l) => l.variantId);
    return [...new Set(ids)].slice(0, STOCK_MAX_LINES);
  }, [mode, orderDetail, directLines]);
  const trackedVariantList = useQuery(
    api.commerce.stockExpansion.trackedItems,
    mountedVariantIds.length > 0 ? { branchId, variantIds: mountedVariantIds } : "skip",
  );
  const trackedVariantIds = useMemo(() => {
    if (trackedVariantList !== undefined) return new Set(trackedVariantList);
    return mode === "direct"
      ? new Set(directLines.filter((l) => l.lotTracked).map((l) => l.variantId))
      : new Set<Id<"productVariants">>();
  }, [trackedVariantList, mode, directLines]);

  // Eligible open holds per PO line from backend `acceptableHolds` (amended original PO + linked replacement)
  const eligibleHoldsByLine = useMemo(() => {
    const map = new Map<Id<"purchaseOrderLines">, ReceiveAcceptableHold[]>();
    if (!orderDetail) return map;
    const holdDetailsById = new Map(orderDetail.holds.map((h) => [h._id, h]));
    for (const item of orderDetail.acceptableHolds) {
      if (item.remaining <= 0) continue;
      const detail = holdDetailsById.get(item.holdId);
      const enriched: ReceiveAcceptableHold = {
        ...item,
        receiptReference: detail?.receiptReference,
        reason: detail?.reason,
      };
      const existing = map.get(item.orderLineId);
      if (existing) existing.push(enriched);
      else map.set(item.orderLineId, [enriched]);
    }
    return map;
  }, [orderDetail]);

  // Auto-select linked replacement hold (`link === "replacement"` / `order.forHoldId`) on its PO line once loaded
  const autoTargetHold = orderDetail?.acceptableHolds.find(
    (h) => h.link === "replacement" || (orderDetail.order.forHoldId && h.holdId === orderDetail.order.forHoldId),
  );
  if (orderDetail && autoTargetHold) {
    const autoKey = `${orderDetail.order._id}:${autoTargetHold.holdId}`;
    if (holdAutoSelectedKey !== autoKey) {
      setHoldAutoSelectedKey(autoKey);
      if (selectedHoldByLine[autoTargetHold.orderLineId] === undefined) {
        setSelectedHoldByLine((current) =>
          current[autoTargetHold.orderLineId] !== undefined
            ? current
            : { ...current, [autoTargetHold.orderLineId]: autoTargetHold.holdId },
        );
      }
    }
  }

  // Proactively query open POs matching either directLines (in direct mode) or prefillVariantIds (on open)
  const watchedVariantIds = useMemo(() => {
    const ids = new Set<Id<"productVariants">>();
    if (mode === "direct") {
      for (const line of directLines) ids.add(line.variantId);
    } else if (!initialOrderId && prefillVariantIds.length > 0) {
      for (const id of prefillVariantIds) ids.add(id);
    }
    return [...ids];
  }, [mode, directLines, initialOrderId, prefillVariantIds]);

  const openMatchQueries = useMemo((): RequestForQueries => {
    const req: RequestForQueries = {};
    for (const variantId of watchedVariantIds) {
      req[variantId] = {
        query: api.commerce.purchasing.orders,
        args: {
          branchId,
          view: { kind: "item" as const, variantId, openOnly: true },
          paginationOpts: { cursor: null, numItems: 5 },
        },
      };
    }
    return req;
  }, [branchId, watchedVariantIds]);

  const openMatchRaw = useQueries(openMatchQueries);

  const { proactiveOpenOrderMatches, openMatchLoading } = useMemo(() => {
    const byOrder = new Map<Id<"purchaseOrders">, MatchedOpenOrder>();
    let loading = false;
    for (const variantId of watchedVariantIds) {
      const res = openMatchRaw[variantId];
      if (res === undefined) {
        loading = true;
        continue;
      }
      if (res instanceof Error) continue;
      const page = (res as OrderListPage).page;
      for (const row of page) {
        if (!byOrder.has(row._id)) {
          byOrder.set(row._id, {
            orderId: row._id,
            reference: row.reference,
            supplierName: row.supplier.name,
            dueUnits: row.dueUnits,
          });
        }
      }
    }
    return { proactiveOpenOrderMatches: [...byOrder.values()], openMatchLoading: loading };
  }, [watchedVariantIds, openMatchRaw]);

  // Auto-select a single matched open PO or switch to direct mode when prefilled with variants that have no open PO
  const [appliedPrefillMode, setAppliedPrefillMode] = useState(false);
  if (!appliedPrefillMode && !initialOrderId && !initialMode && prefillVariantIds.length > 0 && !openMatchLoading) {
    setAppliedPrefillMode(true);
    if (proactiveOpenOrderMatches.length === 1) {
      setSelectedOrderId(proactiveOpenOrderMatches[0].orderId);
    } else if (proactiveOpenOrderMatches.length === 0 && allowDirectReceipt && initialLines.length > 0) {
      setMode("direct");
    }
  }

  const effectiveOpenOrderMatches = useMemo(() => {
    const merged = new Map<string, MatchedOpenOrder>();
    for (const match of proactiveOpenOrderMatches) merged.set(match.orderId, match);
    for (const match of serverOpenOrderMatches ?? []) {
      const existing = merged.get(match.orderId);
      merged.set(match.orderId, {
        orderId: match.orderId,
        reference: existing?.reference ?? match.reference,
        supplierName: existing?.supplierName ?? match.supplierName,
        dueUnits: existing?.dueUnits ?? match.dueUnits,
      });
    }
    return [...merged.values()];
  }, [proactiveOpenOrderMatches, serverOpenOrderMatches]);

  const isDirty = useMemo(() => {
    const hasPoValues =
      Object.values(acceptedByLine).some((v) => v.trim() !== "") ||
      Object.values(rejectedByLine).some((v) => v.trim() !== "") ||
      Object.values(rejectReasonByLine).some((v) => v.trim() !== "") ||
      Object.values(rejectCodeByLine).some(Boolean);
    const hasDirectEdits =
      directLines.length !== initialLines.length ||
      directLines.some((line, idx) => {
        const init = initialLines[idx];
        return (
          !init ||
          init.variantId !== line.variantId ||
          line.quantityText !== init.quantityText ||
          (line.unitCostText ?? "") !== (init.unitCostText ?? "")
        );
      });
    const hasLotValues =
      Object.values(lotCodeByKey).some((v) => v.trim() !== "") ||
      Object.values(lotExpiryByKey).some((v) => v !== "");
    const supplierChanged = (supplier?.id ?? null) !== (initialSupplier?.id ?? null);
    return (
      hasPoValues ||
      hasDirectEdits ||
      hasLotValues ||
      supplierChanged ||
      deliveryReference.trim() !== "" ||
      invoiceTotalText.trim() !== "" ||
      reason.trim() !== "" ||
      note.trim() !== "" ||
      heldLines.length > 0
    );
  }, [
    acceptedByLine,
    rejectedByLine,
    rejectReasonByLine,
    rejectCodeByLine,
    invoiceTotalText,
    directLines,
    initialLines,
    lotCodeByKey,
    lotExpiryByKey,
    supplier,
    initialSupplier,
    deliveryReference,
    reason,
    note,
    heldLines.length,
  ]);

  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  function receiveAllRemaining() {
    if (!orderDetail) return;
    const next: Record<string, string> = {};
    for (const line of orderDetail.lines) {
      if (line.due > 0) {
        const selectedHoldId = selectedHoldByLine[line._id];
        const hold = selectedHoldId
          ? eligibleHoldsByLine.get(line._id)?.find((h) => h.holdId === selectedHoldId)
          : undefined;
        const cap = hold ? Math.min(line.due, hold.remaining) : line.due;
        if (cap > 0) next[line._id] = String(cap);
      }
    }
    setAcceptedByLine(next);
    setPoLineErrors({});
    setOpKey(createOperationKey("recv"));
  }

  function validateHeldLines():
    | { ok: true; value: { variantId: Id<"productVariants">; quantity: number; reason: string }[] }
    | { ok: false; error: string; focusId?: string } {
    const out: { variantId: Id<"productVariants">; quantity: number; reason: string }[] = [];
    for (const hold of heldLines) {
      const parsed = parseWholeQuantity(hold.quantityText, { allowZero: false, label: "Held quantity" });
      if (!parsed.ok || !parsed.value) {
        return {
          ok: false,
          error: parsed.ok ? "Enter quantity for held goods." : parsed.error,
          focusId: `held-qty-${hold.key}`,
        };
      }
      if (!hold.reason.trim()) {
        return {
          ok: false,
          error: `Enter a reason for holding ${hold.productName}.`,
          focusId: `held-reason-${hold.key}`,
        };
      }
      out.push({ variantId: hold.variantId, quantity: parsed.value, reason: hold.reason.trim() });
    }
    return { ok: true, value: out };
  }

  function resolveFollowUpPayload(
    acceptedRows: readonly { variantId: Id<"productVariants">; accepted: number }[],
  ): { ok: true; value: BackendFollowUp | undefined } | { ok: false; error: string } {
    if (!followUp) return { ok: true, value: undefined };
    const positiveRows = acceptedRows.filter((row) => row.accepted > 0);
    if (positiveRows.length !== 1) {
      return {
        ok: false,
        error: `A correction follow-up must accept exactly one item (the actual item received) with ${followUp.quantity} units.`,
      };
    }
    if (positiveRows[0].accepted !== followUp.quantity) {
      return {
        ok: false,
        error: `Enter exactly ${followUp.quantity} accepted units to match the linked correction.`,
      };
    }
    return {
      ok: true,
      value: {
        adjustmentId: followUp.adjustmentId,
        variantId: positiveRows[0].variantId,
        quantity: followUp.quantity,
      },
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPoLineErrors({});

    const heldCheck = validateHeldLines();
    if (!heldCheck.ok) {
      setError(heldCheck.error);
      if (heldCheck.focusId) document.getElementById(heldCheck.focusId)?.focus();
      return;
    }

    if (duplicateConflict && !duplicateReason.trim()) {
      setError("Enter a reason confirming this is a separate delivery with the same reference.");
      document.getElementById("dup-reason")?.focus();
      return;
    }

    const invoiceParsed = parseOptionalSatang(invoiceTotalText);
    if (!invoiceParsed.ok) {
      setInvoiceTotalError(invoiceParsed.error);
      setError("Fix the invoice total before posting.");
      document.getElementById("recv-invoice-total")?.focus();
      return;
    }
    setInvoiceTotalError("");
    const invoiceTotal = invoiceParsed.value;

    const confirmDuplicate =
      duplicateConflict && duplicateReason.trim()
        ? { receiptId: duplicateConflict.receiptId, reason: duplicateReason.trim() }
        : undefined;

    if (mode === "po") {
      if (!orderDetail) {
        setError("Choose an open purchase order first.");
        return;
      }
      if (isOrderStale) {
        setError("This purchase order changed while receiving. Review the updated order above before posting.");
        return;
      }
      const { lineInputs, acceptedSummary, errors: nextPoErrors, firstInvalidId } = buildOrderReceiptLines(orderDetail, {
        acceptedByLine, rejectedByLine, rejectReasonByLine, rejectCodeByLine, selectedHoldByLine,
        lotCodeByKey, lotExpiryByKey, trackedVariantIds, eligibleHoldsByLine,
      });

      if (Object.keys(nextPoErrors).length > 0) {
        setPoLineErrors(nextPoErrors);
        setError("Fix the highlighted order line fields before posting.");
        if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
        return;
      }

      if (lineInputs.length === 0 && heldCheck.value.length === 0) {
        setError("Enter accepted, rejected, or held quantities before posting.");
        return;
      }

      const followUpCheck = resolveFollowUpPayload(acceptedSummary);
      if (!followUpCheck.ok) {
        setError(followUpCheck.error);
        return;
      }

      setSaving(true);
      const poPayload: ReceiveOrderArgs = {
        orderId: orderDetail.order._id,
        expectedIssuedRevision: reviewedOrder?.issuedRevision ?? orderDetail.order.issuedRevision,
        deliveryReference: deliveryReference.trim() || undefined,
        invoiceTotal,
        note: note.trim() || undefined,
        reason: reason.trim() || undefined,
        confirmDuplicate,
        followUp: followUpCheck.value,
        undercount: !followUpCheck.value ? undercount : undefined,
        held: heldCheck.value.length ? heldCheck.value : undefined,
        lines: lineInputs,
        operationKey: opKey,
      };
      try {
        const res = await postStockWithRetry(() => receivePO(poPayload));
        onPosted(res.id as Id<"supplierReceipts">);
      } catch (cause) {
        handleReceiveError(cause);
      }
      return;
    }

    // Direct receipt without PO
    if (!reason.trim()) {
      setError("Enter a reason for receiving without a purchase order.");
      document.getElementById("direct-recv-reason")?.focus();
      return;
    }
    const errs: StockLineFieldErrors = {};
    let firstDirectInvalidId: string | undefined;
    const directPayload: FunctionArgs<typeof api.commerce.purchasing.receiveWithoutOrder>["lines"] = [];
    for (const line of directLines) {
      const qtyParsed = parseWholeQuantity(line.quantityText, { allowZero: false });
      const costParsed = parseOptionalSatang(line.unitCostText ?? "");
      const isTracked = trackedVariantIds.has(line.variantId);
      const lotCode = (lotCodeByKey[line.variantId] ?? "").trim();
      const lotExpiry = lotExpiryByKey[line.variantId] ?? "";
      if (!qtyParsed.ok || !qtyParsed.value) {
        errs[line.variantId] = { ...(errs[line.variantId] ?? {}), quantity: qtyParsed.ok ? "Required" : qtyParsed.error };
        firstDirectInvalidId ??= `direct-line-qty-${line.variantId}`;
      }
      if (!costParsed.ok) {
        errs[line.variantId] = { ...(errs[line.variantId] ?? {}), unitCost: costParsed.error };
        firstDirectInvalidId ??= `direct-line-cost-${line.variantId}`;
      }
      if (isTracked && qtyParsed.ok && (qtyParsed.value ?? 0) > 0) {
        if (!lotCode) {
          errs[line.variantId] = { ...(errs[line.variantId] ?? {}), lotCode: `Enter a lot code for ${line.productName}.` };
          firstDirectInvalidId ??= `direct-lot-code-${line.variantId}`;
        }
        if (!lotExpiry) {
          errs[line.variantId] = { ...(errs[line.variantId] ?? {}), lotExpiry: `Select an expiry date for ${line.productName}.` };
          firstDirectInvalidId ??= `direct-lot-exp-${line.variantId}`;
        }
      }
      if (qtyParsed.ok && qtyParsed.value && costParsed.ok && !errs[line.variantId]) {
        directPayload.push({
          variantId: line.variantId,
          accepted: qtyParsed.value,
          ...(costParsed.value !== undefined ? { unitCost: costParsed.value } : {}),
          ...(isTracked && lotCode && lotExpiry ? { lotReceipt: { code: lotCode, expiresAt: resortMidnight(lotExpiry) } } : {}),
        });
      }
    }
    setDirectLineErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError("Fix the highlighted item fields before posting.");
      if (firstDirectInvalidId) document.getElementById(firstDirectInvalidId)?.focus();
      return;
    }
    if (directPayload.length === 0 && heldCheck.value.length === 0) {
      setError("Add at least one received or held item.");
      return;
    }
    const followUpCheck = resolveFollowUpPayload(directPayload);
    if (!followUpCheck.ok) {
      setError(followUpCheck.error);
      return;
    }
    if (effectiveOpenOrderMatches.length > 0 && !confirmBypassOpenOrders) {
      setError("Matching open orders exist for these items. Receive against an open order above or confirm bypass below.");
      document.getElementById("recv-bypass-open-orders")?.focus();
      return;
    }

    setSaving(true);
    const directArgs: FunctionArgs<typeof api.commerce.purchasing.receiveWithoutOrder> = {
      branchId,
      supplierId: supplier?.id,
      reason: reason.trim(),
      deliveryReference: deliveryReference.trim() || undefined,
      invoiceTotal,
      note: note.trim() || undefined,
      bypassOpenOrders: confirmBypassOpenOrders || undefined,
      confirmDuplicate,
      followUp: followUpCheck.value,
      undercount: !followUpCheck.value ? undercount : undefined,
      held: heldCheck.value.length ? heldCheck.value : undefined,
      lines: directPayload,
      operationKey: opKey,
    };
    try {
      const res = await postStockWithRetry(() => receiveDirect(directArgs));
      onPosted(res.id as Id<"supplierReceipts">);
    } catch (cause) {
      handleReceiveError(cause);
    }
  }

  function handleReceiveError(cause: unknown) {
    if (isStockWriteConflict(cause)) {
      setError("Stock was busy with another update. Your entries are preserved — click Post receipt to retry safely.");
      setSaving(false);
      return;
    }
    const parsed = parseStockError(cause, "Could not post receipt. Your typed values have been preserved.");
    setError(parsed.message);
    if (cause && typeof cause === "object" && "data" in cause) {
      const data = (cause as { data?: Record<string, unknown> }).data;
      if (data?.code === "DUPLICATE_DELIVERY" && typeof data.receiptId === "string") {
        setDuplicateConflict({
          receiptId: data.receiptId as Id<"supplierReceipts">,
          reference: typeof data.reference === "string" ? data.reference : data.receiptId,
        });
      }
      if (data?.code === "OPEN_ORDERS_MATCH" && Array.isArray(data.matches)) {
        const matches: MatchedOpenOrder[] = [];
        for (const item of data.matches) {
          if (item && typeof item === "object" && typeof (item as { orderId?: unknown }).orderId === "string") {
            const raw = item as { orderId: string; reference?: string };
            matches.push({ orderId: raw.orderId as Id<"purchaseOrders">, reference: raw.reference });
          }
        }
        setServerOpenOrderMatches(matches);
      }
      if (data?.code === "OVER_RECEIPT") {
        const { errors, firstId } = overReceiptErrors(data.lines);
        setPoLineErrors(errors);
        if (firstId) document.getElementById(firstId)?.focus();
      }
    }
    setOpKey(createOperationKey("recv"));
    setSaving(false);
  }

  function switchToMatchedOrder(orderId: Id<"purchaseOrders">) {
    if (mode === "po" && selectedOrderId === orderId) return;
    setMode("po");
    setSelectedOrderId(orderId);
    setReviewedOrder(null);
    setAcceptedByLine({});
    setRejectedByLine({});
    setRejectReasonByLine({});
    setRejectCodeByLine({});
    setSelectedHoldByLine({});
    setPoLineErrors({});
    setError("");
    setServerOpenOrderMatches(null);
    setConfirmBypassOpenOrders(false);
    setOpKey(createOperationKey("recv"));
  }

  const totalAccepted =
    mode === "po"
      ? (orderDetail?.lines ?? []).reduce((sum, line) => sum + (Number(acceptedByLine[line._id] ?? 0) || 0), 0)
      : directLines.reduce((sum, line) => sum + (Number(line.quantityText) || 0), 0);
  const totalHeld = heldLines.reduce((sum, h) => sum + (Number(h.quantityText) || 0), 0);

  function addDirectItems(items: BalancePickerRow[]) {
    setDirectLines((current) => [
      ...current,
      ...items.map((item) => ({
        variantId: item.variantId,
        productName: item.productName,
        variantLabel: item.label,
        sku: item.sku,
        onHand: item.onHand,
        onOrder: item.onOrder,
        lotTracked: item.lotTracked,
        quantityText: followUp ? String(followUp.quantity) : "",
        unitCostText: "",
      })),
    ]);
    setServerOpenOrderMatches(null);
    setConfirmBypassOpenOrders(false);
    setOpKey(createOperationKey("recv"));
  }

  const matchedOrderIdSet = useMemo(
    () => new Set(proactiveOpenOrderMatches.map((m) => m.orderId)),
    [proactiveOpenOrderMatches],
  );
  const orderedOpenOrders = useMemo(() => {
    if (matchedOrderIdSet.size === 0) return openOrders;
    return [...openOrders].sort((a, b) => Number(matchedOrderIdSet.has(b._id)) - Number(matchedOrderIdSet.has(a._id)));
  }, [openOrders, matchedOrderIdSet]);

  return (
    <>
      <EditorSheet
        open
        wide
        onClose={requestClose}
        header={
          <>
            <SheetTitle>Receive delivery · {branchName}</SheetTitle>
            <SheetDescription>
              {followUp
                ? `Post the linked follow-up receipt for the actual item received (exactly ${followUp.quantity} units). This closes the open correction follow-up.`
                : undercount
                  ? "Post the supplemental receipt for units missed on the original delivery."
                  : "Post accepted units into stock. Short, rejected, or damaged units stay due on the order; excess or substitute goods can be held for buyer."}
            </SheetDescription>
          </>
        }
      >
        <SheetForm
          onSubmit={handleSubmit}
          onCancel={requestClose}
          saving={saving}
          error={error}
          submitLabel={`Post receipt (${totalAccepted} accepted${totalHeld > 0 ? ` · ${totalHeld} held` : ""})`}
        >
          {followUp ? (
            <Callout tone="info" title="Linked correction follow-up">
              Select the single actual item received and enter exactly <strong>{followUp.quantity}</strong> accepted units.
            </Callout>
          ) : undercount ? (
            <Callout tone="info" title="Linked undercount receipt">
              Accept only the missing units from the earlier delivery at {branchName}.
            </Callout>
          ) : null}

          {!initialOrderId ? (
            <ChoiceGroup
              name="receive-mode"
              label="Receiving path"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError("");
                setDuplicateConflict(null);
                setServerOpenOrderMatches(null);
                setConfirmBypassOpenOrders(false);
                setOpKey(createOperationKey("recv"));
              }}
              options={[
                { value: "po", label: "Receive against an open order", hint: "Links receipt and updates On order" },
                ...(allowDirectReceipt
                  ? [{ value: "direct" as const, label: "Receive without PO", hint: "Allowed unplanned supplier delivery" }]
                  : []),
              ]}
            />
          ) : null}

          {mode === "po" && dueChanges.length > 0 ? (
            <Callout tone="warning" title="Due quantities changed in the new revision">
              <ul className="grid gap-0.5 text-xs">
                {dueChanges.map((change) => (
                  <li key={change.lineId}>
                    {change.label}: <span className="font-mono tabular-nums">{change.before} → {change.after}</span> due
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {mode === "po" ? (
            <ReceivePurchaseOrderSection
              branchName={branchName}
              initialOrderId={initialOrderId}
              allowDirectReceipt={allowDirectReceipt}
              orderSearch={orderSearch}
              onOrderSearchChange={setOrderSearch}
              orderedOpenOrders={orderedOpenOrders}
              openOrdersStatus={openOrdersStatus}
              onLoadMoreOrders={() => loadMoreOrders(STOCK_PAGE_SIZE)}
              matchedOrderIdSet={matchedOrderIdSet}
              selectedOrderId={selectedOrderId}
              orderDetail={orderDetail}
              reviewedOrder={reviewedOrder}
              isOrderStale={isOrderStale}
              acceptedByLine={acceptedByLine}
              rejectedByLine={rejectedByLine}
              rejectReasonByLine={rejectReasonByLine}
              selectedHoldByLine={selectedHoldByLine}
              lotCodeByKey={lotCodeByKey}
              lotExpiryByKey={lotExpiryByKey}
              trackedVariantIds={trackedVariantIds}
              poLineErrors={poLineErrors}
              eligibleHoldsByLine={eligibleHoldsByLine}
              onSelectOrder={switchToMatchedOrder}
              onAcceptStaleOrder={() => {
                if (!orderDetail) return;
                // Compare each line's pinned due with the new revision; keep typed values and flag any that now exceed it.
                const pinned = reviewedOrder?.dueByLine ?? {};
                const changes = orderDetail.lines
                  .filter((line) => pinned[line._id] !== undefined && pinned[line._id] !== line.due)
                  .map((line) => ({
                    lineId: line._id, label: `${line.item.productName} · ${line.item.variantLabel}`, before: pinned[line._id], after: line.due,
                  }));
                const errors: PoLineFieldErrors = {};
                let firstExceeding: string | undefined;
                for (const change of changes) {
                  const typed = Number((acceptedByLine[change.lineId] ?? "").trim() || "0");
                  if (Number.isFinite(typed) && typed > change.after) {
                    errors[change.lineId] = { accepted: `Due changed ${change.before} → ${change.after}. Enter ${change.after} or less, or hold the excess.` };
                    firstExceeding ??= `po-acc-${change.lineId}`;
                  }
                }
                setDueChanges(changes);
                setReviewedOrder({
                  orderId: orderDetail.order._id,
                  issuedRevision: orderDetail.order.issuedRevision,
                  revision: orderDetail.order.revision,
                  dueByLine: Object.fromEntries(orderDetail.lines.map((line) => [line._id, line.due])),
                });
                setError("");
                setPoLineErrors(errors);
                setOpKey(createOperationKey("recv"));
                if (firstExceeding) {
                  const id = firstExceeding;
                  requestAnimationFrame(() => document.getElementById(id)?.focus());
                }
              }}
              onReceiveAllRemaining={receiveAllRemaining}
              onAcceptedChange={(lineId, val) => {
                setAcceptedByLine((curr) => ({ ...curr, [lineId]: val }));
                setPoLineErrors((curr) => curr[lineId]?.accepted ? { ...curr, [lineId]: { ...curr[lineId], accepted: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
              onRejectedChange={(lineId, val) => { setRejectedByLine((curr) => ({ ...curr, [lineId]: val })); setOpKey(createOperationKey("recv")); }}
              onRejectReasonChange={(lineId, val) => { setRejectReasonByLine((curr) => ({ ...curr, [lineId]: val })); setOpKey(createOperationKey("recv")); }}
              rejectCodeByLine={rejectCodeByLine}
              onRejectCodeChange={(lineId, code) => {
                setRejectCodeByLine((curr) => ({ ...curr, [lineId]: code }));
                setPoLineErrors((curr) => curr[lineId]?.rejectReasonCode ? { ...curr, [lineId]: { ...curr[lineId], rejectReasonCode: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
              onHoldChange={(lineId, holdId) => { setSelectedHoldByLine((curr) => ({ ...curr, [lineId]: holdId })); setOpKey(createOperationKey("recv")); }}
              onLotCodeChange={(lineId, val) => {
                setLotCodeByKey((curr) => ({ ...curr, [lineId]: val }));
                setPoLineErrors((curr) => curr[lineId]?.lotCode ? { ...curr, [lineId]: { ...curr[lineId], lotCode: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
              onLotExpiryChange={(lineId, val) => {
                setLotExpiryByKey((curr) => ({ ...curr, [lineId]: val }));
                setPoLineErrors((curr) => curr[lineId]?.lotExpiry ? { ...curr, [lineId]: { ...curr[lineId], lotExpiry: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
            />
          ) : (
            <ReceiveDirectSection
              branchId={branchId}
              canAddSupplier={canAddSupplier}
              supplier={supplier}
              reason={reason}
              directLines={directLines}
              directLineErrors={directLineErrors}
              lotCodeByKey={lotCodeByKey}
              lotExpiryByKey={lotExpiryByKey}
              trackedVariantIds={trackedVariantIds}
              openOrderMatches={effectiveOpenOrderMatches}
              confirmBypassOpenOrders={confirmBypassOpenOrders}
              onSupplierChange={(next) => { setSupplier(next); setOpKey(createOperationKey("recv")); }}
              onReasonChange={(val) => { setReason(val); setOpKey(createOperationKey("recv")); }}
              onDirectLinesChange={(next) => {
                setDirectLines(next);
                setDirectLineErrors({});
                setServerOpenOrderMatches(null);
                setConfirmBypassOpenOrders(false);
                setOpKey(createOperationKey("recv"));
              }}
              onOpenDirectPicker={() => setDirectPickerOpen(true)}
              onLotCodeChange={(variantId, val) => {
                setLotCodeByKey((curr) => ({ ...curr, [variantId]: val }));
                setDirectLineErrors((curr) => curr[variantId]?.lotCode ? { ...curr, [variantId]: { ...curr[variantId], lotCode: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
              onLotExpiryChange={(variantId, val) => {
                setLotExpiryByKey((curr) => ({ ...curr, [variantId]: val }));
                setDirectLineErrors((curr) => curr[variantId]?.lotExpiry ? { ...curr, [variantId]: { ...curr[variantId], lotExpiry: undefined } } : curr);
                setOpKey(createOperationKey("recv"));
              }}
              onSwitchToOrder={switchToMatchedOrder}
              onConfirmBypassChange={(checked) => { setConfirmBypassOpenOrders(checked); setOpKey(createOperationKey("recv")); }}
            />
          )}

          <ReceiveDeliveryMetaSection
            deliveryReference={deliveryReference}
            invoiceTotal={invoiceTotalText}
            invoiceTotalError={invoiceTotalError}
            onInvoiceTotalChange={(val) => {
              setInvoiceTotalText(val);
              setInvoiceTotalError("");
              setOpKey(createOperationKey("recv"));
            }}
            note={note}
            duplicateConflict={duplicateConflict}
            duplicateReason={duplicateReason}
            onDeliveryReferenceChange={(val) => {
              setDeliveryReference(val);
              setDuplicateConflict(null);
              setOpKey(createOperationKey("recv"));
            }}
            onNoteChange={(val) => {
              setNote(val);
              setOpKey(createOperationKey("recv"));
            }}
            onDuplicateReasonChange={(val) => {
              setDuplicateReason(val);
              setOpKey(createOperationKey("recv"));
            }}
          />

          <ReceiveHeldGoodsSection
            heldLines={heldLines}
            onAddClick={() => setHeldPickerOpen(true)}
            onRemove={(idx) => {
              setHeldLines((curr) => curr.filter((_, i) => i !== idx));
              setOpKey(createOperationKey("recv"));
            }}
            onChangeQuantity={(idx, val) => {
              setHeldLines((curr) => curr.map((row, i) => (i === idx ? { ...row, quantityText: val } : row)));
              setOpKey(createOperationKey("recv"));
            }}
            onChangeReason={(idx, val) => {
              setHeldLines((curr) => curr.map((row, i) => (i === idx ? { ...row, reason: val } : row)));
              setOpKey(createOperationKey("recv"));
            }}
          />
        </SheetForm>
      </EditorSheet>

      <StockVariantPickerDialog
        open={directPickerOpen}
        onOpenChange={setDirectPickerOpen}
        branchId={branchId}
        selectedIds={directLines.map((l) => l.variantId)}
        title={followUp ? "Select the actual item received" : "Add items to direct receipt"}
        {...(followUp
          ? { onSelect: (item: BalancePickerRow) => addDirectItems([item]) }
          : { onSelectMany: addDirectItems })}
      />

      <StockVariantPickerDialog
        open={heldPickerOpen}
        onOpenChange={setHeldPickerOpen}
        branchId={branchId}
        selectedIds={heldLines.map((h) => h.variantId)}
        title="Add held goods for buyer review"
        onSelect={(item) => {
          setHeldLines((curr) => [
            ...curr,
            {
              key: `hold-${++holdKeySeq}`,
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              quantityText: "1",
              reason: "",
            },
          ]);
          setOpKey(createOperationKey("recv"));
        }}
      />
    </>
  );
}
