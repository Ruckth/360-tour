// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { CheckoutBackendProvider, type CheckoutActions, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { serviceScheduleValue, serviceStartLabel } from "@/components/checkout/OrderPanel";
import { receiptSchedule, scheduleLabel } from "@/components/checkout/checkout-ui";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { changeSchedule, scheduleFromStartAt } from "convex/lib/serviceSchedule";

/** A resort (Bangkok, UTC+7) wall-clock time, whatever zone the test machine runs in. */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);
const NOW = at("2026-10-28", "10:00");

describe("optional service date and time", () => {
  it("changes each part independently, clears either, and refuses invalid values instead of guessing", () => {
    expect(changeSchedule({}, { date: "2026-11-12" })).toEqual({ schedule: { date: "2026-11-12" } });
    expect(changeSchedule({ date: "2026-11-12" }, { time: "14:30" })).toEqual({ schedule: { date: "2026-11-12", time: "14:30" } });
    expect(changeSchedule({ date: "2026-11-12", time: "14:30" }, { date: null })).toEqual({ schedule: { time: "14:30" } });
    expect(changeSchedule({ time: "14:30" }, { time: "" })).toEqual({ schedule: {} });
    expect(changeSchedule({}, { date: "2026-02-31" })).toHaveProperty("problem");
    expect(changeSchedule({}, { time: "24:00" })).toHaveProperty("problem");
    // A legacy start splits into its resort date and time, so editing one keeps the other.
    expect(scheduleFromStartAt(at("2026-10-29", "00:30"))).toEqual({ date: "2026-10-29", time: "00:30" });
  });

  it("labels unset parts as unset, never as now", () => {
    expect(scheduleLabel({}, NOW)).toBe("Not scheduled");
    expect(scheduleLabel({ date: "2026-11-12" }, NOW)).toBe("Thu, Nov 12 · time not set");
    expect(scheduleLabel({ date: "2026-10-28" }, NOW)).toBe("Today · time not set");
    expect(scheduleLabel({ time: "14:30" }, NOW)).toBe("14:30 · date not set");
    expect(scheduleLabel({ date: "2027-01-05", time: "09:00" }, NOW)).toBe("Tue, Jan 5, 2027, 09:00");
    // Legacy rows keep their own label.
    expect(scheduleLabel(undefined, NOW)).toBeNull();
    expect(receiptSchedule(undefined)).toBeNull();
    expect(receiptSchedule({})).toBe("To be scheduled");
    expect(receiptSchedule({ date: "2026-11-12" })).toBe("Thu 12 Nov 2026 · time to be confirmed");
    expect(receiptSchedule({ time: "14:30" })).toBe("14:30 · date to be confirmed");
  });

  it("shows a legacy row's start in the editor, and blank parts for unscheduled and legacy 'now' rows", () => {
    expect(serviceScheduleValue({ startAt: at("2026-10-26", "14:30"), schedule: undefined })).toEqual({ date: "2026-10-26", time: "14:30" });
    expect(serviceScheduleValue({ startAt: undefined, schedule: undefined })).toEqual({ date: "", time: "" });
    expect(serviceScheduleValue({ startAt: undefined, schedule: { time: "09:15" } })).toEqual({ date: "", time: "09:15" });
  });

  it("labels legacy rows with their date unless they are today", () => {
    expect(serviceStartLabel(at("2026-10-28", "14:30"), NOW)).toBe("14:30");
    expect(serviceStartLabel(at("2026-10-26", "14:30"), NOW)).toBe("Mon, Oct 26, 14:30");
    expect(serviceStartLabel(at("2025-12-31", "14:30"), NOW)).toBe("Wed, Dec 31, 2025, 14:30");
  });
});

