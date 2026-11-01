// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { mergeSiteSettings } from "convex/lib/siteSettings";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigurationHistoryRecords, RecordHistoryPanel } from "@/components/admin/RecordHistoryPanel";
import { AdminSettingsView } from "@/components/admin/AdminSettingsView";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  history: [] as unknown[],
  records: [] as unknown[],
  status: "Exhausted",
  loadMore: vi.fn(),
  update: vi.fn(),
  restore: vi.fn(),
  pageCalls: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => (getFunctionName(ref) === "settings:get" ? state.settings : undefined),
  useMutation: (ref: FunctionReference<"mutation">) => (getFunctionName(ref) === "settings:restore" ? state.restore : state.update),
  usePaginatedQuery: (ref: FunctionReference<"query">, args: unknown) => {
    state.pageCalls(getFunctionName(ref), args);
    return { results: getFunctionName(ref) === "configurationHistory:records" ? state.records : state.history, status: state.status, loadMore: state.loadMore };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/admin/SetupChecklist", () => ({ SetupChecklistCard: () => null }));
vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: ({
    id,
    name,
    value,
    disabled,
    onValueChange,
  }: {
    id: string;
    name: string;
    value: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  }) => createElement("input", { id, name, value, disabled, onChange: (event: { target: { value: string } }) => onValueChange(event.target.value) }),
}));
const event: Doc<"recordChanges"> = {
  _id: "history1" as Id<"recordChanges">,
  _creationTime: 0,
  entityType: "settings",
  entityId: "default",
  recordedAt: Date.parse("2026-11-01T03:00:00Z"),
  effectiveAt: Date.parse("2026-10-31T17:00:00Z"),
  actor: "admin@example.com",
  kind: "updated",
  before: { businessName: "Earlier name", accessToken: "never-show-this" },
  after: { businessName: "Current name", accessToken: "never-show-this-either" },
};
let root: Root;
const render = (node: ReactNode) => act(async () => root.render(node));
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text)!;
const click = (text: string) => act(async () => button(text).click());
const input = () => document.querySelector<HTMLInputElement>("#settings-business-businessName")!;
const change = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.settings = { ...mergeSiteSettings(null), revision: 4 };
  state.history = [event];
  state.records = [];
  state.status = "Exhausted";
  state.loadMore.mockReset();
  state.update.mockReset().mockResolvedValue(null);
  state.restore.mockReset();
  state.pageCalls.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("renders readable selected changes, actor/effective time and cursor pagination, excluding unknown secret fields", async () => {
  state.status = "CanLoadMore";
  await render(createElement(RecordHistoryPanel, { entityType: "settings", entityId: "default" }));
  expect(document.body.textContent).toContain("Business name");
  expect(document.body.textContent).toContain("Earlier name");
  expect(document.body.textContent).toContain("Current name");
  expect(document.body.textContent).toContain("admin@example.com");
  expect(document.body.textContent).toContain("Bangkok");
  expect(document.body.textContent).toContain("History begins");
  expect(document.body.textContent).not.toContain("accessToken");
  expect(document.body.textContent).not.toContain("never-show");
  await click("Load older changes");
  expect(state.loadMore).toHaveBeenCalledWith(10);
});
it("renders deleted time off as readable dates and allows discovering its history without a current record", async () => {
  const start = Date.parse("2026-10-31T02:00:00Z");
  state.history = [{ ...event, entityType: "timeOff", entityId: "removed-off", kind: "removed",
    before: { staffId: "staff1", label: "Sick leave", start, end: start + 3600000 }, after: null }];
  await render(createElement(RecordHistoryPanel, { entityType: "timeOff", title: "All staff time off history" }));
  expect(state.pageCalls).toHaveBeenCalledWith("recordHistory:list", { entityType: "timeOff", entityId: undefined });
  expect(document.body.textContent).toContain("Removed");
  expect(document.body.textContent).toContain("Sick leave");
  expect(document.body.textContent).toContain("31/10/2026, 09:00:00 (Bangkok)");
  expect(document.body.textContent).not.toContain(String(start));
});
it("disables applying history while a draft is dirty and retains that draft after a failed save", async () => {
  state.update.mockRejectedValue(new Error("Settings changed. Review the latest configuration and try again."));
  await render(createElement(AdminSettingsView));
  await change("Unsaved draft");
  expect(button("Apply before this change").disabled).toBe(true);
  await click("Save business profile");
  expect(state.update).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 4, business: expect.objectContaining({ businessName: "Unsaved draft" }) }),
  );
  expect(input().value).toBe("Unsaved draft");
  expect(document.body.textContent).toContain("Settings changed");
  expect(button("Apply before this change").disabled).toBe(true);
});
it("applies history with the live revision, prevents duplicate pending writes and reports a rejected restore", async () => {
  let reject!: (error: Error) => void;
  state.restore.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await render(createElement(AdminSettingsView));
  await click("Apply before this change");
  expect(state.restore).toHaveBeenCalledWith({ historyId: event._id, expectedRevision: 4, side: "before" });
  expect(button("Apply before this change").disabled).toBe(true);
  expect(button("Save business profile").disabled).toBe(true);
  expect(input().disabled).toBe(true);
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Settings changed. Review and try again.")));
  expect(document.body.textContent).toContain("Settings changed");
  expect(input().disabled).toBe(false);
  expect(state.restore).toHaveBeenCalledTimes(1);
});
it("refreshes the edited fields from a successful restoration without overwriting excluded instructions", async () => {
  state.restore.mockResolvedValue({
    ...mergeSiteSettings(null),
    businessName: "Restored name",
    ai: { tone: "Calm", maxWords: 80, extraInstructions: "retained on server" },
    revision: 5,
  });
  await render(createElement(AdminSettingsView));
  await click("Apply after this change");
  expect(input().value).toBe("Restored name");
  expect(document.body.textContent).toContain("Saved");
  expect(button("Apply before this change").disabled).toBe(false);
});
it("discovers a deleted room and only subscribes to its history when the disclosure opens", async () => {
  state.records = [{ _id: "idx", entityType: "room", entityId: "room1", name: "Removed pool", slug: "pool", deleted: true }];
  state.history = [{ ...event, entityType: "room", entityId: "room1", kind: "deleted", before: { name: "Removed pool", imagePath: "/pool.jpg" }, after: null }];
  await render(createElement(ConfigurationHistoryRecords, { propertyId: "property1" as Id<"properties"> }));
  expect(document.body.textContent).toContain("Removed pool · Room · Deleted");
  expect(state.pageCalls.mock.calls.some(([name]) => name === "recordHistory:list")).toBe(false);
  const disclosure = document.querySelector("details")!;
  await act(async () => {
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
  });
  expect(state.pageCalls).toHaveBeenCalledWith("recordHistory:list", { entityType: "room", entityId: "room1" });
  expect(document.body.textContent).toContain("pool.jpg");
});
