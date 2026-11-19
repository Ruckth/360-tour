import type { api } from "convex/_generated/api";
import { editReasons, stockReasons } from "convex/shared/commerce/reasons";
import type { FunctionReturnType } from "convex/server";
import type { EditReason, GuestFact, GuestFactKey, HistoryEntry, StockReason } from "./backend";
import type { TargetApproval } from "./TargetApproval";

/**
 * The live backend's commerce reads, turned into the views commerce screens draw. Pure, so the
 * shapes are tested without a Convex client (convex-backend.ts calls these).
 */

type HistoryRow =
  | FunctionReturnType<typeof api.commerce.history.staffPage>["page"][number]
  | FunctionReturnType<typeof api.commerce.history.guestPage>["page"][number];
type QueueRow = FunctionReturnType<typeof api.pos.staffApprovals.pendingPage>["page"][number];
export type TargetQueueRow = Extract<QueueRow, { kind: "adjustment" | "returnItems" }>;
type ApprovalDetail = FunctionReturnType<typeof api.pos.staffApprovals.detail>;

/** The arguments each fact's words need. A fact without them reads as a plain "Updated". */
const FACT_ARGS: { [K in GuestFactKey]: Record<string, "string" | "number"> } = {
  purchased: { name: "string" }, issued: { amount: "number" }, used: { service: "string" }, restored: {}, noShow: {}, waived: {},
  transferredIn: {}, transferredOut: {}, extended: { date: "number" }, paused: {}, resumed: { date: "number" },
  goodwillAdded: {}, goodwillRemoved: {}, renamed: { name: "string" }, reissued: {}, disabled: {}, expired: {},
  cancelled: {}, spent: { amount: "number" }, refundCredit: { amount: "number" }, serviceAdded: { service: "string" }, sold: {},
  stockAdjusted: {}, roomCharge: { room: "string" }, takenBack: {}, published: {}, updated: {},
};
const EDIT_REASONS = new Set<string>(editReasons);
const STOCK_REASONS = new Set<string>(stockReasons);

function guestFact({ key, args = {} }: HistoryRow["fact"]): GuestFact {
  const needs = Object.hasOwn(FACT_ARGS, key) ? FACT_ARGS[key as GuestFactKey] : null;
  if (!needs || !Object.entries(needs).every(([name, type]) => typeof args[name] === type)) return { key: "updated" };
  return { ...args, key } as GuestFact;
}

/** One History row from commerce/history.staffPage or guestPage. Show guest rows never carry `staff`. */
export function historyEntry(row: HistoryRow): HistoryEntry {
  const entry: HistoryEntry = { entryId: row.entryId, at: row.at, fact: guestFact(row.fact), balance: row.balance };
  if (!("staff" in row) || !row.staff) return entry;
  const { actorName, reason, reasonText } = row.staff;
  const known = reason !== null && (EDIT_REASONS.has(reason) || STOCK_REASONS.has(reason)) ? (reason as EditReason | StockReason) : null;
  return { ...entry, staff: { actorName, reason: known, reasonText } };
}

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