let root: Root;
function Page({ start }: { start: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const show = (backend: CheckoutBackend, start: OrderId | null) =>
  act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { start }))));
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const row = (name: string) => [...panel().querySelectorAll("li")].find((li) => li.querySelector("button")?.textContent?.startsWith(name))!;
const subtitle = (name: string) => row(name).querySelector("button span span:nth-child(2)")?.textContent ?? "";
const timeInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Service time"]')!;
const dateButton = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Service date"]')!;
const day = (iso: string) => document.querySelector<HTMLElement>(`[data-day="${iso}"]:not([data-outside])`);
const buttonNamed = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text);
function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function pickDate(iso: string) {
  await click(dateButton());
  const cell = day(iso);
  expect(cell, `calendar shows ${iso}`).not.toBeNull();
  await click(cell!.querySelector("button"));
  await settle();
}

/** The fixture backend, with every `updateLine` call recorded. */
function recordingBackend() {
  const base = createFixtureBackend();
  const real = base.useActions();
  const updateLine = vi.fn<CheckoutActions["updateLine"]>((args) => real.updateLine(args));
  const actions: CheckoutActions = { ...real, updateLine };
  return { backend: { ...base, useActions: () => actions } as CheckoutBackend, actions, updateLine };
}

async function orderWithMassage(actions: CheckoutActions) {
  const adding = actions.addItem({ item: { kind: "service", serviceId: "fxsvc000001" as Id<"services"> } });
  await vi.advanceTimersByTimeAsync(200);
  return (await adding).orderId;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a service row's optional date and time at checkout", () => {
  it("restores the saved time when saving or clearing fails", async () => {
    const { backend, actions, updateLine } = recordingBackend();
    await show(backend, await orderWithMassage(actions));
    await click(row("Thai massage 60").querySelector("button"));
    updateLine.mockRejectedValueOnce(new Error("Connection lost"));
    type(timeInput(), "14:30");
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
    expect(timeInput().value).toBe("");
    type(timeInput(), "14:30");
    await settle();
    expect(timeInput().value).toBe("14:30");
    updateLine.mockRejectedValueOnce(new Error("Clear failed"));
    await click(buttonNamed("Clear service time"));
    await settle();
    expect(timeInput().value).toBe("14:30");
    expect(subtitle("Thai massage 60")).toContain("14:30");
  });

  it("starts blank with two plain optional fields, and sets and clears each part on its own", async () => {
    const { backend, actions, updateLine } = recordingBackend();
    await show(backend, await orderWithMassage(actions));
    await click(row("Thai massage 60").querySelector("button"));
    expect(subtitle("Thai massage 60")).toContain("Not scheduled");
    expect(panel().textContent).toContain("Date (optional)");
    expect(panel().textContent).toContain("Time (optional)");
    // No mode choice and no "Now" shortcut: blank is simply unset.
    expect(buttonNamed("Now")).toBeUndefined();
    expect(timeInput().value).toBe("");
    expect(dateButton().textContent).toContain("No date");

    type(timeInput(), "14:30");
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ serviceTime: "14:30" }));
    expect(updateLine.mock.lastCall?.[0]).not.toHaveProperty("serviceDate");
    expect(subtitle("Thai massage 60")).toContain("14:30 · date not set");

    await pickDate("2026-10-30");
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ serviceDate: "2026-10-30" }));
    expect(subtitle("Thai massage 60")).toContain("Fri, Oct 30, 14:30");

    await click(buttonNamed("Clear service time"));
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ serviceTime: null }));
    expect(subtitle("Thai massage 60")).toContain("Fri, Oct 30 · time not set");
    expect(timeInput().value).toBe("");

    await click(dateButton());
    await click(buttonNamed("Clear"));
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ serviceDate: null }));
    expect(subtitle("Thai massage 60")).toContain("Not scheduled");
  });

  it("never fills a part in from the clock", async () => {
    const { backend, actions, updateLine } = recordingBackend();
    await show(backend, await orderWithMassage(actions));
    await click(row("Thai massage 60").querySelector("button"));
    await pickDate("2026-10-27");
    expect(updateLine).toHaveBeenLastCalledWith({ lineId: expect.any(String), serviceDate: "2026-10-27" });
    expect(timeInput().value).toBe("");
    expect(subtitle("Thai massage 60")).toContain("Tue, Oct 27 · time not set");
  });
});
