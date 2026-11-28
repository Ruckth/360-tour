// @vitest-environment happy-dom
import { act, createElement, type ChangeEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";

const save = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useMutation: () => save }));
vi.mock("@/components/ui/dialog", () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement("div", null, children);
  return Object.fromEntries(
    ["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map((key) => [key, wrapper]),
  );
});
// Native selects, so the test can see which controls render without the portal machinery.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) =>
    createElement("select", { value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.currentTarget.value) }, children),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
import { BusinessFactFormDialog, type FactFormTarget } from "@/components/admin/BusinessFactFormDialog";

const unknownQuestionId = "question-1" as Id<"chatUnknownQuestions">;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  save.mockReset();
  save.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(target: FactFormTarget, onClose = vi.fn()) {
  await act(async () => root.render(createElement(BusinessFactFormDialog, { target, properties: [], onClose })));
  return onClose;
}
async function type(id: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const statusSelect = () => [...host.querySelectorAll("select")].find((select) => select.querySelector('option[value="draft"]'));

it("saves a fact from a question as approved on the first try, with no Status control", async () => {
  const onClose = await render({ fromUnknown: { unknownQuestionId, question: "Is breakfast included?" } });
  expect(statusSelect()).toBeUndefined();
  expect(host.querySelector('label[for="fact-status"]')).toBeNull();

  await type("fact-body", "Breakfast is included for all villa stays.");
  await type("fact-search-text", "breakfast");
  await type("fact-source", "Owner email");
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ unknownQuestionId, title: "Is breakfast included?", status: "approved" });
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps Status, starting at Draft, for a fact that isn't from a question", async () => {
  await render({});
  expect(statusSelect()?.value).toBe("draft");
});

it("keeps the full guest question read-only beside the answer while the title is edited (F16)", async () => {
  const question = `${"Could you tell me whether breakfast is included ".repeat(5)}for a family of five?`;
  await render({ fromUnknown: { unknownQuestionId, question } });
  const quote = host.querySelector('blockquote[aria-labelledby="fact-guest-question-label"]')!;
  expect(quote.textContent).toBe(question);
  expect(question.length).toBeGreaterThan(160);
  // The quote sits directly with the answer field, not in the footer.
  expect(quote.closest("div.grid")?.querySelector("#fact-body")).not.toBeNull();
  await type("fact-title", "Breakfast");
  expect(quote.textContent).toBe(question);
});
