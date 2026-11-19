import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { TargetApproval } from "./TargetApproval";

/**
 * A return or edit request from the Approvals queue and its detail, as the approval item draws it.
 * Only TargetApproval (loaded on demand) imports this, so checkout's first screen doesn't carry it.
 */

type QueueRow = FunctionReturnType<typeof api.pos.staffApprovals.pendingPage>["page"][number];
export type TargetQueueRow = Extract<QueueRow, { kind: "adjustment" | "returnItems" }>;
type ApprovalDetail = FunctionReturnType<typeof api.pos.staffApprovals.detail>;

export const isTargetRow = (row: QueueRow): row is TargetQueueRow => row.kind === "adjustment" || row.kind === "returnItems";

/**
 * A return or edit request in the Approvals panel: the queue row, completed by its detail (reason,
 * label and the revisions it was asked against). null once the detail says it's no longer waiting.
 */
export function targetApproval(row: TargetQueueRow, detail: ApprovalDetail | undefined): TargetApproval | null {
  const known = detail && detail.kind === row.kind ? detail : null;
  if (known && known.status !== "pending" && known.status !== "stale") return null;
  const common = {
    _id: row._id, requesterEmail: row.requesterEmail, createdAt: row.createdAt, expiresAt: row.expiresAt,
    reason: known?.request.reason ?? "", status: known?.status === "stale" ? "stale" as const : "pending" as const,
  };
  if (row.kind === "adjustment") {
    const adjustment = known?.kind === "adjustment" ? known : null;
    return {
      ...common, kind: "adjustment", target: row.target, adjustmentKind: row.summary.adjustmentKind,
      targetLabel: (adjustment?.target && "label" in adjustment.target ? adjustment.target.label : null) ?? null, orderId: null, amount: null,
      revisions: adjustment?.revisions.map(({ expected, current }) => ({ expected, current })) ?? [],
    };
  }
  const items = known?.kind === "returnItems" ? known : null;
  return {
    ...common, kind: "returnItems", target: null, adjustmentKind: null, targetLabel: null, orderId: row.orderId,
    amount: row.summary.amount ?? null,
    revisions: items ? [items.orderRevision, ...items.revisions].map(({ expected, current }) => ({ expected, current })) : [],
  };
}
