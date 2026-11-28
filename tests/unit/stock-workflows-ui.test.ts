// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackedLotEditor } from "@/components/checkout/PackedLotEditor";
import { StockBinPanel, type BinRelocation } from "@/components/stock/StockBinPanel";
import { ReturnLotChoice } from "@/components/checkout/ReturnLotChoice";
import { confirmedReturnLots, type Choice } from "@/components/checkout/returns-desk";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { PurchaseRequestDetailView } from "@/components/stock/PurchaseRequestDetailView";
import { PurchaseOrderDetailView } from "@/components/stock/PurchaseOrderDetailView";
import { BranchStockAccessSheet } from "@/components/stock/BranchStockAccessSheet";
import { RequestEditorSheet } from "@/components/stock/PurchasingEditorSheets";
import { purchasingDetailHref, validatePurchasingSearch } from "@/components/stock/purchasing-location";
import { ReceiveDeliverySheet } from "@/components/stock/ReceiveDeliverySheet";
import { MovementInspectSheet } from "@/components/stock/MovementInspectSheet";
import { StockActivityView } from "@/components/stock/StockActivityView";
import { StockAdjustSheet } from "@/components/stock/StockBalanceSheets";
import { StockBalancesView } from "@/components/stock/StockBalancesView";
import { LotDetailPanel } from "@/components/stock/StockLotDetailPanel";
import { StockExpansionView } from "@/components/stock/StockExpansionView";
import {
  createOperationKey,
  formatSatang,
  formatSignedDelta,
  parseOptionalSatang,
  parseStockError,
  parseWholeQuantity,
  sanitizeStockReturnTo,
  STOCK_MAX_LINES,
  STOCK_PAGE_SIZE,
} from "@/components/stock/stock-format";
import { StockLineEditor } from "@/components/stock/StockLineEditor";
import { StockProductsView } from "@/components/stock/StockProductsView";
import { SuppliersManagementPanel } from "@/components/stock/SupplierPicker";
import { StockPurchasingHubView } from "@/components/stock/StockPurchasingHubView";
import { StockSectionShell } from "@/components/stock/StockSectionNav";
import { StockVariantPickerDialog } from "@/components/stock/StockVariantPicker";
import type { StockLineDraft } from "@/components/stock/stock-types";
import { hasDirtyUnsavedGuard } from "@/hooks/use-unsaved-guard";

const mockNav = vi.hoisted(() => ({
  segment: "balances" as string | null,
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const mockBranch = vi.hoisted(() => ({
  current: { id: "branch_1" as Id<"branches">, key: "samui", name: "Koh Samui", slug: "koh-samui", state: "active" as const } as {
    id: Id<"branches">;
    key: string;
    name: string;
    slug: string;
    state: "active";
  } | null,
  extraBranches: [] as { id: Id<"branches">; key: string; name: string; slug: string; state: "active" }[],
  select: vi.fn(),
}));
const mockConvex = vi.hoisted(() => ({
  query: vi.fn<(name: string, args: unknown) => unknown>(() => undefined),
  queries: vi.fn<(requests: Record<string, { query: FunctionReference<"query">; args: unknown }>) => Record<string, unknown>>(() => ({})),
  paginated: vi.fn<(name: string, args: unknown) => { results: unknown[]; status: string; loadMore: () => void }>(() => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  })),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: (ref: FunctionReference<"query">, args: unknown) => Promise.resolve(mockConvex.query(getFunctionName(ref), args)),
  }),
  useQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? undefined : mockConvex.query(getFunctionName(ref), args),
  useQueries: (requests: Record<string, { query: FunctionReference<"query">; args: unknown }>) =>
    mockConvex.queries(requests),
  usePaginatedQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? { results: [], status: "Exhausted", loadMore: vi.fn() } : mockConvex.paginated(getFunctionName(ref), args),
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    let fn = mockConvex.mutations.get(name);
    if (!fn) {
      fn = vi.fn();
      mockConvex.mutations.set(name, fn);
    }
    return fn;
  },
}));

