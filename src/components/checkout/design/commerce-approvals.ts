import type { Id } from "convex/_generated/dataModel";
import type { ApprovalQueue } from "../backend";
import type { TargetApproval } from "../TargetApproval";
import { COMMERCE_RECEIPT_ID } from "./commerce-receipt";

/**
 * The Approvals panel with both shapes of request, for the preview and tests: today's order-scoped
 * discount request, a return of items from the commerce receipt, and an extension on Maya's
 * Massage 5 that went stale when another till used a session (expected revision 6, now 7).
 */

// Relative to now, so the preview shows live expiry times.
const NOW = Date.now();
const MIN = 60_000;

export const previewApprovals: ApprovalQueue = {
  count: 1,
  list: [{
    _id: "fxappr000001" as Id<"staffApprovalRequests">, _creationTime: NOW - MIN, orderId: "fxbill000011" as Id<"orders">,
    lineId: "fxline000012" as Id<"orderLines">, kind: "discount", payload: { kind: "discount", lineId: "fxline000012" as Id<"orderLines">, discount: { type: "percent", value: 1500 } },
    reason: "Regular guest, birthday", requesterEmail: "ploy@example.com", approverEmail: undefined, orderRevision: 4, rulesRevision: 1, status: "pending",
    createdAt: NOW - MIN, expiresAt: NOW + 4 * MIN, resolvedAt: undefined, resolutionReason: undefined, amount: 18000, percent: 1500, totalBefore: 225000, totalAfter: 207000,
  }],
};

export const previewTargetApprovals: TargetApproval[] = [
  {
    _id: "fxappr000002" as Id<"staffApprovalRequests">, kind: "returnItems", requesterEmail: "ploy@example.com", reason: "Robe too small, guest brought it back unworn",
    createdAt: NOW - 2 * MIN, expiresAt: NOW + 3 * MIN, status: "pending", target: null, adjustmentKind: null, targetLabel: null, orderId: COMMERCE_RECEIPT_ID, amount: 129000,
    revisions: [{ expected: 9, current: 9 }],
  },
  {
    _id: "fxappr000003" as Id<"staffApprovalRequests">, kind: "adjustment", requesterEmail: "nok@example.com", reason: "Maya was ill for two weeks",
    createdAt: NOW - 3 * MIN, expiresAt: NOW + 2 * MIN, status: "pending", target: { targetType: "grant", targetId: "fxgrantmaya" as Id<"sessionGrants"> },
    adjustmentKind: "extend", targetLabel: "Massage 5 · Maya Lin", orderId: null, amount: null, revisions: [{ expected: 6, current: 7 }],
  },
];
