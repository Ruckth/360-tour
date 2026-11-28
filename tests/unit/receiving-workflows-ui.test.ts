// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { HeldGoodsPanel, type HeldGoodsRow } from "@/components/stock/HeldGoodsPanel";
import { buildOrderReceiptLines, overReceiptErrors } from "@/components/stock/receive-order-lines";
import type { ReceiveOrderDetail } from "@/components/stock/ReceiveDeliverySections";
import { CorrectReceiptLineSheet, ReturnToSupplierSheet } from "@/components/stock/SupplierReceiptAdjustmentSheets";
import { SupplierReceiptDetailView } from "@/components/stock/SupplierReceiptDetailView";
import {
  CORRECTION_REASON_CHIPS, holdAge, invoiceVariance, overReceiptAllowance, REJECT_REASON_OPTIONS, rejectReasonLabel,
} from "@/components/stock/stock-format";

// Receiving UI regressions: P26–P34 and T23–T25.
const mockConvex = vi.hoisted(() => ({
  query: vi.fn<(name: string, args: unknown) => unknown>(() => undefined),
  paginated: vi.fn<(name: string, args: unknown) => { results: unknown[]; status: string; loadMore: () => void }>(() => ({
    results: [], status: "Exhausted", loadMore: () => undefined,
  })),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));
const mockBranch = vi.hoisted(() => ({
  current: { id: "branch_1" as Id<"branches">, key: "samui", name: "Koh Samui", slug: "koh-samui", state: "active" as const },
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mockConvex.query(getFunctionName(ref), args)),
  useQueries: () => ({}),
  usePaginatedQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? { results: [], status: "Exhausted", loadMore: vi.fn() } : mockConvex.paginated(getFunctionName(ref), args),
  useMutation: (ref: FunctionReference<"mutation">) => mutation(ref),
}));
vi.mock("@/platform/navigation", () => ({
  useSelectedLayoutSegment: () => "purchasing",
  usePathname: () => "/admin/stock/purchasing",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/admin/branch/branch-context", () => ({
  useAdminBranch: () => ({ current: mockBranch.current, branches: [mockBranch.current], select: vi.fn() }),
}));

function mutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  let fn = mockConvex.mutations.get(name);
  if (!fn) {
    fn = vi.fn();
    mockConvex.mutations.set(name, fn);
  }
  return fn;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
const button = (label: string | RegExp) =>
  [...document.querySelectorAll("button")].find((item) => (typeof label === "string" ? item.textContent?.trim() === label : label.test(item.textContent ?? "")));
const text = () => document.body.textContent ?? "";

const DAY = 86_400_000;
const line = {
  _id: "line_1" as Id<"supplierReceiptLines">, _creationTime: 1, receiptId: "receipt_1" as Id<"supplierReceipts">,
  branchId: "branch_1" as Id<"branches">, variantId: "variant_1" as Id<"productVariants">,
  item: { productName: "Sunscreen", variantLabel: "50 ml" }, accepted: 5, rejected: 1, rejectReasonCode: "damaged" as const,
  rejectReason: "Crushed", corrected: 0, returned: 0, unitCost: 5_000, eligible: 5, movementId: "movement_1" as Id<"stockMovements">,
};

describe("receiving helpers", () => {
  it("keeps damage out of correction reasons and labels fixed rejection codes", () => {
    expect(CORRECTION_REASON_CHIPS.some((chip) => /damage/i.test(chip))).toBe(false);
    expect(REJECT_REASON_OPTIONS.map((option) => option.code)).toEqual(["damaged", "expired", "wrong_item", "not_ordered", "quality"]);
    expect(rejectReasonLabel("expired")).toBe("Expired / short dated");
  });

  it("previews tolerance, invoice variance and hold age thresholds", () => {
    expect(overReceiptAllowance({ ordered: 12, cancelled: 0, accepted: 0, due: 12 }, 10)).toBe(1);
    expect(overReceiptAllowance({ ordered: 12, cancelled: 0, accepted: 0, due: 12 }, 0)).toBe(0);
    expect(invoiceVariance(20_000, 20_000)).toEqual({ difference: 0, flagged: false });
    expect(invoiceVariance(20_100, 20_000)).toEqual({ difference: 100, flagged: false });
    expect(invoiceVariance(21_000, 20_000)).toEqual({ difference: 1_000, flagged: true });
    expect(invoiceVariance(undefined, 20_000)).toBeNull();
    const now = 100 * DAY;
    expect(holdAge(now - 2 * DAY, now)).toMatchObject({ label: "Held 2 d", tone: "neutral" });
    expect(holdAge(now - 4 * DAY, now)).toMatchObject({ label: "Held 4 d", tone: "warning" });
    expect(holdAge(now - 8 * DAY, now)).toMatchObject({ label: "Held 8 d", tone: "danger" });
  });
});

