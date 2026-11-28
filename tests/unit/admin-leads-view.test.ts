// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({
  listArgs: [] as unknown[],
  exportQuery: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  results: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.exportQuery }),
  useQuery: () => [{ _id: "villa_1", name: "Villa 3" }],
  useMutation: () => mocks.remove,
  usePaginatedQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    expect(getFunctionName(reference)).toBe("messaging/leads:list");
    mocks.listArgs.push(args);
    return { results: mocks.results, status: "Exhausted", loadMore: () => {} };
  },
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
import { AdminLeadsView } from "@/components/admin/AdminLeadsView";

const lead = { _id: "lead_1", _creationTime: 1, email: "guest@example.com", source: "chat", propertyId: "villa_1", createdAt: Date.UTC(2026, 10, 23, 3, 2) };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.listArgs = [];
  mocks.results = [lead];
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(createElement(AdminLeadsView)));

describe("Leads view", () => {
  it("states the company-wide scope and export cap (D05)", async () => {
    await render();
    expect(host.querySelector('[data-testid="leads-scope"]')?.textContent).toContain("All branches and villas, including leads with no villa");
  });

  it("looks up an exact email and sends the same filter to the CSV export (D39)", async () => {
    mocks.exportQuery.mockResolvedValue({ rows: [], truncated: false, limit: 5000 });
    URL.createObjectURL = vi.fn(() => "blob:x");
    await render();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Email address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " Guest@Example.com ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(mocks.listArgs.at(-1)).toEqual({ email: "guest@example.com" });
    const exportButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Export CSV"))!;
    await act(async () => { exportButton.click(); });
    expect(mocks.exportQuery.mock.calls[0][1]).toEqual({ email: "guest@example.com" });
    expect(host.textContent).toContain("Leads for guest@example.com");
  });

  it("shows phone cards with every field and puts permanent deletion in a row menu (D40, D41)", async () => {
    await render();
    const card = host.querySelector('ul[aria-label="Leads"] li')!;
    expect(card.textContent).toContain("guest@example.com");
    expect(card.textContent).toContain("Chat · Villa 3 ·");
    // No bare trash button: the action is a labelled ⋯ menu trigger.
    expect(host.querySelector('[aria-label="Delete lead guest@example.com"]')).toBeNull();
    expect(card.querySelector('[aria-label="Actions for lead guest@example.com"]')).not.toBeNull();
    expect(host.querySelector("table")?.className).toContain("hidden");
    expect(host.querySelector("table")?.className).not.toContain("min-w-");
  });

  it("asks to confirm a permanent delete from the row menu and keeps the lead on cancel (D40)", async () => {
    await render();
    const press = async (el: Element) => act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    });
    mocks.confirm.mockResolvedValueOnce(false);
    await press(host.querySelector('ul[aria-label="Leads"] [aria-label="Actions for lead guest@example.com"]')!);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === "Delete permanently")!;
    await press(item);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Delete permanently", destructive: true }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
