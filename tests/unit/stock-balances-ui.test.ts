// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { BranchStockAccessSheet } from "@/components/stock/BranchStockAccessSheet";
import { OpeningStockSheet } from "@/components/stock/OpeningStockSheet";
import { StockAdjustSheet, StockCountSheet } from "@/components/stock/StockBalanceSheets";
import { StockBalancesView } from "@/components/stock/StockBalancesView";
import { StockCountMode } from "@/components/stock/StockCountMode";
import { balanceStatusBadges } from "@/components/stock/stock-format";
import { ReasonField } from "@/components/ui/reason-field";

const mockNav = vi.hoisted(() => ({
  segment: "balances" as string | null,
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const mockBranch = vi.hoisted(() => ({
  current: { id: "branch_1" as Id<"branches">, key: "samui", name: "Koh Samui", slug: "koh-samui", state: "active" as const },
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
  usePathname: () => "/admin/stock/balances",
  useSearchParams: () => mockNav.searchParams,
  useRouter: () => ({ push: mockNav.push, replace: mockNav.replace }),
}));
vi.mock("@/components/admin/branch/branch-context", () => ({
  useAdminBranch: () => ({
    current: mockBranch.current,
    branches: [mockBranch.current],
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

function makeRow(overrides: Partial<{
  variantId: Id<"productVariants">;
  productName: string;
  label: string;
  sku: string;
  onHand: number;
  onOrder: number;
  revision: number;
  needsRecount: boolean;
  hasBalance: boolean;
  lotTracked: boolean;
}> = {}) {
  return {
    variantId: ("var_1" as Id<"productVariants">),
    productId: ("prod_1" as Id<"products">),
    productName: "Aloe after-sun gel",
    label: "120 mL",
    sku: "SPA-ALOE-120",
    status: "active" as const,
    price: 31000,
    onHand: 8,
    onOrder: 0,
    revision: 1,
    needsRecount: false,
    hasBalance: true,
    lotTracked: false,
    ...overrides,
  };
}

describe("Balances, counts, adjustments, opening & access improvements (S01-S24)", () => {
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => { store.set(key, String(val)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    });
    mockNav.searchParams = new URLSearchParams();
    mockNav.push.mockReset();
    mockNav.replace.mockReset();
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
  });

  it("derives attention-only balance badges with no Tracked badge (S03)", () => {
    expect(balanceStatusBadges({ hasBalance: true, onHand: 8, needsRecount: false })).toEqual([]);
    expect(balanceStatusBadges({ hasBalance: true, onHand: 0, needsRecount: false })).toEqual([{ label: "Out", tone: "danger" }]);
    expect(balanceStatusBadges({ hasBalance: true, onHand: -2, needsRecount: true })).toEqual([
      { label: "Needs recount", tone: "warning" },
      { label: "Negative", tone: "danger" },
    ]);
    expect(balanceStatusBadges({ hasBalance: false, onHand: 0, needsRecount: false })).toEqual([{ label: "Never stocked", tone: "neutral" }]);
  });

  it("renders Record opening stock on never-stocked rows, Open lots once on lot-tracked rows, incoming chip/em-dash, recount count & positive empty state, and header vs bulk scoping (S01-S07, S10, S20)", async () => {
    const rows = [
      makeRow({ variantId: "var_open" as Id<"productVariants">, productName: "Aloe travel", label: "60 mL", sku: "SPA-ALOE-060", onHand: 0, hasBalance: false }),
      makeRow({ variantId: "var_lot" as Id<"productVariants">, productName: "Lemongrass oil", label: "250 mL", sku: "SPA-OIL-250", onHand: 12, onOrder: 7, hasBalance: true, lotTracked: true }),
      makeRow({ variantId: "var_out" as Id<"productVariants">, productName: "Sea balm", label: "50 g", sku: "SPA-BALM-50", onHand: 0, onOrder: 0, hasBalance: true }),
    ];
    mockConvex.query.mockImplementation((name) => {
      if (name === getFunctionName(api.commerce.stock.access)) {
        return {
          read: true, requester: true, approver: true, buyer: true, receiver: true, lead: true,
          directOrder: true, directReceipt: true, canManageGrants: true, canManageProducts: true,
          branchName: "Koh Samui", recountCount: 3, openReportCount: 0, lastVerifiedCountAt: null,
        };
      }
      return undefined;
    });
    mockConvex.paginated.mockImplementation((name, args) => ({
      results: name === getFunctionName(api.commerce.stock.listBalances) && !(args as { recountOnly?: boolean }).recountOnly ? rows : [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));

    await act(async () => root.render(wrap(createElement(StockBalancesView))));

    // S05: Needs recount tab shows warning count pill "3"
    const recountTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.includes("Needs recount"));
    expect(recountTab?.textContent).toContain("3");

    // S03: No "Tracked" badge anywhere; "Out" badge shown for 0 onHand with balance
    expect(document.body.textContent).not.toContain("Tracked");
    expect(document.body.textContent).toContain("Out");

    // S10: +7 incoming chip with accessible label and em-dash for 0
    const incomingLink = document.querySelector<HTMLAnchorElement>('a[aria-label="7 units on open orders"]');
    expect(incomingLink?.textContent).toContain("+7 incoming");
    expect(document.querySelector('[aria-label="No units on open orders"]')?.textContent).toBe("—");

    const tableRows = [...document.querySelectorAll("tbody tr")];
    // S01: Never stocked row shows Record opening stock as its only visible action button
    const neverStockedButtons = [...tableRows[0].querySelectorAll("button")].filter((b) => !b.getAttribute("aria-label")?.startsWith("More actions"));
    expect(neverStockedButtons.map((b) => b.textContent?.trim())).toEqual(["Record opening stock"]);

    // S02: Lot-tracked row shows one "Open lots" link and no Adjust link
    const lotLinks = [...tableRows[1].querySelectorAll("td:last-child a")].map((a) => a.textContent?.trim());
    expect(lotLinks).toEqual(["Open lots"]);

    // S06 + S20: Select never-stocked row -> BulkActionBar shows Receive 1, Request 1, Record opening stock (1); header Receive still opens empty form
    const checkbox = tableRows[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar.textContent).toContain("Receive 1");
    expect(toolbar.textContent).toContain("Request 1");
    expect(toolbar.textContent).toContain("Record opening stock (1)");

    const headerReceive = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Receive")!;
    await act(async () => headerReceive.click());
    expect(mockNav.push).toHaveBeenCalledWith(expect.not.stringContaining("variants="));

    // S07: Empty recount view shows positive branch confirmation and no false last-count time
    await act(async () => (recountTab as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("0 items need a recount at Koh Samui");
    expect(document.body.textContent).not.toContain("Last verified count");
    expect(document.body.textContent).not.toContain("Post a verified count to clear the flag");
  });

  it("supports StockCountSheet compact grid (>3 items), blind count, variance badges, stable reason field, and pinned stale baseline (S11-S16)", async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeRow({ variantId: `var_${i + 1}` as Id<"productVariants">, productName: `Item ${i + 1}`, onHand: 8, revision: 1 }),
    );
    const liveChanged = [
      { ...items[0], onHand: 7, revision: 2 },
      ...items.slice(1),
    ];

    await act(async () =>
      root.render(
        wrap(
          createElement(StockCountSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            items,
            liveItems: liveChanged,
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          }),
        ),
      ),
    );

    // S11: Compact table rendered for >3 items
    expect(document.querySelector("table")).not.toBeNull();
    // S14: Reason field always present before typing, initially optional
    const reasonInput = document.getElementById("count-reason") as HTMLInputElement;
    expect(reasonInput).not.toBeNull();
    expect(reasonInput.required).toBe(false);

    // S16: Stale banner button names the new balance (7) and baseline stays pinned at 8 until accepted
    const staleBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Use new balance (7)"));
    expect(staleBtn).toBeDefined();

    const firstInput = document.getElementById("count-qty-var_1") as HTMLInputElement;
    await act(async () => setInputValue(firstInput, "8"));
    // Before accepting: 8 against pinned 8 -> Matches!
    expect(document.body.textContent).toContain("Matches");
    expect(document.body.textContent).toContain("live: 7");

    // Enter moves focus to next row (S11)
    await act(async () => {
      firstInput.focus();
      firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.activeElement?.id).toBe("count-qty-var_2");

    // Accept updated balance -> baseline updates to 7, live marker disappears, variance becomes +1 and reason becomes required!
    await act(async () => staleBtn!.click());
    expect(document.body.textContent).not.toContain("live: 7");
    expect(document.body.textContent).toContain("+1");
    expect(reasonInput.required).toBe(true);

    // S12: Toggle Blind count hides Expected on unentered rows and persists
    const blindBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Blind count"))!;
    await act(async () => blindBtn.click());
    expect(window.localStorage.getItem("stock:blind-count-pref")).toBe("true");
    expect(document.querySelector('[aria-label="Hidden in blind count"]')).not.toBeNull();
  });

  it("shows selected ReasonField chip with check icon and inverted contrast style (S15)", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ReasonField, {
          id: "rf-test",
          value: "Shelf recount",
          onChange,
          chips: ["Shelf recount", "Display sample"],
        }),
      ),
    );
    const pressed = document.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!;
    expect(pressed.textContent).toContain("Shelf recount");
    expect(pressed.className).toContain("bg-foreground");
    expect(pressed.querySelector("svg")).not.toBeNull();
  });

  it("shows immediate Adjust preview before choosing a reason (S17, S18)", async () => {
    await act(async () =>
      root.render(
        wrap(
          createElement(StockAdjustSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            item: makeRow({ onHand: 8 }),
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          }),
        ),
      ),
    );
    const qtyInput = document.getElementById("adjust-qty") as HTMLInputElement;
    await act(async () => setInputValue(qtyInput, "1"));
    expect(document.body.textContent).toContain("8 →");
    expect(document.body.textContent).toContain("7");
    expect(document.body.textContent).toContain("−1");
  });

  it("renders OpeningStockSheet single dialog with 0→16 preview + unit cost and bulk multi-line post (S19, S20)", async () => {
    const postOp = getMutationSpy(api.commerce.stock.postOperation).mockResolvedValue("op_open");
    const item1 = makeRow({ variantId: "var_a" as Id<"productVariants">, productName: "Item A", hasBalance: false, onHand: 0 });
    const item2 = makeRow({ variantId: "var_b" as Id<"productVariants">, productName: "Item B", hasBalance: false, onHand: 0 });

    // Single item dialog (S19)
    await act(async () =>
      root.render(
        wrap(
          createElement(OpeningStockSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            items: [item1],
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          }),
        ),
      ),
    );
    expect(document.body.textContent).toContain("Never stocked at Koh Samui");
    const qty = document.getElementById("opening-qty") as HTMLInputElement;
    const cost = document.getElementById("opening-cost") as HTMLInputElement;
    await act(async () => {
      setInputValue(qty, "16");
      setInputValue(cost, "125");
    });
    expect(document.body.textContent).toContain("0 → 16");
    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).toHaveBeenCalledWith(expect.objectContaining({
      kind: "opening",
      lines: [expect.objectContaining({ variantId: "var_a", quantity: 16, unitCost: 12500 })],
    }));

    // Bulk mode (S20)
    postOp.mockClear();
    await act(async () =>
      root.render(
        wrap(
          createElement(OpeningStockSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            items: [item1, item2],
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () => {
      setInputValue(document.getElementById("opening-qty-var_a") as HTMLInputElement, "10");
      setInputValue(document.getElementById("opening-qty-var_b") as HTMLInputElement, "5");
    });
    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postOp).toHaveBeenCalledWith(expect.objectContaining({
      kind: "opening",
      lines: [
        expect.objectContaining({ variantId: "var_a", quantity: 10 }),
        expect.objectContaining({ variantId: "var_b", quantity: 5 }),
      ],
    }));
  });

  it("steps through items one-by-one in mobile StockCountMode and shows variance summary (S08)", async () => {
    const items = [
      makeRow({ variantId: "var_1" as Id<"productVariants">, productName: "Gel 120mL", onHand: 8 }),
      makeRow({ variantId: "var_2" as Id<"productVariants">, productName: "Balm 50g", onHand: 4 }),
    ];
    await act(async () =>
      root.render(
        wrap(
          createElement(StockCountMode, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            items,
            liveItems: items,
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          }),
        ),
      ),
    );
    expect(document.body.textContent).toContain("Count mode · 1 of 2");
    expect(document.body.textContent).toContain("Gel 120mL");
    const input = document.getElementById("count-mode-input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "7");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("Count mode · 2 of 2");
    expect(document.body.textContent).toContain("Balm 50g");
    const input2 = document.getElementById("count-mode-input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input2, "4");
      input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("Count summary");
    expect(document.body.textContent).toContain("−1");
    expect(document.body.textContent).toContain("Matches");
  });

  it("confirms before enabling direct policies and keeps sibling checkboxes enabled while saving one role (S21-S24)", async () => {
    let resolveGrant!: (v: number) => void;
    const setGrant = getMutationSpy(api.commerce.stock.setGrant).mockImplementation(
      () => new Promise<number>((resolve) => { resolveGrant = resolve; }),
    );
    const setPolicy = getMutationSpy(api.commerce.stock.setBranchPolicy).mockResolvedValue(1);
    mockConvex.query.mockImplementation((name) =>
      name === getFunctionName(api.commerce.stock.branchPolicy)
        ? { directOrder: false, directReceipt: false, revision: 0 }
        : undefined,
    );
    mockConvex.paginated.mockImplementation((name) => ({
      results: name === getFunctionName(api.commerce.stock.listGrants)
        ? [{ staffGrantId: "staff_1", email: "cashier@example.com", name: "Nadia", role: "cashier" }]
        : [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));

    await act(async () =>
      root.render(
        wrap(
          createElement(BranchStockAccessSheet, {
            branchId: "branch_1" as Id<"branches">,
            branchName: "Koh Samui",
            onClose: vi.fn(),
            onSaved: vi.fn(),
          }),
        ),
      ),
    );

    // S22: Matrix headers have keyboard-reachable role descriptions (InfoTip buttons)
    expect(document.querySelector('button[aria-label="About Approver"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="About Stock lead"]')).not.toBeNull();

    // S23: Enabling direct policy opens a confirm dialog before calling mutation
    const directOrderBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0];
    await act(async () => directOrderBox.click());
    expect(setPolicy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enable direct purchase orders?");
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Enable direct orders")!;
    await act(async () => confirmBtn.click());
    expect(setPolicy).toHaveBeenCalledTimes(1);

    // S23: Toggling one role disables ONLY that checkbox, leaving sibling roles enabled
    const requesterBox = document.querySelector<HTMLInputElement>('input[aria-label="Requester for cashier@example.com"]')!;
    const buyerBox = document.querySelector<HTMLInputElement>('input[aria-label="Buyer for cashier@example.com"]')!;
    await act(async () => requesterBox.click());
    expect(setGrant).toHaveBeenCalledTimes(1);
    expect(requesterBox.disabled).toBe(true);
    expect(buyerBox.disabled).toBe(false);
    await act(async () => { resolveGrant(1); });
    expect(requesterBox.disabled).toBe(false);
    expect(document.body.textContent).toContain("Saved");
  });
});
