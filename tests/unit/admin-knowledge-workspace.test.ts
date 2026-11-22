// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "convex/_generated/dataModel";
import type { AdminUnknownGroup } from "@/components/admin/admin-knowledge-types";
import type { AdminBusinessFact } from "@/components/admin/business-facts-form";

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
  resolve: vi.fn(),
  groups: [] as unknown[],
  facts: [] as unknown[],
}));
vi.mock("@/platform/navigation", () => ({
  useSearchParams: () => mocks.search,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "concierge/knowledge:adminListUnknownGroups"
      ? { groups: mocks.groups, truncated: false }
      : [],
  usePaginatedQuery: () => ({ results: mocks.facts, status: "Exhausted", loadMore: () => {} }),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "concierge/businessFacts:adminResolveUnknownGroups" ? mocks.resolve : vi.fn(),
}));
vi.mock("@/components/admin/BusinessFactFormDialog", () => ({ BusinessFactFormDialog: () => null }));
vi.mock("@/components/admin/BusinessFactsPanel", () => ({
  BusinessFactsPanel: () => createElement("p", { "data-panel": "facts" }),
}));
import { BusinessFactsView } from "@/components/admin/BusinessFactsView";
import { MissingInformationPanel } from "@/components/admin/MissingInformationPanel";

const villa = "villa_1" as Id<"properties">;
const otherVilla = "villa_2" as Id<"properties">;
const QUESTION = "Is breakfast included?";

function fact(id: string, title: string, propertyId?: Id<"properties">): AdminBusinessFact {
  return {
    _id: id as Id<"businessFacts">, title, body: title, searchText: title, source: "test", propertyId,
    status: "approved", revision: 1, createdAt: 1, updatedAt: 1, createdByAdminEmail: "a@x", updatedByAdminEmail: "a@x",
  };
}
function group(propertyId?: Id<"properties">): AdminUnknownGroup {
  return {
    normalizedQuestion: "is breakfast included", count: 1, counts: { new: 1, resolved: 0, ignored: 0 }, latestAt: 1, channels: ["web"],
    latest: {
      _id: "unknown_1" as Id<"chatUnknownQuestions">, propertyId, userQuestion: QUESTION, normalizedQuestion: "is breakfast included",
      status: "new", adminNotified: false, createdAt: 1, updatedAt: 1,
    },
  };
}

let root: Root;
async function render(element: Parameters<Root["render"]>[0]) {
  await act(async () => { root.render(element); });
}
async function press(el: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });
}
async function openResolvePicker() {
  await press(document.querySelector(`[aria-label='Resolve "${QUESTION}" with a fact or source']`)!);
}
const options = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
const STRUCTURED = ["From Business settings", "From Property details", "From Services", "From Pricing & availability"];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.search = new URLSearchParams();
  mocks.groups = [];
  mocks.facts = [];
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ resolved: 1, unknownQuestionIds: [], remaining: 0 });
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("knowledge workspace tabs", () => {
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];

  it("opens on Missing information, followed by Business facts, with no Legacy tab", async () => {
    await render(createElement(BusinessFactsView));
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Missing information", "Business facts"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-panel="facts"]')).toBeNull();
    expect(document.body.textContent).toContain("No new missing-information reports.");
  });

  it.each(["legacy", "nonsense"])("sends an old ?tab=%s link to Missing information", async (tab) => {
    mocks.search = new URLSearchParams(`tab=${tab}`);
    await render(createElement(BusinessFactsView));
    expect(tabs().find((candidate) => candidate.getAttribute("aria-selected") === "true")?.textContent).toBe("Missing information");
  });

  it("shows Business facts for ?tab=facts", async () => {
    mocks.search = new URLSearchParams("tab=facts");
    await render(createElement(BusinessFactsView));
    expect(document.querySelector('[data-panel="facts"]')).not.toBeNull();
  });
});

describe("missing-information resolve picker", () => {
  beforeEach(() => {
    mocks.facts = [fact("f_global", "Breakfast policy"), fact("f_villa", "Villa One breakfast", villa), fact("f_other", "Villa Two breakfast", otherVilla)];
  });

  it("offers global facts, facts for the reported property and every structured source", async () => {
    mocks.groups = [group(villa)];
    await render(createElement(MissingInformationPanel, { properties: [] }));
    await openResolvePicker();
    expect(options()).toEqual(["Breakfast policy", "Villa One breakfast", ...STRUCTURED]);
  });

  it("offers only global facts for a report with no property", async () => {
    mocks.groups = [group()];
    await render(createElement(MissingInformationPanel, { properties: [] }));
    await openResolvePicker();
    expect(options()).toEqual(["Breakfast policy", ...STRUCTURED]);
  });

  it("is never an empty list: structured sources remain with no approved facts", async () => {
    mocks.facts = [];
    mocks.groups = [group(villa)];
    await render(createElement(MissingInformationPanel, { properties: [] }));
    await openResolvePicker();
    expect(options()).toEqual(STRUCTURED);
  });

  it("says so when a search matches nothing", async () => {
    mocks.groups = [group(villa)];
    await render(createElement(MissingInformationPanel, { properties: [] }));
    await openResolvePicker();
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search approved facts and sources"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options()).toEqual([]);
    expect(document.body.textContent).toContain("No matching facts or sources.");
  });

  it("resolves the group with the picked fact", async () => {
    mocks.groups = [group(villa)];
    await render(createElement(MissingInformationPanel, { properties: [] }));
    await openResolvePicker();
    await press([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === "Villa One breakfast")!);
    expect(mocks.resolve).toHaveBeenCalledWith({ normalizedQuestions: ["is breakfast included"], factId: "f_villa" });
  });
});

// Static constraints: a removed endpoint and a layout bug happy-dom cannot measure.
const repoFile = (relative: string) => path.resolve(import.meta.dirname, "../..", relative);
describe("knowledge static constraints", () => {
  it("keeps the retired Fill Thai backfill out of the API and the knowledge UI", () => {
    const generatedApi = readFileSync(repoFile("convex/_generated/api.d.ts"), "utf8");
    expect(generatedApi).not.toContain("adminBackfillThaiGeneratedSuggestions");
    for (const file of ["ChatsView.tsx", "BusinessFactsView.tsx", "BusinessFactsPanel.tsx", "BusinessFactFormDialog.tsx", "MissingInformationPanel.tsx"]) {
      expect(readFileSync(repoFile(`src/components/admin/${file}`), "utf8")).not.toMatch(/Fill Thai|backfill-thai/);
    }
  });

  it("does not size select menus to the trigger height, which hid their options", () => {
    const select = readFileSync(repoFile("src/components/ui/select.tsx"), "utf8");
    expect(select).not.toContain("h-[var(--radix-select-trigger-height)]");
  });
});