describe("order receipt line builder", () => {
  const detail = {
    overReceiptTolerancePct: 10,
    lines: [{ _id: "ol_1", variantId: "variant_1", ordered: 12, cancelled: 0, accepted: 0, due: 12, item: { productName: "Sunscreen", variantLabel: "50 ml" } }],
  } as unknown as ReceiveOrderDetail;
  const inputs = (accepted: string, rejected = "", code?: "damaged") => ({
    acceptedByLine: { ol_1: accepted }, rejectedByLine: { ol_1: rejected }, rejectReasonByLine: {}, rejectCodeByLine: { ol_1: code },
    selectedHoldByLine: {}, lotCodeByKey: {}, lotExpiryByKey: {}, trackedVariantIds: new Set<Id<"productVariants">>(), eligibleHoldsByLine: new Map(),
  });

  it("accepts an overage inside the tolerance, refuses a larger one and requires a rejection code", () => {
    expect(buildOrderReceiptLines(detail, inputs("13")).lineInputs).toEqual([{ orderLineId: "ol_1", accepted: 13 }]);
    const over = buildOrderReceiptLines(detail, inputs("15"));
    expect(over.errors.ol_1?.accepted).toBe("At most 13 (12 due + 1 tolerance). Hold the excess.");
    expect(over.firstInvalidId).toBe("po-acc-ol_1");
    expect(buildOrderReceiptLines(detail, inputs("2", "1")).errors.ol_1?.rejectReasonCode).toBe("Choose why Sunscreen was rejected.");
    expect(buildOrderReceiptLines(detail, inputs("2", "1", "damaged")).lineInputs)
      .toEqual([{ orderLineId: "ol_1", accepted: 2, rejected: 1, rejectReasonCode: "damaged" }]);
    expect(overReceiptErrors([{ orderLineId: "ol_1", due: 12, allowance: 1 }]).errors.ol_1?.accepted).toContain("12 due + 1 tolerance");
  });
});

