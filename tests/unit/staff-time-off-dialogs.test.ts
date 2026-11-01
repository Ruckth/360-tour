// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { TimeOffDialog, TimeOffList } from "@/components/admin/AdminStaffServicesManager";
import { BulkTimeOffDialog } from "@/components/admin/AdminStaffTimeOff";

const mutations = vi.hoisted(() => ({
  addTimeOff: vi.fn(),
  updateTimeOff: vi.fn(),
  removeTimeOff: vi.fn(),
}));
const pages = vi.hoisted(() => ({ read: vi.fn(), loadMore: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref).split(":").pop() as keyof typeof mutations;
    if (!mutations[name]) throw new Error(`Unexpected mutation ${name}`);
    return mutations[name];
  },
  useQuery: () => undefined,
  usePaginatedQuery: (_ref: unknown, args: unknown) => pages.read(args),
  useConvex: () => ({}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** A resort (Bangkok, UTC+7) wall-clock time, whatever zone the test machine runs in. */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);
const TODAY = "2026-10-28";

const staff = {
  _id: "staff1" as Id<"staff">, _creationTime: 0, name: "Nok", role: "Therapist", color: "#0f766e", status: "active",
  workingHours: [], breaks: [], createdAt: 0, updatedAt: 0,
} as unknown as Doc<"staff">;
const leave = {
  _id: "off1" as Id<"staffTimeOff">, _creationTime: 0, staffId: staff._id, label: "Leave",
  start: at("2026-10-27", "00:00"), end: at("2026-10-28", "00:00"), createdAt: 0,
} as unknown as Doc<"staffTimeOff">;

let root: Root;
const render = (node: ReactNode) => act(async () => root.render(createElement(ConfirmProvider, null, node)));
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const flush = () => act(async () => { await Promise.resolve(); });
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll("button")];
const button = (text: string, scope: ParentNode = document) => buttons(scope).find((el) => el.textContent?.trim() === text);
const alertDialog = () => document.querySelector('[role="alertdialog"]');
const errorAlert = () => [...document.querySelectorAll('p[role="alert"]')].map((el) => el.textContent).join(" ");
const day = (iso: string) => document.querySelector<HTMLElement>(`[data-day="${iso}"]:not([data-outside])`);
async function pickDate(pickerId: string, iso: string) {
  await click(document.getElementById(pickerId));
  const cell = day(iso);
  expect(cell, `calendar shows ${iso}`).not.toBeNull();
  expect(cell!.hasAttribute("data-disabled"), `${iso} can be picked`).toBe(false);
  await click(cell!.querySelector("button"));
  // The closing popover hands focus back to its trigger on a timer; let that land before the next click.
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(TODAY, "10:00"));
  for (const mutation of Object.values(mutations)) mutation.mockReset();
  pages.loadMore.mockReset();
  pages.read.mockReset().mockReturnValue({ results: [], status: "Exhausted", loadMore: pages.loadMore });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("editing time off", () => {
  it("keeps pending edits open and prevents duplicate submission", async () => {
    let finish!: () => void;
    mutations.updateTimeOff.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    await render(createElement(TimeOffDialog, { timeOff: leave, onClose }));
    await click(button("Save"));
    expect(button("Cancel")?.disabled).toBe(true);
    expect(button("Save")?.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    expect(mutations.updateTimeOff).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("saves an ordinary edit on Save, without a second confirmation", async () => {
    mutations.updateTimeOff.mockResolvedValue(null);
    const onClose = vi.fn();
    await render(createElement(TimeOffDialog, { timeOff: leave, staffName: "Nok", onClose }));

    await click(button("Sick"));
    await click(button("Save"));
    await flush();

    expect(alertDialog()).toBeNull();
    expect(document.body.textContent).not.toContain("Confirm time off change?");
    expect(mutations.updateTimeOff).toHaveBeenCalledTimes(1);
    expect(mutations.updateTimeOff).toHaveBeenCalledWith({
      timeOffId: leave._id, start: leave.start, end: leave.end, label: "Sick",
      expected: { start: leave.start, end: leave.end, label: "Leave" },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog and the edits open after a failed save, so Save can be retried", async () => {
    mutations.updateTimeOff
      .mockRejectedValueOnce(new Error("This time off changed since you opened it. Review the latest details and try again."))
      .mockResolvedValueOnce(null);
    const onClose = vi.fn();
    await render(createElement(TimeOffDialog, { timeOff: leave, onClose }));

    await click(button("Sick"));
    await click(button("Save"));
    await flush();
    expect(errorAlert()).toContain("This time off changed since you opened it.");
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Sick")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Save")?.disabled).toBe(false);

    await click(button("Save"));
    await flush();
    expect(mutations.updateTimeOff).toHaveBeenCalledTimes(2);
    expect(mutations.updateTimeOff.mock.calls[1][0]).toMatchObject({ label: "Sick" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves time off into the past, but still refuses an end before the start", async () => {
    mutations.updateTimeOff.mockResolvedValue(null);
    const onClose = vi.fn();
    await render(createElement(TimeOffDialog, { timeOff: leave, onClose }));

    // To before From: caught here with the reason, nothing sent.
    await pickDate("to-edit-to", "2026-10-25");
    await click(button("Save"));
    await flush();
    expect(errorAlert()).toContain("Time off must end after it starts.");
    expect(mutations.updateTimeOff).not.toHaveBeenCalled();

    // Last week's two days off.
    await pickDate("to-edit-from", "2026-10-20");
    await pickDate("to-edit-to", "2026-10-21");
    await click(button("Save"));
    await flush();
    expect(mutations.updateTimeOff).toHaveBeenCalledWith(
      expect.objectContaining({ start: at("2026-10-20", "00:00"), end: at("2026-10-22", "00:00"), label: "Leave" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still asks before removing, and removes nothing when cancelled", async () => {
    mutations.removeTimeOff.mockResolvedValue(null);
    const onClose = vi.fn();
    await render(createElement(TimeOffDialog, { timeOff: leave, onClose }));

    await click(button("Remove"));
    expect(alertDialog()?.textContent).toContain('Remove "Leave" time off?');
    await click(button("Cancel", alertDialog()!));
    await flush();
    expect(mutations.removeTimeOff).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await click(button("Remove"));
    await click(button("Remove", alertDialog()!));
    await flush();
    expect(mutations.removeTimeOff).toHaveBeenCalledWith({ timeOffId: leave._id });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("browsing time off", () => {
  it("shows past entries and keeps an empty filtered page pageable", async () => {
    let loaded = false;
    pages.read.mockImplementation(({ range }: { range: string }) => ({
      results: range === "past" && loaded ? [leave] : [],
      status: range === "past" && !loaded ? "CanLoadMore" : "Exhausted",
      loadMore: pages.loadMore,
    }));
    await render(createElement(TimeOffList, { staff }));
    expect(document.body.textContent).toContain("None scheduled.");
    await click(button("Past"));
    expect(pages.read).toHaveBeenLastCalledWith({ staffId: staff._id, range: "past" });
    expect(document.body.textContent).not.toContain("No past time off recorded.");
    await click(button("Load more time off"));
    expect(pages.loadMore).toHaveBeenCalledWith(20);
    loaded = true;
    await render(createElement(TimeOffList, { staff }));
    expect(document.querySelector('[aria-label="Edit Leave"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Remove Leave"]')).not.toBeNull();
    expect(button("Load more time off")).toBeUndefined();
    await click(document.querySelector('[aria-label="Edit Leave"]'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit time off");
  });
});

describe("adding time off", () => {
  it("records yesterday's sick day", async () => {
    mutations.addTimeOff.mockResolvedValue([{ staffId: staff._id, name: "Nok", timeOffId: "off2", conflicts: [] }]);
    await render(createElement(BulkTimeOffDialog, { staff: [staff], onClose: vi.fn() }));

    const person = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("Nok"))!;
    await click(person.querySelector("input"));
    await click(button("Sick"));
    await pickDate("bulk-off-from", "2026-10-27");
    await click(button("Add time off"));
    await flush();

    expect(mutations.addTimeOff).toHaveBeenCalledWith({
      staffIds: [staff._id], start: at("2026-10-27", "00:00"), end: at(TODAY, "00:00"), label: "Sick",
    });
    expect(document.body.textContent).toContain("Time off saved.");
  });

  it("refuses an end before the start without sending it", async () => {
    await render(createElement(BulkTimeOffDialog, { staff: [staff], onClose: vi.fn() }));
    const person = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("Nok"))!;
    await click(person.querySelector("input"));
    await pickDate("bulk-off-to", "2026-10-26");
    await click(button("Add time off"));
    await flush();

    expect(errorAlert()).toContain("Time off must end after it starts.");
    expect(mutations.addTimeOff).not.toHaveBeenCalled();
  });
});
