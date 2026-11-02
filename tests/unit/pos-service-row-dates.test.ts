// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { CheckoutBackendProvider, type CheckoutActions, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { serviceStartAt, serviceStartLabel } from "@/components/checkout/OrderPanel";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";

/** A resort (Bangkok, UTC+7) wall-clock time, whatever zone the test machine runs in. */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);
const NOW = at("2026-10-28", "10:00");

describe("service row start times", () => {
  it("keeps the row's time when only the date changes, for past and future dates", () => {
    const start = at("2026-10-28", "14:30");
    expect(serviceStartAt(start, { date: "2026-10-26" }, NOW)).toBe(at("2026-10-26", "14:30"));
    expect(serviceStartAt(start, { date: "2026-11-03" }, NOW)).toBe(at("2026-11-03", "14:30"));
    // No arbitrary cap in either direction.
    expect(serviceStartAt(start, { date: "2025-01-02" }, NOW)).toBe(at("2025-01-02", "14:30"));
    expect(serviceStartAt(start, { date: "2027-06-30" }, NOW)).toBe(at("2027-06-30", "14:30"));
    // Exact, including seconds a row might carry from elsewhere.
    expect(serviceStartAt(start + 45_000, { date: "2026-10-01" }, NOW)).toBe(at("2026-10-01", "14:30") + 45_000);
  });

  it("keeps the row's date when only the time changes, instead of moving it to today", () => {
    expect(serviceStartAt(at("2026-10-20", "09:00"), { time: "15:15" }, NOW)).toBe(at("2026-10-20", "15:15"));
    expect(serviceStartAt(at("2026-12-24", "09:00"), { time: "18:00" }, NOW)).toBe(at("2026-12-24", "18:00"));
  });

  it("fills the missing part of a 'Now' row from the resort's today and current time", () => {
    // 00:30 in Bangkok is still the previous day in UTC: the row belongs to the resort's day.
    const justAfterMidnight = at("2026-10-29", "00:30");
    expect(serviceStartAt(undefined, { time: "10:00" }, justAfterMidnight)).toBe(at("2026-10-29", "10:00"));
    expect(serviceStartAt(undefined, { date: "2026-10-26" }, NOW)).toBe(at("2026-10-26", "10:00"));
  });

  it("ignores incomplete or impossible values", () => {
    expect(serviceStartAt(NOW, { date: "2026-02-31" }, NOW)).toBeNull();
    expect(serviceStartAt(NOW, { date: "" }, NOW)).toBeNull();
    expect(serviceStartAt(NOW, { time: "" }, NOW)).toBeNull();
    expect(serviceStartAt(NOW, { time: "24:00" }, NOW)).toBeNull();
  });

  it("labels rows with their date unless they are today", () => {
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
const timeInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Start time"]')!;
const dateButton = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Service date"]')!;
const day = (iso: string) => document.querySelector<HTMLElement>(`[data-day="${iso}"]:not([data-outside])`);
function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function pickDate(iso: string) {
  await click(dateButton());
  const cell = day(iso);
  expect(cell, `calendar shows ${iso}`).not.toBeNull();
  expect(cell!.hasAttribute("data-disabled")).toBe(false);
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

describe("dating a service row at checkout", () => {
  it("records the actual service date, past or future, and keeps date and time independent", async () => {
    const { backend, actions, updateLine } = recordingBackend();
    await show(backend, await orderWithMassage(actions));
    await click(row("Thai massage 60").querySelector("button"));
    expect(subtitle("Thai massage 60")).toContain("Now");

    type(timeInput(), "14:30");
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: at("2026-10-28", "14:30") }));
    expect(subtitle("Thai massage 60")).toContain("· 14:30");

    // Two days ahead: no date is disabled, and the time is kept.
    await pickDate("2026-10-30");
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: at("2026-10-30", "14:30") }));
    expect(subtitle("Thai massage 60")).toContain("Fri, Oct 30, 14:30");

    // Last Monday's massage, entered today.
    await pickDate("2026-10-26");
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: at("2026-10-26", "14:30") }));
    expect(subtitle("Thai massage 60")).toContain("Mon, Oct 26, 14:30");
    expect(dateButton().textContent).toContain("Oct 26, 2026");

    // Changing the time of a past row keeps its day rather than resetting it to today.
    type(timeInput(), "09:15");
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: at("2026-10-26", "09:15") }));
    expect(subtitle("Thai massage 60")).toContain("Mon, Oct 26, 09:15");
    expect(timeInput().value).toBe("09:15");
  });

  it("dates a 'Now' row at the current resort time, and 'Now' clears it again", async () => {
    const { backend, actions, updateLine } = recordingBackend();
    await show(backend, await orderWithMassage(actions));
    await click(row("Thai massage 60").querySelector("button"));
    expect(dateButton().textContent).toContain("Today");

    await pickDate("2026-10-27");
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: at("2026-10-27", "10:00") }));
    expect(timeInput().value).toBe("10:00");

    await click([...panel().querySelectorAll("button")].find((el) => el.textContent === "Now"));
    await settle();
    expect(updateLine).toHaveBeenLastCalledWith(expect.objectContaining({ startAt: null }));
    expect(subtitle("Thai massage 60")).toContain("Now");
  });
});