describe("receiving sheets and queue", () => {
  let root: Root;
  const render = (node: ReactNode) => act(async () => root.render(createElement(ConfirmProvider, null, node)));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockConvex.query.mockReset().mockImplementation(() => undefined);
    mockConvex.paginated.mockReset().mockImplementation(() => ({ results: [], status: "Exhausted", loadMore: vi.fn() }));
    mockConvex.mutations.clear();
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows an empty correction field and routes damaged goods to the return flow", async () => {
    const onSwitchToReturn = vi.fn();
    await render(createElement(CorrectReceiptLineSheet, { line, onClose: vi.fn(), onDone: vi.fn(), onSwitchToReturn }));
    const qty = document.querySelector<HTMLInputElement>("#gr-corr-qty")!;
    expect(qty.value).toBe("");
    expect(qty.placeholder).toBe("0");
    expect(text()).toContain("Units to remove (max 5)");
    expect(button(/Damaged unit found/)).toBeUndefined();
    await act(async () => button("Return them to the supplier instead")!.click());
    expect(onSwitchToReturn).toHaveBeenCalledOnce();
  });

  it("requires a return outcome and hands it to the caller", async () => {
    const submit = mutation(api.commerce.purchasing.supplierReturn).mockResolvedValue({ id: "adj_1" });
    const onDone = vi.fn();
    await render(createElement(ReturnToSupplierSheet, { line, onClose: vi.fn(), onDone }));
    await act(async () => {
      setInputValue(document.querySelector<HTMLInputElement>("#ret-qty")!, "2");
      setInputValue(document.querySelector<HTMLInputElement>("#ret-reason")!, "Damaged goods");
    });
    const form = document.querySelector("form")!;
    await act(async () => form.requestSubmit());
    expect(text()).toContain("Choose what the supplier will do.");
    expect(submit).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLInputElement>("#ret-outcome-replacement_expected")!.click());
    await act(async () => form.requestSubmit());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, outcome: "replacement_expected", reason: "Damaged goods" }));
    expect(onDone).toHaveBeenCalledWith({ adjustmentId: "adj_1", outcome: "replacement_expected", quantity: 2 });
  });

  it("shows unresolved units, supplier, age and the own-order acceptance path, and filters by receipt reference", async () => {
    const now = Date.now();
    const base = {
      _creationTime: 1, branchId: "branch_1" as Id<"branches">, receiptId: "receipt_1" as Id<"supplierReceipts">,
      variantId: "variant_1" as Id<"productVariants">, item: { productName: "Sunscreen", variantLabel: "50 ml" }, revision: 2,
    };
    const rows: HeldGoodsRow[] = [
      {
        ...base, _id: "hold_1" as Id<"purchaseHolds">, status: "open", receiptReference: "GR-261128-AAAAA",
        orderId: "order_1" as Id<"purchaseOrders">, orderReference: "PO-261128-BBBBB", quantity: 10, acceptedQuantity: 4,
        reason: "Substitute pack", createdAt: now - 5 * DAY, supplierName: "Coastal Supply", unresolved: 6,
        acceptPath: { kind: "own_order", orderId: "order_1" as Id<"purchaseOrders">, orderReference: "PO-261128-BBBBB", status: "partially_received", orderLineId: "ol_1" as Id<"purchaseOrderLines">, due: 4 },
      },
      {
        ...base, _id: "hold_2" as Id<"purchaseHolds">, status: "declined", receiptReference: "GR-261128-CCCCC", quantity: 2,
        acceptedQuantity: 0, reason: "Not ordered", createdAt: now - DAY, resolution: "Sent back", unresolved: 0, acceptPath: null,
        handoff: { carrier: "Kerry Express", returnReference: "RMA-881" },
      },
    ];
    mockConvex.paginated.mockImplementation(() => ({ results: rows, status: "Exhausted", loadMore: vi.fn() }));
    await render(createElement(HeldGoodsPanel, {
      branch: { id: "branch_1" as Id<"branches">, name: "Koh Samui" }, access: { buyer: true, directOrder: true }, status: "open",
      onStatusChange: vi.fn(), detailHref: (path: string) => `/admin/stock/purchasing/${path}`, onCreateLinkedOrder: vi.fn(), onNotice: vi.fn(),
    }));
    expect(text()).toContain("6 unresolved");
    expect(text()).toContain("Coastal Supply");
    expect(text()).not.toContain("0800");
    expect(text()).toContain("Held 5 d");
    expect(button("Accept on PO-261128-BBBBB (4 due)")).toBeDefined();
    // An open hold that its own order can absorb does not push the buyer to a linked order.
    expect(button("Create linked order")).toBeUndefined();
    expect(text()).toContain("Return ref RMA-881");
    expect(text()).toContain("Awaiting pickup");
    expect(button("Record pickup")).toBeDefined();

    await act(async () => setInputValue(document.querySelector<HTMLInputElement>("#hold-receipt-ref")!, " GR-261128-CCCCC "));
    await act(async () => document.querySelector<HTMLFormElement>('form[aria-label="Find held goods"]')!.requestSubmit());
    expect(mockConvex.paginated).toHaveBeenLastCalledWith(
      getFunctionName(api.commerce.purchasing.holds),
      expect.objectContaining({ branchId: "branch_1", status: "open", receiptReference: "GR-261128-CCCCC" }),
    );
  });

  it("accepts a hold onto its own order with the reviewed revision", async () => {
    const accept = mutation(api.commerce.purchasing.acceptHeldGoods).mockResolvedValue({ id: "receipt_2", reference: "GR-261128-DDDDD" });
    mockConvex.query.mockImplementation((name) => (name === getFunctionName(api.commerce.stockExpansion.trackedItems) ? [] : undefined));
    const row = {
      _id: "hold_1" as Id<"purchaseHolds">, _creationTime: 1, branchId: "branch_1" as Id<"branches">, status: "open" as const,
      receiptId: "receipt_1" as Id<"supplierReceipts">, receiptReference: "GR-1", orderId: "order_1" as Id<"purchaseOrders">, orderReference: "PO-1",
      variantId: "variant_1" as Id<"productVariants">, item: { productName: "Sunscreen", variantLabel: "50 ml" }, quantity: 10, acceptedQuantity: 4,
      reason: "Extra", createdAt: Date.now(), revision: 3, unresolved: 6,
      acceptPath: { kind: "own_order" as const, orderId: "order_1" as Id<"purchaseOrders">, orderReference: "PO-1", status: "ordered" as const, orderLineId: "ol_1" as Id<"purchaseOrderLines">, due: 4 },
    };
    mockConvex.paginated.mockImplementation(() => ({ results: [row], status: "Exhausted", loadMore: vi.fn() }));
    const onNotice = vi.fn();
    await render(createElement(HeldGoodsPanel, {
      branch: { id: "branch_1" as Id<"branches">, name: "Koh Samui" }, access: { buyer: true, directOrder: false }, status: "open",
      onStatusChange: vi.fn(), detailHref: (path: string) => path, onCreateLinkedOrder: vi.fn(), onNotice,
    }));
    await act(async () => button("Accept on PO-1 (4 due)")!.click());
    expect(document.querySelector<HTMLInputElement>("#hold-acc-qty")!.value).toBe("4");
    await act(async () => button("Accept into On hand")!.click());
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ holdId: "hold_1", expectedRevision: 3, quantity: 4 }));
    expect(onNotice).toHaveBeenCalledWith("Held goods accepted into On hand on GR-261128-DDDDD.");
  });

  it("opens the prefilled linked replacement order after a 'Replacement expected' return", async () => {
    const submit = mutation(api.commerce.purchasing.supplierReturn).mockResolvedValue({ id: "adj_9", reference: "GR-1" });
    mockConvex.query.mockImplementation((name) => name === getFunctionName(api.commerce.purchasing.receipt) ? {
      receipt: {
        _id: "receipt_1", _creationTime: 1, branchId: "branch_1", reference: "GR-261128-AAAAA", kind: "order", orderId: "order_1",
        orderReference: "PO-1", supplierId: "supplier_1", supplier: { name: "Coastal Supply" }, lineCount: 1, acceptedUnits: 5,
        rejectedUnits: 0, heldUnits: 0, actorLabel: "Dan", createdAt: 1, revision: 1,
      },
      lines: [line], holds: [],
      permissions: { requester: true, approver: true, buyer: true, receiver: true, lead: true, directOrder: true, directReceipt: true },
    } : undefined);
    await render(createElement(SupplierReceiptDetailView, { receiptId: "receipt_1" }));
    await act(async () => button("Return")!.click());
    await act(async () => {
      setInputValue(document.querySelector<HTMLInputElement>("#ret-qty")!, "2");
      setInputValue(document.querySelector<HTMLInputElement>("#ret-reason")!, "Wrong item supplied");
    });
    await act(async () => document.querySelector<HTMLInputElement>("#ret-outcome-replacement_expected")!.click());
    await act(async () => button("Post supplier return")!.click());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "replacement_expected", quantity: 2 }));
    // The linked replacement order sheet opens with the returned item and quantity.
    expect(text()).toContain("Create purchase order · Koh Samui");
    expect(text()).toContain("Sunscreen");
    expect([...document.querySelectorAll<HTMLInputElement>("input")].some((input) => input.value === "2")).toBe(true);
  });

  it.each([
    [{ buyer: true, lead: false }, true],
    [{ buyer: false, lead: false }, false],
  ])("shows receipt cost and invoice variance only to buyers and leads (%o)", async (roles, sees) => {
    const permissions = { requester: false, approver: false, receiver: true, directOrder: false, directReceipt: false, ...roles };
    const uncosted: Partial<typeof line> = { ...line };
    delete uncosted.unitCost;
    mockConvex.query.mockImplementation((name) => name === getFunctionName(api.commerce.purchasing.receipt) ? {
      receipt: {
        _id: "receipt_1", _creationTime: 1, branchId: "branch_1", reference: "GR-261128-AAAAA", kind: "order", orderId: "order_1",
        orderReference: "PO-1", lineCount: 1, acceptedUnits: 5, rejectedUnits: 1, heldUnits: 0, actorLabel: "Dan", createdAt: 1, revision: 1,
        ...(sees ? { invoiceTotal: 26_000, acceptedValue: 25_000 } : {}),
      },
      lines: [sees ? line : uncosted], holds: [], permissions,
    } : undefined);
    await render(createElement(SupplierReceiptDetailView, { receiptId: "receipt_1" }));
    expect(text().includes("Unit cost")).toBe(sees);
    expect(text().includes("Receipt total")).toBe(sees);
    expect(text().includes("Invoice differs from the order price")).toBe(sees);
    expect(text()).toContain("Rejected: Damaged · Crushed");
  });
});
