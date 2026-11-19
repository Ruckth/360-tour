import { describe, expect, it } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { isTargetRow, targetApproval, type TargetQueueRow } from "@/components/checkout/approval-readers";
import { historyEntry } from "@/components/checkout/commerce-readers";

const id = (value: string) => value as Id<"staffApprovalRequests">;
const balance = { unit: "money" as const, before: { paid: 600, goodwill: 0 }, after: { paid: 400, goodwill: 0 } };

describe("History rows from the live backend", () => {
  it("keeps a fact whose arguments are all there", () => {
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "spent", args: { amount: 200 } }, balance }).fact).toEqual({ key: "spent", amount: 200 });
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "renamed", args: { name: "Mia" } }, balance: null }).fact).toEqual({ key: "renamed", name: "Mia" });
  });

  it("reads an unknown fact or one missing its words as Updated", () => {
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "used" }, balance: null }).fact).toEqual({ key: "updated" });
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "spent", args: { amount: "฿2" } }, balance: null }).fact).toEqual({ key: "updated" });
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "toString" }, balance: null }).fact).toEqual({ key: "updated" });
  });

  it("keeps known reasons for staff and drops anything else", () => {
    const staff = (reason: string | null) => historyEntry({ entryId: "a", at: 1, fact: { key: "paused" }, balance: null, staff: { actorName: "Ploy", reason, reasonText: null } }).staff;
    expect(staff("healthPause")).toEqual({ actorName: "Ploy", reason: "healthPause", reasonText: null });
    expect(staff("recount")?.reason).toBe("recount");
    expect(staff("free text")?.reason).toBeNull();
    expect(historyEntry({ entryId: "a", at: 1, fact: { key: "paused" }, balance: null })).not.toHaveProperty("staff");
  });
});

describe("Returns and edits waiting for a manager", () => {
  const edit: TargetQueueRow = {
    _id: id("fxappr3"), kind: "adjustment", requesterEmail: "nok@example.com", createdAt: 1, expiresAt: 2, status: "pending", actionable: true,
    target: { targetType: "grant", targetId: "fxgrant" as Id<"sessionGrants"> }, label: "grant", summary: { adjustmentKind: "extend" },
  };
  const ret = {
    _id: id("fxappr2"), kind: "returnItems", requesterEmail: "ploy@example.com", createdAt: 1, expiresAt: 2, status: "pending",
    orderId: "fxorder" as Id<"orders">, lineId: undefined, label: "returnItems", summary: { amount: 129000, partCount: 1 },
  } as TargetQueueRow;
  const request = { _id: id("fxappr3"), requesterEmail: "nok@example.com", createdAt: 1, expiresAt: 2, resolvedAt: undefined, approverEmail: undefined, reason: "Maya was ill" };

  it("leaves order-scoped requests to the existing panel", () => {
    expect(isTargetRow(edit)).toBe(true);
    expect(isTargetRow({ ...edit, kind: "discount" } as never)).toBe(false);
  });

  it("shows a row before its detail loads, then its reason, label and revisions", () => {
    expect(targetApproval(edit, undefined)).toMatchObject({ reason: "", status: "pending", targetLabel: null, revisions: [], adjustmentKind: "extend" });
    const detail = {
      kind: "adjustment" as const, status: "stale" as const, target: { label: "Massage 5" },
      revisions: [{ targetType: "grant" as const, targetId: "fxgrant" as Id<"sessionGrants">, expected: 6, current: 7, blockedByReturn: false }],
      request: { ...request, payload: { target: { targetType: "grant", targetId: "fxgrant" }, adjustmentKind: "extend" as const, input: {}, reasonCode: "healthPause" } },
    };
    expect(targetApproval(edit, detail as never)).toEqual({
      _id: edit._id, kind: "adjustment", requesterEmail: "nok@example.com", reason: "Maya was ill", createdAt: 1, expiresAt: 2, status: "stale",
      target: { targetType: "grant", targetId: "fxgrant" }, adjustmentKind: "extend", targetLabel: "Massage 5", orderId: null, amount: null,
      revisions: [{ expected: 6, current: 7 }],
    });
  });

  it("drops a request its detail says is decided, and reads a return's order revision first", () => {
    expect(targetApproval(edit, { kind: "adjustment", status: "applied", target: null, revisions: [], request } as never)).toBeNull();
    const detail = { kind: "returnItems", status: "pending", freshness: "checked", target: null, rows: [], request,
      orderRevision: { expected: 9, current: 9 }, revisions: [{ table: "vouchers", id: "fxv", expected: 2, current: 3 }] };
    expect(targetApproval(ret, detail as never)).toMatchObject({ kind: "returnItems", orderId: "fxorder", amount: 129000, target: null, revisions: [{ expected: 9, current: 9 }, { expected: 2, current: 3 }] });
  });
});
