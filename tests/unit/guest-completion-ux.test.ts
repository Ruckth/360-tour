// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "@/platform/intl";
import { BookingStepNav } from "@/components/booking/BookingStepNav";
import { SuggestionChips } from "@/components/chat/ChatMessages";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function show(node: ReactNode, locale: "en" | "th" = "en") {
  // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
  await act(async () => root.render(createElement(IntlProvider, { locale, messages: locale === "th" ? th : en, children: node })));
}

describe("G35 booking step states", () => {
  it("marks earlier steps complete, keeps one current step and leaves later steps upcoming", async () => {
    const onSelectStep = vi.fn();
    await show(createElement(BookingStepNav, { currentStep: "info", highestAllowedStepIndex: 1, onSelectStep }), "th");
    const buttons = [...document.querySelectorAll("button")];
    expect(buttons.map((button) => button.dataset.stepState)).toEqual(["complete", "current", "upcoming"]);
    expect(buttons.map((button) => button.getAttribute("aria-current"))).toEqual([null, "step", null]);
    expect(buttons[0].textContent).toBe(`${th.Booking.stepCompleted} ${th.Booking.villaDates}`);
    expect(buttons[0].querySelector("svg[aria-hidden=true]")).not.toBeNull();
    expect(buttons[1].querySelector("svg")).toBeNull();
    expect(buttons[1].textContent).toBe(th.Booking.guestDetails);
    // Only the current step uses the primary fill.
    expect(buttons.filter((button) => button.className.includes("bg-primary ")).length).toBe(1);
    // Completed steps stay reachable; future steps remain gated.
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[2].disabled).toBe(true);
    await act(async () => buttons[0].click());
    expect(onSelectStep).toHaveBeenCalledWith("select");
  });

  it("shows no completion mark on the first step", async () => {
    await show(createElement(BookingStepNav, { currentStep: "select", highestAllowedStepIndex: 2, onSelectStep: () => {} }));
    expect([...document.querySelectorAll("button")].map((button) => button.dataset.stepState)).toEqual(["current", "upcoming", "upcoming"]);
    expect(document.querySelector("svg")).toBeNull();
  });
});

describe("G36 follow-up suggestion targets", () => {
  it("gives compact chips a 44 px coarse-pointer minimum and activates a long label once", async () => {
    const onSelect = vi.fn();
    const long = { id: "family" as const, source: "static" as const, text: "Which villa is best for a family of five with two small children and grandparents?" };
    await show(createElement(SuggestionChips, { suggestions: [long, { id: "airport" as const, source: "static" as const, text: "Pickup?" }], onSelect }));
    const chips = [...document.querySelectorAll<HTMLButtonElement>("[data-testid=chat-suggestions] button")];
    for (const chip of chips) expect(chip.className).toMatch(/(^| )pointer-coarse:min-h-11( |$)/);
    await act(async () => chips[0].click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(long);
  });
});
