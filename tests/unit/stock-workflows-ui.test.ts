// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { RequestEditorSheet } from "@/components/stock/PurchasingEditorSheets";
import { ReceiveDeliverySheet } from "@/components/stock/ReceiveDeliverySheet";
import { StockAdjustSheet } from "@/components/stock/StockBalanceSheets";
import { StockBalancesView } from "@/components/stock/StockBalancesView";
import { StockExpansionView } from "@/components/stock/StockExpansionView";
import {
  createOperationKey,
  formatSatang,
  formatSignedDelta,
  parseOptionalSatang,
  parseStockError,
  parseWholeQuantity,
  STOCK_MAX_LINES,
  STOCK_PAGE_SIZE,
} from "@/components/stock/stock-format";
import { StockLineEditor } from "@/components/stock/StockLineEditor";
import { StockPurchasingHubView } from "@/components/stock/StockPurchasingHubView";
import { StockSectionShell } from "@/components/stock/StockSectionNav";
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
    branches: mockBranch.current ? [mockBranch.current] : [],
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

  it("StockSectionShell renders branch context, active Stock nav link, and missing-branch callout", async () => {
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
    expect(document.body.textContent).toContain("Koh Samui");
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
    expect(rowActions).toEqual(expect.arrayContaining([["Count", href], ["Adjust", href]]));
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
    expect(document.body.textContent).toContain(`Items (1/${STOCK_MAX_LINES})`);
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
    await act(async () => button("Load more orders")!.click());
    expect(loadMore).toHaveBeenCalledWith(STOCK_PAGE_SIZE);
    await renderPage("LoadingMore", [first]);
    expect(button("Loading more orders")?.disabled).toBe(true);

    await renderPage("Exhausted", [first, second]);
    expect(button("Load more orders")).toBeUndefined();
    expect(button(first.reference)?.getAttribute("aria-pressed")).toBe("true");
    expect(referenceInput().value).toBe("DEL-109");
    await act(async () => button(second.reference)!.click());
    expect(button(second.reference)?.getAttribute("aria-pressed")).toBe("true");
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
