// @vitest-environment happy-dom
import { act, createElement, type ChangeEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminFactProperty } from "@/components/admin/business-facts-form";

const save = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useMutation: () => save }));
vi.mock("@/components/ui/dialog", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return Object.fromEntries(
    [
      "Dialog",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
    ].map((key) => [key, wrapper]),
  );
});
// Use native controls to exercise form state without Radix's pointer/portal machinery.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        value,
        onChange: (event: ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.currentTarget.value),
      },
      createElement("option", { value: "" }, "Choose"),
      children,
    ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
import { BusinessFactFormDialog } from "@/components/admin/BusinessFactFormDialog";

const target = {
  fromMessage: { question: "Pool hours?", propertySlug: "pool-villa" },
};
const property = (status: string): AdminFactProperty => ({
  _id: "pool" as AdminFactProperty["_id"],
  name: "Pool villa",
  slug: "pool-villa",
  status,
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  save.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(properties: AdminFactProperty[]) {
  await act(async () =>
    root.render(
      createElement(BusinessFactFormDialog, {
        target,
        properties,
        onClose: () => {},
      }),
    ),
  );
}
function scope() {
  return [...host.querySelectorAll("select")].find((select) =>
    select.querySelector('option[value="all"]'),
  )!;
}

it("selects an active chat villa when properties finish loading", async () => {
  await render([]);
  await render([property("active")]);
  expect(scope().value).toBe("pool");
});

it("requires an explicit scope for an inactive chat villa instead of saving a hidden value", async () => {
  await render([property("inactive")]);
  expect(scope().value).toBe("");
  expect(scope().querySelector('option[value="pool"]')).toBeNull();
  expect(host.textContent).toContain("This chat’s villa is inactive");
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(host.textContent).toContain(
    "Choose an active villa or All properties for this fact.",
  );
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    scope().value = "all";
    scope().dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(scope().value).toBe("all");
  expect(host.textContent).not.toContain("This chat’s villa is inactive");
});

it("does not overwrite an explicit All properties choice when the villa arrives later", async () => {
  await render([]);
  await act(async () => {
    scope().value = "all";
    scope().dispatchEvent(new Event("change", { bubbles: true }));
  });
  await render([property("active")]);
  expect(scope().value).toBe("all");
});


it.each([
  { name: "loading", properties: [] },
  { name: "unmatched", properties: [{ ...property("active"), slug: "another-villa" }] },
])(
  "requires an explicit scope while the chat villa is unresolved ($name)",
  async ({ properties }) => {
    await render(properties);
    expect(scope().value).toBe("");
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain("Choose an active villa or All properties for this fact.");
    expect(save).not.toHaveBeenCalled();
  },
);
