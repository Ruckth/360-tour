import type { Id } from "convex/_generated/dataModel";
import type { ApprovalDetail, ApprovalQueueRow } from "../backend";
import { COMMERCE_RECEIPT_ID } from "./commerce-receipt";

/**
 * The Approvals panel with both shapes of request, for the preview and tests: today's order-scoped
 * discount request, a return of items from the commerce receipt, and an extension on Maya's
 * Massage 5 that went stale when another till used a session (expected revision 6, now 7).
 * The queue is staffApprovals.pendingPage's compact rows; each detail is what staffApprovals.detail
 * returns once that request is opened.
 */

// Relative to now, so the preview shows live expiry times.
const NOW = Date.now();
const MIN = 60_000;
const DISCOUNT = "fxappr000001" as Id<"staffApprovalRequests">;
const RETURN = "fxappr000002" as Id<"staffApprovalRequests">;
const EXTEND = "fxappr000003" as Id<"staffApprovalRequests">;
const GRANT = { targetType: "grant" as const, targetId: "fxgrantmaya" as Id<"sessionGrants"> };

export const previewQueue: ApprovalQueueRow[] = [
  {
    _id: DISCOUNT, kind: "discount", requesterEmail: "ploy@example.com", createdAt: NOW - MIN, expiresAt: NOW + 4 * MIN, status: "pending",
    orderId: "fxbill000011" as Id<"orders">, lineId: "fxline000012" as Id<"orderLines">, label: "discount", summary: { amount: 18000, percent: 1500 },
  },
  {
    _id: RETURN, kind: "returnItems", requesterEmail: "ploy@example.com", createdAt: NOW - 2 * MIN, expiresAt: NOW + 3 * MIN, status: "pending",
    orderId: COMMERCE_RECEIPT_ID, lineId: undefined, label: "returnItems", summary: { amount: 129000, partCount: 1 },
  },
  {
    _id: EXTEND, kind: "adjustment", requesterEmail: "nok@example.com", createdAt: NOW - 3 * MIN, expiresAt: NOW + 2 * MIN, status: "pending",
    target: GRANT, label: "grant", summary: { adjustmentKind: "extend" },
  },
] as ApprovalQueueRow[];

export const previewDetails = {
  [DISCOUNT]: {
    kind: "discount", status: "pending",
    target: { orderId: "fxbill000011", orderNumber: 1042, receiptNumber: undefined, status: "open", total: 225000, currency: "THB" },
    orderRevision: { expected: 4, current: 4 },
    rows: [{ lineId: "fxline000012", label: "Thai massage 90", kind: "service", quantity: 1, unitPrice: 120000 }],
    request: {
      _id: DISCOUNT, _creationTime: NOW - MIN, orderId: "fxbill000011", lineId: "fxline000012", kind: "discount",
      payload: { kind: "discount", lineId: "fxline000012", discount: { type: "percent", value: 1500 } },
      reason: "Regular guest, birthday", requesterEmail: "ploy@example.com", approverEmail: undefined, orderRevision: 4, rulesRevision: 1, status: "pending",
      createdAt: NOW - MIN, expiresAt: NOW + 4 * MIN, resolvedAt: undefined, resolutionReason: undefined, amount: 18000, percent: 1500, totalBefore: 225000, totalAfter: 207000,
    },
  },
  [RETURN]: {
    kind: "returnItems", status: "pending", freshness: "checked",
    target: { orderId: COMMERCE_RECEIPT_ID, orderNumber: 1046, receiptNumber: 145, status: "paid", total: 919000, currency: "THB" },
    orderRevision: { expected: 9, current: 9 }, rows: [], revisions: [],
    request: { _id: RETURN, requesterEmail: "ploy@example.com", createdAt: NOW - 2 * MIN, expiresAt: NOW + 3 * MIN, reason: "Robe too small, guest brought it back unworn", parts: [], orderId: COMMERCE_RECEIPT_ID, amount: 129000 },
  },
  [EXTEND]: {
    kind: "adjustment", status: "pending",
    target: { ...GRANT, label: "Massage 5 · Maya Lin" },
    revisions: [{ ...GRANT, expected: 6, current: 7 }],
    request: { _id: EXTEND, requesterEmail: "nok@example.com", createdAt: NOW - 3 * MIN, expiresAt: NOW + 2 * MIN, reason: "Maya was ill for two weeks", payload: { target: GRANT, adjustmentKind: "extend" } },
  },
} as unknown as Record<string, ApprovalDetail>;
