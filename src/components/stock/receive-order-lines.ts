import type { FunctionArgs } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { resortMidnight } from "@/lib/staff-bookings";
import type { PoLineFieldErrors, ReceiveAcceptableHold, ReceiveOrderDetail } from "./ReceiveDeliverySections";
import { overReceiptAllowance, parseWholeQuantity, type RejectReasonCodeValue } from "./stock-format";

type ReceiveOrderArgs = FunctionArgs<typeof api.commerce.purchasing.receivePurchaseOrder>;

export type OrderReceiptInputs = {
  acceptedByLine: Record<string, string>;
  rejectedByLine: Record<string, string>;
  rejectReasonByLine: Record<string, string>;
  rejectCodeByLine: Record<string, RejectReasonCodeValue | undefined>;
  selectedHoldByLine: Record<string, Id<"purchaseHolds"> | "">;
  lotCodeByKey: Record<string, string>;
  lotExpiryByKey: Record<string, string>;
  trackedVariantIds: ReadonlySet<Id<"productVariants">>;
  eligibleHoldsByLine: ReadonlyMap<Id<"purchaseOrderLines">, ReceiveAcceptableHold[]>;
};

/**
 * Validate the typed PO receiving lines and build the mutation payload: quantities, a fixed rejection code for rejected
 * units, the branch over-delivery tolerance, the selected open hold and lot evidence for tracked items. Errors are keyed
 * by order line, with the first invalid field id to focus.
 */
