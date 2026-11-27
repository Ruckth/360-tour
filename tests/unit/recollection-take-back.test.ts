// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecollectionTakeBack } from "@/components/checkout/RecollectionTakeBack";

const { adjust, lookup } = vi.hoisted(() => ({
  adjust: vi.fn<(args: unknown) => Promise<{ status: "applied" }>>(),
  lookup: vi.fn<(args: unknown) => void>(),
}));
vi.mock("convex/react", async (original) => ({
  ...await original<object>(),
  useMutation: (ref: FunctionReference<"mutation">) => {
    expect(getFunctionName(ref)).toBe("pos/commands/adjust:adjust");
    return adjust;
  },
  useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) => {
    if (!queries.options) return {};
    expect(getFunctionName(queries.options.query)).toBe("pos/commands/adjust:takeBackLots");
    lookup(queries.options.args);
    return { options: { tracked: true, lots: [
      { lotId: "a", code: "A", quantity: 1, expiresAt: 2_000_000_000_000 },
      { lotId: "b", code: "B", quantity: 1, expiresAt: 2_100_000_000_000 },
    ] } };
  },
}));

type Props = ComponentProps<typeof RecollectionTakeBack>;
const handover = { _id: "handover", revision: 4, contents: [{ contentKey: "oil", unpaid: 2, withGuest: 2 }] } as Props["handover"];
const line = { name: "Massage oil" } as Props["line"];
let root: Root;
let container: HTMLDivElement;
const button = (label: string) => [...document.querySelectorAll("button")].find(button => button.textContent === label)!;
const input = (label: string) => {
  const field = [...document.querySelectorAll("label")].find(field => field.textContent === label)!;
  return document.getElementById(field.htmlFor) as HTMLInputElement;
};
const type = (field: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (label: string) => act(async () => button(label).click());
const render = (disabled = false) => act(async () => root.render(createElement(RecollectionTakeBack, { handover, line, disabled })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  adjust.mockReset().mockResolvedValue({ status: "applied" });
  lookup.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("requires the selected physical lot and retries exactly the same take-back after a lost response", async () => {
  adjust.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await click("Take back items");
  await click("Back to stock");
  expect(lookup).toHaveBeenCalledWith({ handoverId: "handover", contentKey: "oil" });
  await type(input("Reason"), "Guest handed over one bottle");
  expect(button("Record take-back").disabled).toBe(true);
  await type(document.querySelector('[aria-label="Returned units for lot B"]')!, "1");
  await click("Record take-back");
  expect(adjust).toHaveBeenCalledWith(expect.objectContaining({
    target: { targetType: "handover", targetId: "handover" }, kind: "takeBack",
    expectedRevision: 4, reasonCode: "other", reasonText: "Guest handed over one bottle",
    input: { contentKey: "oil", quantity: 1, disposition: "sellable", lotAllocations: [{ lotId: "b", quantity: 1 }] },
  }));
  expect(input("Reason").value).toBe("Guest handed over one bottle");
  await click("Retry take-back");
  expect(adjust.mock.calls[1]).toEqual(adjust.mock.calls[0]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("blocks take-back during payment and records damaged items without a lot lookup", async () => {
  await render(true);
  expect(button("Take back items").disabled).toBe(true);
  await render();
  await click("Take back items");
  await click("Damaged");
  await type(input("Reason"), "Bottle broken");
  await click("Record take-back");
  expect(lookup).not.toHaveBeenCalled();
  expect(adjust.mock.calls[0]?.[0]).toMatchObject({ input: { contentKey: "oil", quantity: 1, disposition: "damaged" } });
});
