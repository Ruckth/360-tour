// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "convex/_generated/api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { StockProductsView } from "@/components/stock/StockProductsView";

const mockConvex = vi.hoisted(() => ({
  query: vi.fn<(name: string) => unknown>(),
  paginated: vi.fn<(name: string) => unknown>(),
  archive: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: async () => ({ onHand: 0, onOrder: 0, openOrders: 0, variantCount: 1 }),
  }),
  useMutation: (ref: FunctionReference<"mutation">) =>
    getFunctionName(ref) === getFunctionName(api.commerce.stock.archiveProduct) ? mockConvex.archive : vi.fn(),
  useQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? undefined : mockConvex.query(getFunctionName(ref)),
  usePaginatedQuery: (ref: FunctionReference<"query">) => mockConvex.paginated(getFunctionName(ref)),
}));

vi.mock("@/components/admin/branch/branch-context", () => ({
  useAdminBranch: () => ({ current: { id: "branch_1", name: "Koh Samui" } }),
}));

describe("Stock product focus", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("returns product sheet focus on Escape and falls back to the selected tab when the row disappears", async () => {
    const product = { _id: "prod_1", name: "Focus Oil", status: "active", revision: 1, vatProfile: "standard", variantCount: 1, minPrice: 100, maxPrice: 100 };
    let visible = true;
    mockConvex.query.mockImplementation(name => {
      if (name === getFunctionName(api.commerce.stock.access)) return { read: true, canManageProducts: true };
      if (name === getFunctionName(api.commerce.stock.getProduct)) return { product, variants: [] };
      return undefined;
    });
    mockConvex.paginated.mockImplementation(name => ({
      results: visible && name === getFunctionName(api.commerce.stock.listProducts) ? [product] : [],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));
    const render = () => act(async () => root.render(createElement(ConfirmProvider, null, createElement(StockProductsView))));
    const button = (name: string) => [...document.querySelectorAll("button")].find(item => item.textContent === name)!;
    const escape = async () => {
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    };
    await render();
    for (const label of ["Focus Oil", "New product"]) {
      const opener = button(label);
      await act(async () => { opener.focus(); opener.click(); });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await escape();
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    }
    const menuButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Actions for Focus Oil"]')!;
    const selectAction = async (label: string) => {
      const menu = menuButton();
      await act(async () => { menu.focus(); menu.click(); });
      const item = await vi.waitFor(() => {
        const match = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry => entry.textContent === label);
        expect(match).toBeDefined();
        return match!;
      });
      await act(async () => item.click());
    };
    await selectAction("History");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await escape();
    await vi.waitFor(() => expect(document.activeElement).toBe(menuButton()));
    await selectAction("Archive");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => button("Cancel").click());
    await vi.waitFor(() => expect(document.activeElement).toBe(menuButton()));
    const opener = button("Focus Oil");
    await act(async () => { opener.focus(); opener.click(); });
    visible = false;
    await render();
    await escape();
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[role="tab"][aria-selected="true"]')));
    visible = true;
    await render();
    mockConvex.archive.mockImplementation(async () => { visible = false; });
    await selectAction("Archive");
    await act(async () => button("Archive product").click());
    await vi.waitFor(() => {
      expect(mockConvex.archive).toHaveBeenCalledOnce();
      expect(menuButton()).toBeNull();
      expect(document.activeElement).toBe(document.querySelector('[role="tab"][aria-selected="true"]'));
    });
  });

});