export function buildOrderReceiptLines(orderDetail: ReceiveOrderDetail, inputs: OrderReceiptInputs) {
  const {
    acceptedByLine, rejectedByLine, rejectReasonByLine, rejectCodeByLine, selectedHoldByLine,
    lotCodeByKey, lotExpiryByKey, trackedVariantIds, eligibleHoldsByLine,
  } = inputs;
  const lineInputs: ReceiveOrderArgs["lines"] = [];
  const acceptedSummary: { variantId: Id<"productVariants">; accepted: number }[] = [];
  const nextPoErrors: PoLineFieldErrors = {};
  let firstInvalidId: string | undefined;
  const usedHoldIds = new Set<string>();

  for (const line of orderDetail.lines) {
    const accRaw = (acceptedByLine[line._id] ?? "").trim();
    const rejRaw = (rejectedByLine[line._id] ?? "").trim();
    if (!accRaw && !rejRaw) continue;
    const accParsed = parseWholeQuantity(accRaw || "0", { allowZero: true, label: "Accepted quantity" });
    const rejParsed = parseWholeQuantity(rejRaw || "0", { allowZero: true, label: "Rejected quantity" });
    if (!accParsed.ok || accParsed.value === undefined) {
      nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), accepted: accParsed.ok ? "Invalid accepted quantity." : accParsed.error };
      firstInvalidId ??= `po-acc-${line._id}`;
    }
    if (!rejParsed.ok || rejParsed.value === undefined) {
      nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), rejected: rejParsed.ok ? "Invalid rejected quantity." : rejParsed.error };
      firstInvalidId ??= `po-rej-${line._id}`;
    }
    if (rejParsed.ok && (rejParsed.value ?? 0) > 0 && !rejectCodeByLine[line._id]) {
      nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), rejectReasonCode: `Choose why ${line.item.productName} was rejected.` };
      firstInvalidId ??= `po-rej-code-${line._id}`;
    }
    const allowance = overReceiptAllowance(line, orderDetail.overReceiptTolerancePct);
    if (accParsed.ok && (accParsed.value ?? 0) > line.due + allowance) {
      nextPoErrors[line._id] = {
        ...(nextPoErrors[line._id] ?? {}),
        accepted: allowance > 0
          ? `At most ${line.due + allowance} (${line.due} due + ${allowance} tolerance). Hold the excess.`
          : `At most ${line.due} still due on this line. Hold the excess.`,
      };
      firstInvalidId ??= `po-acc-${line._id}`;
    }
    const chosenHoldId = selectedHoldByLine[line._id] || "";
    let verifiedHoldId: Id<"purchaseHolds"> | undefined;
    if (chosenHoldId && accParsed.ok && (accParsed.value ?? 0) > 0) {
      const matchedHold = eligibleHoldsByLine.get(line._id)?.find((h) => h.holdId === chosenHoldId);
      if (!matchedHold) {
        nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), hold: "Selected held goods record is no longer open for this line." };
        firstInvalidId ??= `po-hold-${line._id}`;
      } else if (usedHoldIds.has(matchedHold.holdId)) {
        nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), hold: "Each held goods record can only be accepted once per receipt." };
        firstInvalidId ??= `po-hold-${line._id}`;
      } else if ((accParsed.value ?? 0) > matchedHold.remaining) {
        const label = matchedHold.receiptReference ?? "the selected hold";
        nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), accepted: `Accept at most ${matchedHold.remaining} held units for ${label}.` };
        firstInvalidId ??= `po-acc-${line._id}`;
      } else {
        usedHoldIds.add(matchedHold.holdId);
        verifiedHoldId = matchedHold.holdId;
      }
    }
    const isTracked = trackedVariantIds.has(line.variantId);
    const lotCode = (lotCodeByKey[line._id] ?? "").trim();
    const lotExpiry = lotExpiryByKey[line._id] ?? "";
    if (isTracked && accParsed.ok && (accParsed.value ?? 0) > 0) {
      if (!lotCode) {
        nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), lotCode: `Enter a lot code for ${line.item.productName}.` };
        firstInvalidId ??= `po-lot-code-${line._id}`;
      }
      if (!lotExpiry) {
        nextPoErrors[line._id] = { ...(nextPoErrors[line._id] ?? {}), lotExpiry: `Select an expiry date for ${line.item.productName}.` };
        firstInvalidId ??= `po-lot-exp-${line._id}`;
      }
    }

    if (!nextPoErrors[line._id] && accParsed.ok && rejParsed.ok) {
      const acceptedVal = accParsed.value ?? 0;
      const rejectedVal = rejParsed.value ?? 0;
      if (acceptedVal > 0 || rejectedVal > 0) {
        lineInputs.push({
          orderLineId: line._id,
          accepted: acceptedVal,
          ...(rejectedVal > 0
            ? {
                rejected: rejectedVal,
                rejectReasonCode: rejectCodeByLine[line._id],
                rejectReason: (rejectReasonByLine[line._id] ?? "").trim() || undefined,
              }
            : {}),
          ...(verifiedHoldId ? { holdId: verifiedHoldId } : {}),
          ...(isTracked && acceptedVal > 0 && lotCode && lotExpiry
            ? { lotReceipt: { code: lotCode, expiresAt: resortMidnight(lotExpiry) } }
            : {}),
        });
        if (acceptedVal > 0) acceptedSummary.push({ variantId: line.variantId, accepted: acceptedVal });
      }
    }
  }

  return { lineInputs, acceptedSummary, errors: nextPoErrors, firstInvalidId };
}

/** Field errors for a server `OVER_RECEIPT` refusal: each line's due units and any tolerance allowance. */
export function overReceiptErrors(lines: unknown) {
  const errors: PoLineFieldErrors = {};
  let firstId: string | undefined;
  for (const row of Array.isArray(lines) ? lines : []) {
    if (!row || typeof row !== "object" || typeof (row as { orderLineId?: unknown }).orderLineId !== "string") continue;
    const { orderLineId, due, allowance } = row as { orderLineId: string; due?: number; allowance?: number };
    errors[orderLineId] = {
      accepted: due === undefined
        ? "Exceeds remaining due quantity."
        : allowance
          ? `At most ${due + allowance} (${due} due + ${allowance} tolerance). Hold the excess.`
          : `At most ${due} still due on this line.`,
    };
    firstId ??= `po-acc-${orderLineId}`;
  }
  return { errors, firstId };
}