vi.mock("@/platform/navigation", () => ({
  useSelectedLayoutSegment: () => mockNav.segment,
  usePathname: () => `/admin/stock/${mockNav.segment ?? "balances"}`,
  useSearchParams: () => mockNav.searchParams,
  useRouter: () => ({ push: mockNav.push, replace: mockNav.replace }),
}));
vi.mock("@/components/admin/branch/branch-context", () => ({
  useAdminBranch: () => ({
    current: mockBranch.current,
    branches: mockBranch.current ? [mockBranch.current, ...mockBranch.extraBranches.filter((branch) => branch.id !== mockBranch.current?.id)] : [],
    select: mockBranch.select,
  }),
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function wrap(node: ReactNode) {
  return createElement(ConfirmProvider, null, node);
}

function getMutationSpy(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  let fn = mockConvex.mutations.get(name);
  if (!fn) {
    fn = vi.fn();
    mockConvex.mutations.set(name, fn);
  }
  return fn;
}

describe("stock formatting and validation helpers", () => {
  it("round-trips filtered purchasing queues and excludes editor flags and unsafe return targets", () => {
    for (const [search, expected] of [
      ["tab=requests&requestFilter=approved", { tab: "requests", requestFilter: "approved" }],
      ["tab=orders&orderFilter=item&variantId=var_1&allItemOrders=1", { tab: "orders", orderFilter: "item", variantId: "var_1", allItemOrders: "1" }],
      ["tab=receipts&receiptReference=INV-001", { tab: "receipts", receiptReference: "INV-001" }],
    ] as const) {
      const params = new URLSearchParams(`${search}&new=1&variants=var_2&returnTo=https://outside.test`);
      const detail = new URL(purchasingDetailHref("/admin/stock/purchasing/orders/po_1", params), "https://app.test");
      const back = sanitizeStockReturnTo(detail.searchParams.get("returnTo"));
      expect(back).toBe(`/admin/stock/purchasing?${search}`);
      const roundTrip = new URL(back!, detail.origin);
      expect(validatePurchasingSearch(Object.fromEntries(roundTrip.searchParams))).toMatchObject(expected);
    }
    expect(sanitizeStockReturnTo("/admin/stock/%2e%2e/users")).toBeNull();
    expect(sanitizeStockReturnTo(null)).toBeNull();
    expect(validatePurchasingSearch({ tab: "unknown", orderFilter: "unknown" })).toMatchObject({ tab: undefined, orderFilter: undefined });
  });

  it("formats satang money and parses optional THB inputs safely", () => {
    expect(formatSatang(0)).toBe("฿0");
    expect(formatSatang(125000)).toBe("฿1,250");
    expect(formatSatang(125050)).toBe("฿1,250.50");
    expect(formatSatang(undefined)).toBe("—");

    expect(parseOptionalSatang("")).toEqual({ ok: true, value: undefined });
    expect(parseOptionalSatang("450")).toEqual({ ok: true, value: 45000 });
    expect(parseOptionalSatang("1,290.75")).toEqual({ ok: true, value: 129075 });
    expect(parseOptionalSatang("12.345").ok).toBe(false);
    expect(parseOptionalSatang("-10").ok).toBe(false);
  });

  it("validates whole-number quantities with min/max/blank rules", () => {
    expect(parseWholeQuantity("12")).toEqual({ ok: true, value: 12 });
    expect(parseWholeQuantity("0", { allowZero: false }).ok).toBe(false);
    expect(parseWholeQuantity("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(parseWholeQuantity("", { allowBlank: true })).toEqual({ ok: true, value: undefined });
    expect(parseWholeQuantity("5", { max: 3 }).ok).toBe(false);
    expect(parseWholeQuantity("2.5").ok).toBe(false);
  });

  it("formats signed deltas, structured Convex errors, and operation keys", () => {
    expect(formatSignedDelta(5)).toBe("+5");
    expect(formatSignedDelta(-2)).toBe("−2");
    expect(formatSignedDelta(0)).toBe("0");

    const parsed = parseStockError({ data: { code: "STALE", message: "Order changed." } }, "Fallback");
    expect(parsed.message).toBe("Order changed.");
    expect(parsed.payload?.code).toBe("STALE");

    const key = createOperationKey("recv");
    expect(key.startsWith("recv:")).toBe(true);
    expect(key.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Stock UI components and workflow regressions", () => {
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockNav.segment = "balances";
    mockNav.searchParams = new URLSearchParams();
    mockNav.push.mockReset();
    mockNav.replace.mockReset();
    mockBranch.extraBranches = [];
    mockBranch.current = {
      id: "branch_1" as Id<"branches">,
      key: "samui",
      name: "Koh Samui",
      slug: "koh-samui",
      state: "active",
    };
    mockConvex.query.mockReset().mockImplementation(() => undefined);
    mockConvex.queries.mockReset().mockImplementation(() => ({}));
    mockConvex.paginated.mockReset().mockImplementation(() => ({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));
    mockConvex.mutations.clear();
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("blocks stale packing from saving until the cashier reviews the newer revision", async () => {
    const lineId = "packing-row" as Id<"orderLines">;
    const lotA = "lot-a" as Id<"stockLots">;
    const lotB = "lot-b" as Id<"stockLots">;
    const parts = [{ contentKey: "product", label: "Pouch", units: 2, lots: [
      { lotId: lotA, code: "A", quantity: 5 }, { lotId: lotB, code: "B", quantity: 5 },
    ] }];
    const allocation = (lotId: Id<"stockLots">, quantity: number) => ({ lotId, quantity });
    const packing = (a: number, b: number) => [{ contentKey: "product", allocations: [allocation(lotA, a), allocation(lotB, b)] }];
    const save = getMutationSpy(api.pos.orders.savePackedLots).mockResolvedValue(true);
    const render = () => root.render(createElement(PackedLotEditor, { line: { _id: lineId, packing: undefined }, disabled: false }));
    const button = (name: string) => [...document.querySelectorAll("button")].find(item => item.textContent === name)!;
    mockConvex.queries.mockReturnValue({ packing: { revision: 1, packing: packing(2, 0), parts } });
    await act(async () => render());
    await act(async () => button("Confirm packed lots").click());
    const [first] = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await act(async () => setInputValue(first, "1"));

    mockConvex.queries.mockReturnValue({ packing: { revision: 2, packing: packing(0, 2), parts } });
    await act(async () => render());
    expect(button("Save packed lots").disabled).toBe(true);
    await act(async () => button("Save packed lots").click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => button("Refresh and keep my edits").click());
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["1", "2"]);
    const [, second] = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await act(async () => setInputValue(second, "1"));
    await act(async () => button("Save packed lots").click());
    expect(save).toHaveBeenCalledWith({ lineId, expectedRevision: 2, parts: packing(1, 1) });
  });

  it("retries the exact previous bin relocation after a lost response and reopening the panel", async () => {
    const branchId = "branch_1" as Id<"branches">;
    const variantId = "bin-item" as Id<"productVariants">;
    const binId = "bin-a" as Id<"stockBins">;
    mockConvex.query.mockReturnValue({
      onHand: 8, unassigned: 8, bins: [{ id: binId, name: "A", quantity: 0 }], tracking: false, lots: [], recent: [], canManage: true,
    });
    let complete: (result: string) => void = () => {};
    const relocate = getMutationSpy(api.commerce.stock.relocateBinStock)
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }));
    function Host() {
      const [open, setOpen] = useState(true);
      const [pendingRelocation, setPending] = useState<BinRelocation>();
      return open
        ? createElement(StockBinPanel, { branchId, variantId, label: "Pouch", pendingRelocation,
          onPendingRelocation: setPending, onClose: () => setOpen(false) })
        : createElement("button", { onClick: () => setOpen(true) }, "Reopen");
    }
    const button = (name: string) => [...document.querySelectorAll("button")].find(item => item.textContent === name)!;
    await act(async () => root.render(createElement(Host)));
    const [, to] = document.querySelectorAll("select");
    await act(async () => {
      to.value = binId;
      to.dispatchEvent(new Event("change", { bubbles: true }));
      setInputValue(document.querySelector<HTMLInputElement>('input[type="number"]')!, "3");
    });
    await act(async () => button("Relocate stock").click());
    expect(relocate).toHaveBeenCalledTimes(1);
    await act(async () => button("Close").click());
    await act(async () => button("Reopen").click());
    expect(button("Relocate stock")).toBeUndefined();
    await act(async () => button("Retry previous relocation").click());
    expect(button("Close").disabled).toBe(true);
    expect(relocate).toHaveBeenCalledTimes(2);
    expect(relocate.mock.calls[1]).toEqual(relocate.mock.calls[0]);
    await act(async () => complete("success"));
    expect(button("Relocate stock")).toBeDefined();
  });

  it("loads rejection reasons on demand for the selected branch and supplier", async () => {
    const branchId = "branch_1" as Id<"branches">;
    const supplierId = "supplier_1" as Id<"suppliers">;
    const queryName = getFunctionName(api.commerce.purchasing.supplierRejectionSummary);
    mockConvex.paginated.mockReturnValue({
      results: [{ _id: supplierId, name: "Coastal Supply", status: "active" }],
      status: "Exhausted", loadMore: vi.fn(),
    });
    mockConvex.query.mockImplementation(name => name === queryName
      ? { receiptsScanned: 4, byReason: [{ reason: "damaged", units: 3 }, { reason: "uncoded", units: 1 }] }
      : undefined);

    await act(async () => root.render(createElement(SuppliersManagementPanel, { branchId, canEdit: false })));
    expect(mockConvex.query).not.toHaveBeenCalledWith(queryName, expect.anything());
    const open = [...document.querySelectorAll("button")].find(button => button.textContent === "Rejection reasons")!;
    await act(async () => open.click());
    expect(mockConvex.query).toHaveBeenCalledWith(queryName, { branchId, supplierId });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("4 most recent receipts");
    expect(dialog.querySelector("dt")?.textContent).toBe("Damaged");
    expect(dialog.querySelector("dd")?.textContent).toBe("3");
    expect(dialog.textContent).toContain("No reason recorded");
  });

  it.each([
    [{ operationId: "operation_1", reportId: null }, "Linked stock correction posted."],
    [{ operationId: null, reportId: "report_1" }, "Reconciliation report opened in Needs review."],
  ])("replays an ambiguous correction result with the original request", async (result, notice) => {
    const branchId = mockBranch.current!.id;
    const movementId = "movement_1" as Id<"stockMovements">;
    const sourceActivity = getFunctionName(api.commerce.stock.sourceActivity);
    mockConvex.query.mockImplementation(name => name === getFunctionName(api.commerce.stock.getMovement)
      ? { itemLabel: "Lavender oil", kind: "opening", delta: 24, before: 0, after: 24, actorLabel: "Staff",
        createdAt: 1, canCorrect: true, reversibleQuantity: 24, sourceId: "batch_1", reports: [{ _id: "owned", status: "open" }] }
      : undefined);
    mockConvex.paginated.mockImplementation(name => ({
      results: name === sourceActivity ? [
        { _id: movementId, itemLabel: "Lavender oil", delta: 24, before: 0, after: 24 },
        { _id: "movement_2", itemLabel: "Soap", delta: 4, before: 0, after: 4 },
      ] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    mockConvex.queries.mockImplementation(() => ({
      preview: { requiresReconciliation: true, line: { before: 18, after: -6, delta: -24, revision: 2 } },
    }));
    const post = getMutationSpy(api.commerce.stock.postCorrection)
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(result);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const access = { lead: true, read: true } as Parameters<typeof MovementInspectSheet>[0]["access"];
    const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.textContent === label)!;
    await act(async () => root.render(wrap(createElement(MovementInspectSheet, { branchId, movementId, access, reportContext: null, onSuccess, onClose }))));
    const section = document.querySelector('[aria-label="Movements from same source"]');
    expect(section?.previousElementSibling?.contains(button("Correct movement"))).toBe(true);
    await act(async () => button("Correct movement").click());
    await act(async () => button("Use all reversible units").click());
    await act(async () => {
      setInputValue(document.querySelector<HTMLInputElement>("#corr-physical-count")!, "0");
      setInputValue(document.querySelector<HTMLInputElement>("#corr-reason")!, "Wrong opening count");
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    const submit = () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    expect(post).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    mockConvex.queries.mockImplementation(() => ({ preview: new Error("Quantity no longer reversible") }));
    await act(async () => { submit(); });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls[0][0]).toMatchObject({ expectedRevision: 2, physicalCount: 0, confirmNegative: true });
    expect(onSuccess).toHaveBeenCalledWith(notice);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("names approval shortfalls by SKU and focuses the affected draft quantity", async () => {
    const orderId = "order_1";
    const line = (id: string, variantId: string, variantLabel: string, sku: string) => ({
      _id: id, variantId, ordered: 6, accepted: 0, cancelled: 0, corrected: 0, returned: 0, due: 6,
      item: { productName: "Massage Oil", variantLabel, sku },
    });
    mockConvex.query.mockImplementation((name) => name === getFunctionName(api.commerce.purchasing.order) ? {
      order: { _id: orderId, branchId: mockBranch.current?.id, revision: 1, reference: "PO-1", status: "draft", supplierId: "supplier_1", supplier: { name: "Palm" }, requestId: "request_1", dueUnits: 12 },
      lines: [line("line_1", "var_1", "250 ml", "OIL-250"), line("line_2", "var_2", "500 ml", "OIL-500")],
      holds: [],
      permissions: { buyer: true },
      returnsAwaitingCredit: { count: 0, units: 0 },
    } : undefined);
    const issue = getMutationSpy(api.commerce.purchasing.issuePurchaseOrder).mockRejectedValue({
      data: { code: "ALLOCATION_CHANGED", lines: [{ orderLineId: "line_2", available: 4 }] },
    });
    const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
    await act(async () => root.render(wrap(createElement(PurchaseOrderDetailView, { orderId }))));
    await act(async () => button("Issue order")?.click());
    expect(issue).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Requested on this order 6 · Still available 4");
    expect(button("Edit quantity for Massage Oil · 250 ml · OIL-250")).toBeUndefined();
    await act(async () => button("Edit quantity for Massage Oil · 500 ml · OIL-500")?.click());
    expect(document.activeElement?.id).toBe("po-line-qty-var_2");
  });

  it("merges a live variant price into the draft and offers the selected active variant only to receivers", async () => {
    const product = { _id: "prod_1", name: "Massage Oil", status: "active", revision: 5, vatProfile: "standard", variantCount: 2, minPrice: 20000, maxPrice: 40000 };
    const variants = [
      { _id: "var_1", label: "250 ml", sku: "OIL-250", price: 20000, status: "active" },
      { _id: "var_2", label: "500 ml", sku: "OIL-500", price: 40000, status: "active" },
    ];
    let receiver = false;
    mockConvex.query.mockImplementation((name) => {
      if (name === getFunctionName(api.commerce.stock.access)) return { read: true, canManageProducts: true, receiver, directReceipt: receiver };
      if (name === getFunctionName(api.commerce.stock.getProduct)) return { product, variants };
      if (name === getFunctionName(api.commerce.stock.selectedBalances)) {
        return [{
          variantId: "var_2", productName: product.name, label: "500 ml", sku: "OIL-500",
          onHand: 0, onOrder: 0, lotTracked: false,
        }];
      }
      return undefined;
    });
    mockConvex.paginated.mockImplementation((name) => ({
      results: name === getFunctionName(api.commerce.stock.listProducts) ? [product] : [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));
    const save = getMutationSpy(api.commerce.stock.saveProduct).mockResolvedValue(product._id);
    const render = async () => act(async () => root.render(wrap(createElement(StockProductsView))));
    const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
    await render();
    const productRow = () => document.querySelector('button[aria-label="Actions for Massage Oil"]')?.closest("tr");
    expect(productRow()?.querySelectorAll("button, summary")).toHaveLength(2);
    product.status = "archived";
    await render();
    expect(productRow()?.querySelectorAll("button, summary")).toHaveLength(2);
    expect(button("Restore")).toBeDefined();
    product.status = "active";
    await render();
    expect(document.querySelector('button[aria-label="Actions for Massage Oil"]')).not.toBeNull();
    expect(button("Archive")).toBeUndefined();
    expect(button("History")).toBeUndefined();
    await act(async () => button("Massage Oil")?.click());
    expect(document.querySelector('[aria-label="Status for 250 ml · OIL-250, row 1"]')).not.toBeNull();
    expect(document.querySelectorAll('button[aria-expanded="false"]')).not.toHaveLength(0);
    expect(document.body.textContent).toContain("Archive saved variants to preserve their stock and purchase history.");
    const name = document.querySelector<HTMLInputElement>("#prod-name");
    expect(name).not.toBeNull();
    await act(async () => { if (name) setInputValue(name, "Organic Massage Oil"); });
    product.revision = 6;
    variants[0].price = 22000;
    await render();
    expect(document.body.textContent).toContain("250 ml price (THB)Opened 200 · Latest 220 · Your draft 200");
    expect(document.body.textContent).toContain("Your draft Organic Massage Oil");
    await act(async () => button("Apply review")?.click());
    await act(async () => button("Save product")?.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 6, name: "Organic Massage Oil",
      variants: expect.arrayContaining([expect.objectContaining({ variantId: "var_1", price: 22000 })]),
    }));
    expect(document.querySelector('a[href*="receiveVariantId"]')).toBeNull();
    expect(document.querySelector('input[name="saved-receive-variant"]')).toBeNull();
    receiver = true;
    await render();
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="saved-receive-variant"]');
    expect(radios).toHaveLength(2);
    expect(document.querySelector('a[href*="receiveVariantId"]')).toBeNull();
    await act(async () => radios[1].click());
    const href = document.querySelector('a[href*="receiveVariantId"]')?.getAttribute("href");
    expect(href).toBe("/admin/stock/balances?receiveVariantId=var_2");
    mockNav.searchParams = new URLSearchParams(href?.split("?")[1]);
    await act(async () => root.render(wrap(createElement(StockBalancesView))));
    expect(document.querySelector<HTMLInputElement>('input[name="receive-mode"][value="direct"]')?.checked).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("OIL-500");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("OIL-250");
  });

  it("adds three request lines in one picker confirmation and keeps filter picks immediate", async () => {
    const items = ["Oil", "Soap", "Towel"].map((productName, index) => ({
      variantId: `var_${index + 1}`, productName, label: "Standard", onHand: 2, onOrder: 3,
      reorderPoint: index === 0 ? 12 : undefined,
    }));
    mockConvex.paginated.mockImplementation(() => ({ results: items, status: "Exhausted", loadMore: vi.fn() }));
    const branchId = "branch_1" as Id<"branches">;
    await act(async () => root.render(wrap(createElement(RequestEditorSheet, {
      branchId, branchName: "Koh Samui", onClose: vi.fn(), onSaved: vi.fn(),
    }))));
    const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
    await act(async () => button("Add item")?.click());
    expect(mockConvex.paginated).toHaveBeenCalledWith(getFunctionName(api.commerce.stock.listBalances), {
      branchId, includeReorderPoint: true,
    });
    for (const row of document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]')) {
      await act(async () => row.click());
    }
    expect(document.body.textContent).toContain(`Items (0/${STOCK_MAX_LINES})`);
    await act(async () => button("Add 3 items")?.click());
    expect(document.body.textContent).toContain(`Items (3/${STOCK_MAX_LINES})`);
    const quantities = [...document.querySelectorAll<HTMLInputElement>('input[id^="pr-line-qty-"]')];
    expect(quantities.map((input) => input.value)).toEqual(["7", "1", "1"]);
    const hint = document.getElementById(quantities[0].getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Par 12 − on hand 2 − on order 3");

    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    await act(async () => root.render(createElement(StockVariantPickerDialog, { open: true, branchId, onSelect, onOpenChange })));
    const item = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Oil"));
    expect(item?.getAttribute("aria-pressed")).toBeNull();
    await act(async () => item?.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[0]);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);

    const onSelectMany = vi.fn();
    const existing = Array.from({ length: 11 }, (_, index) => `existing-${index}`);
    await act(async () => root.render(createElement(StockVariantPickerDialog, {
      open: true, branchId, onOpenChange, maxLines: 12, selectedIds: existing, onSelectMany,
    })));
    const options = document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]');
    await act(async () => options[0].click());
    expect(options[1].disabled).toBe(true);
    expect(options[2].disabled).toBe(true);

  });

  it("StockLineEditor updates quantities/costs, preserves errors, calculates totals, and removes lines", async () => {
    const onAdd = vi.fn();
    function Harness() {
      const [lines, setLines] = useState<StockLineDraft[]>([
        {
          variantId: "var_1" as Id<"productVariants">,
          productName: "Spa Oil",
          variantLabel: "250 ml",
          sku: "OIL-250",
          onHand: 8,
          quantityText: "4",
          unitCostText: "150",
        },
        {
          variantId: "var_2" as Id<"productVariants">,
          productName: "Bath Robe",
          variantLabel: "Medium",
          sku: "ROBE-M",
          onHand: 3,
          quantityText: "2",
          unitCostText: "500.50",
        },
      ]);
      return createElement(StockLineEditor, {
        lines,
        onChange: setLines,
        showUnitCost: true,
        onAddClick: onAdd,
        lineErrors: { var_1: { quantity: "Exceeds approved quantity" } },
      });
    }

    await act(async () => root.render(createElement(Harness)));

    expect(document.body.textContent).toContain(`Items (2/${STOCK_MAX_LINES})`);
    expect(document.body.textContent).toContain("Exceeds approved quantity");
    expect(document.body.textContent).toContain("฿1,601");

    const removeBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Remove Bath Robe Medium"]');
    expect(removeBtn).toBeTruthy();
    await act(async () => removeBtn!.click());

    expect(document.body.textContent).toContain(`Items (1/${STOCK_MAX_LINES})`);
    expect(document.body.textContent).toContain("฿600");
  });

  it("StockSectionShell leaves branch context to the header and exposes the active page and branch recovery", async () => {
    mockNav.segment = "purchasing";
    await act(async () => root.render(createElement(StockSectionShell, null, "Active stock view")));

    const nav = document.querySelector('nav[aria-label="Stock pages"]');
    expect(nav).toBeTruthy();
    const links = [...nav!.querySelectorAll("a")];
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      "Balances",
      "Activity",
      "Products",
      "Purchasing",
      "Transfers & Lots",
    ]);
    expect(links.find((a) => a.getAttribute("aria-current") === "page")?.textContent?.trim()).toBe("Purchasing");
    expect(document.body.textContent).not.toContain("Koh Samui");
    expect(document.body.textContent).toContain("Active stock view");

    mockBranch.current = null;
    await act(async () => root.render(createElement(StockSectionShell, null, "Should hide")));
    expect(document.body.textContent).toContain("Select a working branch");
    expect(document.body.textContent).not.toContain("Should hide");
  });

  it("routes tracked item Count and Adjust to the branch-authorized lot item", async () => {
    const balance = {
      variantId: "var_1",
      productId: "prod_1",
      productName: "Spa Oil",
      label: "250 ml",
      sku: "OIL-250",
      status: "active",
      price: 15000,
      onHand: 6,
      onOrder: 0,
      revision: 1,
      needsRecount: false,
      lotTracked: true,
      hasBalance: true,
    };
    mockConvex.query.mockImplementation((endpoint, args) => {
      if (endpoint === getFunctionName(api.commerce.stock.access)) {
        return { read: true, lead: true, receiver: true };
      }
      if (endpoint === getFunctionName(api.commerce.stock.selectedBalances)) {
        return (args as { branchId: string }).branchId === "branch_1" ? [balance] : [];
      }
      return undefined;
    });
    mockConvex.paginated.mockImplementation((endpoint) => ({
      results: endpoint === getFunctionName(api.commerce.stock.listBalances) ? [balance] : [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));

    const href = "/admin/stock/expansion?variantId=var_1";
    mockNav.searchParams = new URLSearchParams("countVariantId=var_1");
    await act(async () => root.render(wrap(createElement(StockBalancesView))));
    const rowActions = [...document.querySelectorAll("td a")].map((link) => [
      link.textContent?.trim(),
      link.getAttribute("href"),
    ]);
    expect(rowActions).toEqual([["Open lots", href]]);
    expect(mockNav.replace).toHaveBeenCalledExactlyOnceWith(href);

    mockNav.searchParams = new URLSearchParams("variantId=var_1");
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Lots & expiry");
    expect(document.body.textContent).toContain("Spa Oil · 250 ml (OIL-250) · Koh Samui");
    expect(mockConvex.query).toHaveBeenCalledWith(getFunctionName(api.commerce.stockExpansion.lotBalances), {
      branchId: "branch_1",
      variantId: "var_1",
    });

    mockConvex.query.mockClear();
    mockBranch.current = { id: "branch_2" as Id<"branches">, key: "bkk", name: "Bangkok", slug: "bangkok", state: "active" };
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    expect(document.body.textContent).toContain("Selected item unavailable");
    expect(document.body.textContent).not.toContain("Spa Oil");
    expect(mockConvex.query).not.toHaveBeenCalledWith(
      getFunctionName(api.commerce.stockExpansion.lotBalances),
      expect.anything(),
    );
  });

  it("StockAdjustSheet renders over-on-hand preview error as inline alert without crashing, guards stale revisions, and protects dirty closes", async () => {
    const postOp = getMutationSpy(api.commerce.stock.postOperation).mockResolvedValue("op_1");
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const baseItem = {
      variantId: "var_1" as Id<"productVariants">,
      productId: "prod_1" as Id<"products">,
      productName: "Spa Oil",
      label: "250 ml",
      sku: "OIL-250",
      status: "active" as const,
      price: 15000,
      onHand: 3,
      onOrder: 0,
      revision: 1,
      needsRecount: false,
      lotTracked: false,
      hasBalance: true,
    };

    mockConvex.queries.mockImplementation((requests) => {
      const req = requests.preview;
      if (!req) return {};
      const lines = (req.args as { lines: { quantity: number }[] }).lines;
      if (lines[0].quantity < -3) {
        const err = new Error("Over on hand") as Error & { data?: { code: string; message: string } };
        err.data = { code: "INVALID_STOCK_ADJUSTMENT", message: "Removing 10 exceeds On hand (3)." };
        return { preview: err };
      }
      return {
        preview: {
          lines: [{ variantId: "var_1", before: 3, delta: lines[0].quantity, after: 3 + lines[0].quantity, revision: 1 }],
          requiresReason: false,
        },
      };
    });

    await act(async () =>
      root.render(
        wrap(
          createElement(StockAdjustSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            item: baseItem,
            liveItem: baseItem,
            onClose,
            onSuccess,
          }),
        ),
      ),
    );

    const qtyInput = document.getElementById("adjust-qty") as HTMLInputElement;
    const noteInput = document.getElementById("adjust-note") as HTMLInputElement;
    await act(async () => {
      setInputValue(qtyInput, "10");
      setInputValue(noteInput, "Broken bottle");
    });

    const reason = document.querySelector<HTMLInputElement>('input[name="adjust-reason"][value="damaged"]')!;
    expect(reason.checked).toBe(false);
    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Choose an adjustment reason.");
    await act(async () => reason.click());
    expect(hasDirtyUnsavedGuard()).toBe(true);
    expect(document.body.textContent).toContain("Removing 10 exceeds On hand (3).");
    expect(qtyInput.value).toBe("10");
    expect(noteInput.value).toBe("Broken bottle");

    // Submitting while preview has an error blocks posting without throwing
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).not.toHaveBeenCalled();

    // Live balance revision moves to 2: typed inputs stay intact, stale banner appears, submit blocked until reviewed
    await act(async () => {
      setInputValue(qtyInput, "2");
    });
    const staleItem = { ...baseItem, onHand: 4, revision: 2 };
    mockConvex.queries.mockImplementation(() => ({
      preview: {
        lines: [{ variantId: "var_1", before: 4, delta: -2, after: 2, revision: 2 }],
        requiresReason: false,
      },
    }));
    await act(async () =>
      root.render(
        wrap(
          createElement(StockAdjustSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            item: baseItem,
            liveItem: staleItem,
            onClose,
            onSuccess,
          }),
        ),
      ),
    );
    expect(document.body.textContent).toContain("Stock balance changed while editing");
    expect(qtyInput.value).toBe("2");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).not.toHaveBeenCalled();

    // Dirty cancel shows ConfirmDialog and keeps edits on "Keep editing"
    const cancelBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel");
    await act(async () => cancelBtn!.click());
    expect(document.body.textContent).toContain("Discard unsaved changes?");
    const keepBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Keep editing");
    await act(async () => keepBtn!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(qtyInput.value).toBe("2");

    // Explicit review accepts revision 2 and submits with expectedRevision: 2
    const reviewBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Review updated balance"));
    await act(async () => reviewBtn!.click());
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "adjust",
        lines: [expect.objectContaining({ variantId: "var_1", quantity: -2, expectedRevision: 2 })],
      }),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("resets a linked activity item in one action and removes the old filter on reload", async () => {
    mockNav.searchParams = new URLSearchParams("variantId=var_blue&returnTo=%2Fadmin%2Fstock%2Fbalances");
    mockConvex.query.mockImplementation(name => name === "commerce/stock:access" ? { read: true } : undefined);
    await act(async () => root.render(wrap(createElement(StockActivityView))));
    const reset = [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === "Reset filters")!;
    expect(reset.disabled).toBe(false);
    await act(async () => reset.click());
    expect(reset.isConnected).toBe(false);
    expect(mockNav.replace).toHaveBeenCalledWith("/admin/stock/activity?returnTo=%2Fadmin%2Fstock%2Fbalances");
  });

  it("fills the outstanding transfer quantities and points to a line that exceeds its live cap", async () => {
    const transfer = { _id: "transfer1", state: "inTransit", createdAt: 1, otherBranch: "Samui", reference: "TR-1" };
    const lines = [
      { _id: "robe", productName: "Robe", label: "Blue", quantity: 7, received: 3, lots: [] },
      { _id: "soap", productName: "Soap", label: "Small", quantity: 2, received: 0, lots: [] },
      { _id: "bag", productName: "Bag", label: "Red", quantity: 1, received: 1, lots: [] },
    ];
    mockConvex.query.mockImplementation(name => {
      if (name === "commerce/stock:access") return { read: true, receiver: true };
      if (name === "commerce/stockExpansion:transferDetail") return { transfer, lines, permissions: { receive: true } };
    });
    mockConvex.paginated.mockImplementation(name => ({
      results: name === "commerce/stockExpansion:listTransfers" ? [transfer] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    const click = async (label: string) => {
      const button = [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    const receive = getMutationSpy(api.commerce.stockExpansion.receiveTransfer);
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await click("Open");
    expect(mockNav.replace).toHaveBeenCalledWith("/admin/stock/expansion?transferId=transfer1");
    mockNav.searchParams = new URLSearchParams("transferId=transfer1");
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await click("Fill all remaining");
    const robe = document.querySelector<HTMLInputElement>("#tr-recv-robe")!;
    expect(robe.value).toBe("4");
    expect(document.querySelector<HTMLInputElement>("#tr-recv-soap")?.value).toBe("2");
    expect(document.querySelector("#tr-recv-bag")).toBeNull();
    expect(receive).not.toHaveBeenCalled();
    await act(async () => setInputValue(robe, "5"));
    await click("Post transfer receipt");
    expect(robe.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(robe.getAttribute("aria-describedby")!)?.textContent).toContain("Robe Blue");
    expect(document.activeElement).toBe(robe);
    expect(receive).not.toHaveBeenCalled();
    await click("Fill all remaining");
    lines[0].received = lines[0].quantity;
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await click("Post transfer receipt");
    expect(document.activeElement).toBe(robe);
    expect(document.getElementById(robe.getAttribute("aria-describedby")!)?.textContent).toContain("Already fully received");
    expect(receive).not.toHaveBeenCalled();
    await click("Fill all remaining");
    expect(document.querySelector("#tr-recv-robe")).toBeNull();
    receive.mockRejectedValueOnce(new Error("Connection interrupted"));
    await click("Post transfer receipt");
    transfer.state = "received";
    lines[1].received = lines[1].quantity;
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await click("Verify posted receipt");
    expect(receive.mock.calls[0][0].requestId).toBe(receive.mock.calls[1][0].requestId);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ lines: [
      { lineId: "soap", quantity: 2, allocations: undefined },
    ] }));
  });

  it("replays a recorded shortage with the same request key after a dropped response", async () => {
    mockNav.searchParams = new URLSearchParams("transferId=transfer1");
    const transfer = { _id: "transfer1", state: "inTransit", reference: "TR-1" };
    mockConvex.query.mockImplementation(name => {
      if (name === "commerce/stock:access") return { read: true };
      if (name === "commerce/stockExpansion:transferDetail") return {
        transfer, lines: [{ _id: "line", productName: "Soap", quantity: 3, received: 1, lots: [] }],
        permissions: { closeShort: true },
      };
    });
    const post = getMutationSpy(api.commerce.stockExpansion.closeTransferShort)
      .mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce("event");
    const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await act(async () => button("Close short").click());
    await act(async () => setInputValue(document.querySelector<HTMLInputElement>("#short-reason")!, " Missing box "));
    await act(async () => button("Confirm close short").click());
    transfer.state = "short";
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await act(async () => button("Verify recorded shortage").click());
    expect(post.mock.calls).toHaveLength(2);
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
    expect(post.mock.calls[0]?.[0]).toMatchObject({ reason: "Missing box", reviewed: [{ lineId: "line", quantity: 2 }] });
    expect(button("Verify recorded shortage")).toBeUndefined();
  });

  it("asks before dispatching a reviewed transfer and defaults focus to Cancel", async () => {
    mockNav.searchParams = new URLSearchParams("transferId=transfer1");
    mockConvex.query.mockImplementation(name => {
      if (name === "commerce/stock:access") return { read: true, buyer: true };
      if (name === "commerce/stockExpansion:transferDetail") return {
        transfer: { _id: "transfer1", state: "draft", revision: 2, reference: "TR-1", note: "Driver 42" },
        origin: "Samui", destination: "Phuket",
        lines: [{ _id: "line", productName: "Soap", quantity: 3, received: 0, lots: [] }],
        permissions: { send: true },
      };
    });
    const send = getMutationSpy(api.commerce.stockExpansion.sendTransfer);
    const button = (label: string, scope: ParentNode = document) =>
      [...scope.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    expect(document.body.textContent).toContain("Driver 42");
    await act(async () => button("Send transfer").click());
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Samui → Phuket · 1 line · 3 units");
    expect(document.activeElement).toBe(button("Cancel", dialog));
    await act(async () => button("Cancel", dialog).click());
    expect(send).not.toHaveBeenCalled();
    await act(async () => button("Send transfer").click());
    await act(async () => button("Send transfer", document.querySelector('[role="alertdialog"]')!).click());
    expect(send).toHaveBeenCalledExactlyOnceWith({ transferId: "transfer1", revision: 2 });
  });

  it("discards an open transfer editor when working branch changes", async () => {
    const origin = mockBranch.current!;
    const next = { ...origin, id: "branch_2" as Id<"branches">, name: "Phuket" };
    mockBranch.extraBranches = [origin, next];
    mockConvex.query.mockImplementation(name => name === "commerce/stock:access" ? { read: true, requester: true } : undefined);
    const findButton = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    await act(async () => findButton("New transfer")!.click());
    await act(async () => setInputValue(document.querySelector<HTMLInputElement>("#transfer-note")!, "Driver note for Samui"));
    expect(document.body.textContent).toContain("Sending from Koh Samui");
    expect(hasDirtyUnsavedGuard()).toBe(true);
    mockBranch.current = next;
    await act(async () => root.render(wrap(createElement(StockExpansionView))));
    expect(document.querySelector("#transfer-note")).toBeNull();
    expect(hasDirtyUnsavedGuard()).toBe(false);
    await act(async () => findButton("New transfer")!.click());
    expect(document.body.textContent).toContain("Sending from Phuket");
    expect(document.querySelector<HTMLInputElement>("#transfer-note")?.value).toBe("");
  });

  it("previews signed lot count changes and clears the count before switching to removal", async () => {
    const branchId = mockBranch.current!.id;
    const lot = { lotId: "track-10", code: "Batch", onHand: 10, available: 10, reserved: 0, revision: 1, expired: false, expiresAt: Date.now() + 60_000 };
    mockConvex.query.mockImplementation(name => {
      if (name === "commerce/stockExpansion:lotBalances") return { tracking: true, canAdjust: true, onHand: 10, held: 0, expired: 0, sellable: 10, lots: [lot] };
      if (name === "commerce/stockExpansion:findCountLot") return lot;
      if (name === "commerce/stockExpansion:readLotCountSession") return null;
    });
    const variant = {
      variantId: "variant1" as Id<"productVariants">, productId: "product1" as Id<"products">, productName: "Product",
      label: "Variant", sku: undefined, status: "active" as const, price: 100, onHand: 10, onOrder: 0,
      revision: 0, needsRecount: false, lotTracked: true, hasBalance: true,
    };
    await act(async () => root.render(wrap(createElement(LotDetailPanel, { branchId, variant, onSuccess: vi.fn() }))));
    await act(async () => document.querySelector("summary")!.click());
    await act(async () => document.querySelector<HTMLInputElement>('input[value="count"]')!.click());
    const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
    await act(async () => setInputValue(document.querySelector<HTMLInputElement>("#lot-code-search")!, "Batch"));
    await act(async () => button("Find lot").click());
    await act(async () => button("Count Batch · 10 on hand").click());
    const count = document.querySelector<HTMLInputElement>("#lot-qty")!;
    await act(async () => setInputValue(count, "7"));
    expect(document.body.textContent).toContain("Reviewed on hand 10 · Counted 7 · Adjustment -3");
    await act(async () => setInputValue(count, "10"));
    expect(document.body.textContent).toContain("Reviewed on hand 10 · Counted 10 · Adjustment 0");
    await act(async () => document.querySelector<HTMLInputElement>('input[value="remove"]')!.click());
    expect(document.querySelector<HTMLInputElement>("#lot-qty")?.value).toBe("");
    expect(document.body.textContent).not.toContain("Reviewed on hand 10");
  });

  it("keeps decimal and over-limit return lot input editable while blocking preview", async () => {
    const first = "lot-first" as Id<"stockLots">;
    const second = "lot-second" as Id<"stockLots">;
    const expiresAt = Date.now() + 60_000;
    const options = [{ lotId: first, code: "First", quantity: 2, expiresAt }, { lotId: second, code: "Second", quantity: 3, expiresAt }];
    function ReturnLotTest() {
      const [choice, setChoice] = useState<Choice>({ units: 3, condition: "sellable" });
      return createElement("div", null,
        createElement(ReturnLotChoice, { options, choice, disabled: false, onChange: setChoice }),
        createElement("button", { disabled: confirmedReturnLots(options, choice) === null }, "Preview"),
      );
    }
    await act(async () => root.render(wrap(createElement(ReturnLotTest))));
    const [firstInput, secondInput] = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    const preview = document.querySelector<HTMLButtonElement>("button")!;
    for (const invalid of ["1.5", "3"]) {
      await act(async () => setInputValue(firstInput, invalid));
      expect(firstInput.value).toBe(invalid);
      expect(firstInput.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(firstInput.getAttribute("aria-describedby")!)?.textContent)
        .toContain("Enter a whole number from 0 to 2.");
      expect(preview.disabled).toBe(true);
    }
    await act(async () => setInputValue(firstInput, "1"));
    await act(async () => setInputValue(secondInput, "2"));
    expect(firstInput.hasAttribute("aria-invalid")).toBe(false);
    expect(preview.disabled).toBe(false);
  });

  it("limits the stock grant lookup field to 254 characters, searches by partial name or email, and keeps the match after a role edit", async () => {
    vi.useFakeTimers();
    const email = `${"a".repeat(242)}@example.com`;
    const setGrant = getMutationSpy(api.commerce.stock.setGrant).mockResolvedValue(1);
    const onSaved = vi.fn();
    mockConvex.paginated.mockImplementation((name, args) => ({
      results: name === getFunctionName(api.commerce.stock.listGrants) && (args as { search?: string }).search === email
        ? [{ staffGrantId: "staff_1", email, role: "cashier" }] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    await act(async () => root.render(wrap(createElement(BranchStockAccessSheet, {
      branchId: "branch_1" as Id<"branches">, branchName: "Koh Samui", onClose: vi.fn(), onSaved,
    }))));
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Find staff by name or email"]')!;
    expect(search.maxLength).toBe(254);
    await act(async () => setInputValue(search, email));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(mockConvex.paginated).toHaveBeenLastCalledWith(getFunctionName(api.commerce.stock.listGrants), {
      branchId: "branch_1", search: email,
    });
    const receiver = () => document.querySelector<HTMLInputElement>(`input[aria-label="Receiver / Counter for ${email}"]`);
    expect(receiver()).toBeTruthy();
    await act(async () => receiver()!.click());
    expect(setGrant).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch_1", staffGrantId: "staff_1",
      roles: expect.objectContaining({ receiver: true }) }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(search.value).toBe(email);
    expect(receiver()).toBeTruthy();
  });

  it("StockPurchasingHubView consumes new/variants flags via router.replace and prefills real resolved variants", async () => {
    mockNav.segment = "purchasing";
    mockNav.searchParams = new URLSearchParams("tab=requests&new=1&variants=var_1&returnTo=%2Fadmin%2Fstock%2Fbalances");

    mockConvex.query.mockImplementation((name) => {
      if (name === getFunctionName(api.commerce.stock.access)) {
        return {
          read: true,
          requester: true,
          approver: true,
          buyer: true,
          receiver: true,
          lead: true,
          directOrder: true,
          directReceipt: true,
          canManageGrants: true,
          canManageProducts: true,
          branchName: "Koh Samui",
        };
      }
      if (name === getFunctionName(api.commerce.stock.selectedBalances)) {
        return [
          {
            variantId: "var_1",
            productId: "prod_1",
            productName: "Spa Oil",
            label: "250 ml",
            sku: "OIL-250",
            status: "active",
            price: 15000,
            onHand: 6,
            onOrder: 2,
            reorderPoint: 12,
            reorderPointRevision: 3,
            revision: 3,
            needsRecount: false,
            lotTracked: false,
            hasBalance: true,
          },
        ];
      }
      return undefined;
    });

    await act(async () => root.render(wrap(createElement(StockPurchasingHubView))));

    expect(mockNav.replace).toHaveBeenCalledWith("/admin/stock/purchasing?tab=requests&returnTo=%2Fadmin%2Fstock%2Fbalances");
    expect(document.body.textContent).toContain("Request stock · Koh Samui");
    expect(document.body.textContent).toContain("Spa Oil");
    expect(mockConvex.query).toHaveBeenCalledWith(getFunctionName(api.commerce.stock.selectedBalances), expect.objectContaining({
      branchId: "branch_1", variantIds: ["var_1"], includeReorderPoint: true,
    }));
    expect(document.body.textContent).toContain(`Items (1/${STOCK_MAX_LINES})`);
    const quantity = document.querySelector<HTMLInputElement>("#pr-line-qty-var_1");
    expect(quantity?.value).toBe("4");
    expect(document.getElementById(quantity!.getAttribute("aria-describedby")!)?.textContent)
      .toContain("Par 12 − on hand 6 − on order 2");

    const setPoint = getMutationSpy(api.commerce.stock.setReorderPoint).mockResolvedValue(null);
    const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label);
    await act(async () => button("Reorder point 12 · Edit")!.click());
    const reorderField = document.querySelector<HTMLInputElement>("#reorder-point-var_1")!;
    expect(reorderField.value).toBe("12");
    await act(async () => setInputValue(reorderField, "15"));
    await act(async () => button("Save reorder point")!.click());
    expect(setPoint).toHaveBeenCalledWith({
      branchId: "branch_1", variantId: "var_1", quantity: 15, expectedRevision: 3,
    });
    expect(quantity?.value).toBe("4");
    expect(document.getElementById(quantity!.getAttribute("aria-describedby")!)?.textContent)
      .toContain("Par 15 − on hand 6 − on order 2");
  });

  it("shows the requester note and branch stock context while reviewing an approval", async () => {
    mockConvex.query.mockImplementation((name) => name === getFunctionName(api.commerce.purchasing.request) ? {
      request: {
        _id: "req_1", branchId: "branch_1", status: "awaiting_approval", revision: 1,
        reference: "PR-0001", requesterLabel: "Requester", updatedAt: Date.now(), note: "Use for weekend arrivals",
      },
      permissions: { approver: true },
      orders: [],
      lines: [{
        _id: "line_1", quantity: 20, item: { productName: "Aloe gel", variantLabel: "Standard" },
        context: { onHand: 8, onOrder: 7, otherDemand: 5, lastUnitCost: 1200 },
      }],
    } : undefined);
    await act(async () => root.render(wrap(createElement(PurchaseRequestDetailView, { requestId: "req_1" }))));
    const approve = [...document.querySelectorAll("button")].find((button) => button.textContent === "Approve");
    expect(approve).toBeDefined();
    await act(async () => approve!.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Use for weekend arrivals");
    expect([...dialog!.querySelectorAll("dt")].map((term) => term.textContent))
      .toEqual(["On hand", "On order", "Other open demand", "Last unit cost"]);
    expect([...dialog!.querySelectorAll("dd")].slice(0, 3).map((value) => value.textContent)).toEqual(["8", "7", "5"]);
    expect(dialog?.querySelector<HTMLInputElement>("#appr-qty-line_1")?.value).toBe("20");
  });

  it("renders a near-limit multiline request note and blocks submitting an overdue draft", async () => {
    const submit = getMutationSpy(api.commerce.purchasing.submitRequestForApproval);
    const note = `Weekend arrivals\n${"x".repeat(1_800)}`;
    await act(async () => root.render(wrap(createElement(RequestEditorSheet, {
      branchId: "branch_1" as Id<"branches">,
      branchName: "Koh Samui",
      existing: {
        requestId: "req_1" as Id<"purchaseRequests">,
        revision: 1,
        needBy: "2020-01-01",
        note,
        lines: [{ variantId: "var_1" as Id<"productVariants">, productName: "Aloe gel", variantLabel: "Standard", quantityText: "1" }],
      },
      onClose: vi.fn(),
      onSaved: vi.fn(),
    }))));
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea#pr-note");
    expect(textarea?.value).toBe(note);
    expect(textarea?.maxLength).toBe(2_000);
    expect(document.getElementById("pr-note-count")?.textContent).toContain(`${note.length} / 2000`);
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(submit).not.toHaveBeenCalled();
    expect(document.getElementById("pr-need-by")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("pr-need-by-error")?.textContent).toContain("Choose today or a future date");
  });

  it("RequestEditorSheet preserves saved draft and submit operationKey when Save & submit fails at submit", async () => {
    const saveRequest = getMutationSpy(api.commerce.purchasing.saveRequest).mockResolvedValue({
      id: "req_1",
      revision: 1,
      reference: "PR-0001",
    });
    const submitRequest = getMutationSpy(api.commerce.purchasing.submitRequestForApproval)
      .mockRejectedValueOnce(new Error("Temporary submit failure"))
      .mockResolvedValueOnce({ id: "req_1", revision: 2, reference: "PR-0001" });
    const onSaved = vi.fn();

    await act(async () =>
      root.render(
        wrap(
          createElement(RequestEditorSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            initialLines: [
              {
                variantId: "var_1" as Id<"productVariants">,
                productName: "Spa Oil",
                variantLabel: "250 ml",
                sku: "OIL-250",
                quantityText: "4",
              },
            ],
            onClose: vi.fn(),
            onSaved,
          }),
        ),
      ),
    );

    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(saveRequest).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledTimes(1);
    const firstSubmitKey = submitRequest.mock.calls[0][0].operationKey;
    expect(document.body.textContent).toContain("Draft PR-0001 saved");
    expect(document.body.textContent).toContain("Retry submit for approval");
    expect(onSaved).not.toHaveBeenCalled();

    // Retry submit without editing: does NOT call saveRequest again and reuses exact submit operationKey
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(saveRequest).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledTimes(2);
    expect(submitRequest.mock.calls[1][0]).toEqual({
      requestId: "req_1",
      expectedRevision: 1,
      operationKey: firstSubmitKey,
    });
    expect(onSaved).toHaveBeenCalledWith("req_1");
  });

  it("distinguishes loading from an empty order picker and preserves the receipt draft across pages", async () => {
    const first = { _id: "po_1", reference: "PO-0001", supplier: { name: "Island Supply" }, dueUnits: 4 };
    const second = { ...first, _id: "po_2", reference: "PO-0002" };
    mockConvex.query.mockImplementation((name, args) => {
      if (name !== getFunctionName(api.commerce.purchasing.order)) return undefined;
      const order = (args as { orderId: string }).orderId === first._id ? first : second;
      return {
        order: { ...order, branchId: "branch_1", status: "ordered", revision: 1, issuedRevision: 1 },
        lines: [{
          _id: "pol_1", variantId: "var_1", ordered: 4, due: 4,
          item: { productName: "Spa Oil", variantLabel: "500 ml" },
        }],
        holds: [], acceptableHolds: [], overReceiptTolerancePct: 0, returnsAwaitingCredit: { count: 0, units: 0 },
      };
    });
    const loadMore = vi.fn();
    async function renderPage(status: string, results: typeof first[]) {
      mockConvex.paginated.mockReturnValue({ results, status, loadMore });
      await act(async () => root.render(wrap(createElement(ReceiveDeliverySheet, {
        branchId: "branch_1" as Id<"branches">,
        branchName: "Koh Samui",
        allowDirectReceipt: true,
        onClose: vi.fn(),
        onPosted: vi.fn(),
      }))));
    }
    const button = (label: string) =>
      Array.from(document.querySelectorAll("button")).find(item => item.textContent.includes(label));

    await renderPage("LoadingFirstPage", []);
    expect(document.body.textContent).toContain("Loading open purchase orders");
    expect(document.body.textContent).not.toContain("No open purchase orders");
    await renderPage("Exhausted", []);
    expect(document.body.textContent).toContain("No open purchase orders at Koh Samui.");
    expect(button("Load more orders")).toBeUndefined();

    await renderPage("CanLoadMore", [first]);
    await act(async () => button(first.reference)!.click());
    const referenceInput = () => document.querySelector<HTMLInputElement>("#recv-del-ref")!;
    await act(async () => setInputValue(referenceInput(), "DEL-109"));
    const more = button("Load more orders")!;
    await act(async () => {
      more.focus();
      more.click();
    });
    expect(loadMore).toHaveBeenCalledWith(STOCK_PAGE_SIZE);
    await renderPage("LoadingMore", [first]);
    expect(button("Loading more orders")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => more.click());
    expect(loadMore).toHaveBeenCalledTimes(1);

    await renderPage("Exhausted", [first, second]);
    expect(button("Load more orders")).toBeUndefined();
    expect(button(first.reference)?.getAttribute("aria-pressed")).toBe("true");
    expect(referenceInput().value).toBe("DEL-109");
    expect(document.activeElement).toBe(button(second.reference));
    await act(async () => button(second.reference)!.click());
    expect(button(second.reference)?.getAttribute("aria-pressed")).toBe("true");

    await renderPage("CanLoadMore", [first, second]);
    const nextPage = button("Load more orders")!;
    await act(async () => {
      nextPage.focus();
      nextPage.click();
      referenceInput().focus();
    });
    await renderPage("Exhausted", [first, second, { ...first, _id: "po_3", reference: "PO-0003" }]);
    expect(document.activeElement).toBe(referenceInput());

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const quantityInput = () => document.querySelector<HTMLInputElement>("#po-acc-pol_1")!;
    await act(async () => {
      setInputValue(quantityInput(), "2");
      setInputValue(search, "PO-0099");
    });
    expect(mockConvex.paginated).toHaveBeenLastCalledWith(getFunctionName(api.commerce.purchasing.orders), {
      branchId: "branch_1", view: { kind: "openSearch", search: "PO-0099" },
    });
    await renderPage("Exhausted", [{ ...first, _id: "po_99", reference: "PO-0099" }]);
    expect(button("PO-0099")).toBeDefined();
    expect(referenceInput().value).toBe("DEL-109");
    expect(quantityInput().value).toBe("2");
  });

  it("ReceiveDeliverySheet auto-selects linked replacement holdId and forwards followUp / undercount / OCC retry key", async () => {
    vi.useFakeTimers();
    const receivePO = getMutationSpy(api.commerce.purchasing.receivePurchaseOrder).mockResolvedValue({
      id: "rec_1",
      revision: 1,
      reference: "RCV-0001",
    });
    const onPosted = vi.fn();

    mockConvex.query.mockImplementation((name) => {
      if (name === getFunctionName(api.commerce.purchasing.order)) {
        return {
          order: {
            _id: "po_1",
            branchId: "branch_1",
            reference: "PO-0010",
            status: "ordered",
            revision: 2,
            issuedRevision: 1,
            dueUnits: 4,
            acceptedUnits: 0,
            totalCost: 40000,
            forHoldId: "hold_7",
            supplierId: "sup_1",
            supplier: { name: "Island Supply" },
          },
          lines: [
            {
              _id: "pol_1",
              variantId: "var_actual",
              ordered: 4,
              cancelled: 0,
              accepted: 0,
              corrected: 0,
              returned: 0,
              due: 4,
              unitCost: 10000,
              item: { productName: "Spa Oil", variantLabel: "500 ml", sku: "OIL-500" },
            },
          ],
          holds: [],
          overReceiptTolerancePct: 0,
          returnsAwaitingCredit: { count: 0, units: 0 },
          acceptableHolds: [
            {
              holdId: "hold_7",
              holdRevision: 1,
              orderLineId: "pol_1",
              variantId: "var_actual",
              remaining: 3,
              due: 4,
              link: "replacement",
            },
          ],
          permissions: {
            requester: true,
            approver: true,
            buyer: true,
            receiver: true,
            lead: true,
            directOrder: true,
            directReceipt: true,
          },
          revisions: [],
        };
      }
      return undefined;
    });

    await act(async () =>
      root.render(
        wrap(
          createElement(ReceiveDeliverySheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            initialOrderId: "po_1" as Id<"purchaseOrders">,
            allowDirectReceipt: true,
            followUp: { adjustmentId: "adj_9" as Id<"supplierReceiptAdjustments">, quantity: 3 },
            onClose: vi.fn(),
            onPosted,
          }),
        ),
      ),
    );

    const accInput = document.getElementById("po-acc-pol_1") as HTMLInputElement;
    // Wrong quantity for followUp is rejected before posting
    await act(async () => setInputValue(accInput, "2"));
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(receivePO).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter exactly 3 accepted units");

    // Exact quantity derives actual row's variantId and forwards auto-selected holdId
    await act(async () => setInputValue(accInput, "3"));
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(receivePO).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "po_1",
        expectedIssuedRevision: 1,
        followUp: { adjustmentId: "adj_9", variantId: "var_actual", quantity: 3 },
        lines: [expect.objectContaining({ orderLineId: "pol_1", accepted: 3, holdId: "hold_7" })],
      }),
    );
    expect(onPosted).toHaveBeenCalledWith("rec_1");

    // Direct mode: proactive open PO warning + undercount + OCC retry preserves exact operationKey
    const occError = new Error("OptimisticConcurrencyControlFailure: documents read from or written to changed");
    const receiveDirect = getMutationSpy(api.commerce.purchasing.receiveWithoutOrder)
      .mockRejectedValueOnce(occError)
      .mockRejectedValueOnce(occError)
      .mockRejectedValueOnce(occError)
      .mockResolvedValueOnce({ id: "rec_2", revision: 1, reference: "RCV-0002" });
    mockConvex.queries.mockImplementation((requests) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(requests)) {
        out[key] = {
          page: [
            {
              _id: "po_open",
              reference: "PO-0042",
              supplier: { name: "Island Supply" },
              dueUnits: 6,
            },
          ],
          isDone: true,
          continueCursor: "",
        };
      }
      return out;
    });

    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () =>
      root.render(
        wrap(
          createElement(ReceiveDeliverySheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            initialMode: "direct",
            allowDirectReceipt: true,
            undercount: { receiptId: "rec_orig" as Id<"supplierReceipts"> },
            initialLines: [
              {
                variantId: "var_1" as Id<"productVariants">,
                productName: "Spa Oil",
                variantLabel: "250 ml",
                quantityText: "2",
                unitCostText: "",
              },
            ],
            onClose: vi.fn(),
            onPosted,
          }),
        ),
      ),
    );

    expect(document.body.textContent).toContain("Matching open orders exist");
    expect(document.body.textContent).toContain("PO-0042");

    const reasonInput = document.getElementById("direct-recv-reason") as HTMLInputElement;
    await act(async () => setInputValue(reasonInput, "Undercount catch-up"));

    const directForm = document.querySelector("form")!;
    // Without confirming bypass, direct submit is blocked
    await act(async () => {
      directForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(receiveDirect).not.toHaveBeenCalled();

    // Tick bypass checkbox and submit; OCC fails 3 times inside postStockWithRetry then keeps original opKey
    const bypassBox = document.getElementById("recv-bypass-open-orders") as HTMLInputElement;
    await act(async () => bypassBox.click());

    await act(async () => {
      directForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.runAllTimersAsync();
    });

    expect(receiveDirect).toHaveBeenCalledTimes(3);
    const originalKey = receiveDirect.mock.calls[0][0].operationKey;
    expect(receiveDirect.mock.calls[1][0].operationKey).toBe(originalKey);
    expect(receiveDirect.mock.calls[2][0].operationKey).toBe(originalKey);
    expect(receiveDirect.mock.calls[0][0].undercount).toEqual({ receiptId: "rec_orig" });
    expect(document.body.textContent).toContain("Stock was busy with another update");

    // Manual retry with no inputs changed STILL uses the exact original operationKey
    await act(async () => {
      directForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.runAllTimersAsync();
    });
    expect(receiveDirect).toHaveBeenCalledTimes(4);
    expect(receiveDirect.mock.calls[3][0].operationKey).toBe(originalKey);
    expect(onPosted).toHaveBeenCalledWith("rec_2");
  });
});
