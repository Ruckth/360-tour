// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoreMenu, type MoreMenuItem } from "@/components/ui/more-menu";
import { REASON_CHIPS } from "@/components/ui/reason-chips";
import { ReasonField } from "@/components/ui/reason-field";
import { visibleSentences } from "../browser/helpers/sentence-count";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const chip = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent === name)!;

function Reason({ error, initial = "" }: { error?: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return createElement(ReasonField, { value, onChange: setValue, chips: REASON_CHIPS.refund, error, id: "r" });
}

describe("REASON_CHIPS", () => {
  it("has the agreed presets and no Test chip", () => {
    expect(REASON_CHIPS.refund).toEqual(["Shortened treatment", "Guest complaint", "Charged by mistake"]);
    expect(REASON_CHIPS.void).toEqual(["Wrong guest", "Duplicate sale"]);
    expect(Object.values(REASON_CHIPS).flat()).not.toContain("Test");
  });
});

describe("ReasonField", () => {
  it("sets the text from a chip and marks it pressed", async () => {
    await render(createElement(Reason));
    const input = document.querySelector<HTMLInputElement>("#r")!;
    expect(document.querySelector('label[for="r"]')?.textContent).toBe("Reason");
    expect(chip("Guest complaint").getAttribute("aria-pressed")).toBe("false");

    await click(chip("Guest complaint"));
    expect(input.value).toBe("Guest complaint");
    expect(chip("Guest complaint").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Shortened treatment").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps edited text and releases the chip", async () => {
    await render(createElement(Reason));
    const input = document.querySelector<HTMLInputElement>("#r")!;
    await click(chip("Charged by mistake"));
    await type(input, "Charged by mistake twice");
    expect(input.value).toBe("Charged by mistake twice");
    expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
  });

  it("is required and shows its error", async () => {
    await render(createElement(Reason, { error: "Add a reason" }));
    const input = document.querySelector<HTMLInputElement>("#r")!;
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Add a reason");
  });
});

describe("MoreMenu", () => {
  const items = (onSelect: (label: string) => void): MoreMenuItem[] => [
    { label: "Void…", onSelect: () => onSelect("void"), destructive: true },
    { label: "Correct payment", onSelect: () => onSelect("correct") },
    { label: "Paper width", onSelect: () => onSelect("paper"), hidden: true },
    { label: "Share", onSelect: () => onSelect("share"), disabled: true },
  ];
  const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')];

  it("opens, lists visible items with destructive last, and runs the picked one", async () => {
    const picked: string[] = [];
    await render(createElement(MoreMenu, { items: items((label) => picked.push(label)) }));
    expect(trigger().className).toContain("size-11");
    expect(menuItems()).toHaveLength(0);

    await click(trigger());
    expect(menuItems().map((item) => item.textContent)).toEqual(["Correct payment", "Share", "Void…"]);
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    expect(menuItems()[2].className).toContain("text-destructive");
    expect(menuItems()[1].getAttribute("aria-disabled")).toBe("true");

    await click(menuItems()[0]);
    expect(picked).toEqual(["correct"]);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await render(createElement(MoreMenu, { items: items(() => {}) }));
    trigger().focus();
    await click(trigger());
    expect(menuItems()).toHaveLength(3);

    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it("renders nothing when every item is hidden", async () => {
    await render(createElement(MoreMenu, { items: [{ label: "Void…", onSelect: () => {}, hidden: true }] }));
    expect(host.innerHTML).toBe("");
  });
});

describe("visibleSentences", () => {
  it("counts visible explanatory sentences only", () => {
    host.innerHTML = `
      <p>Cash opens with the amount due. A note chip sets <b>what the guest</b> handed over.</p>
      <p>Balance due ฿1,200</p>
      <p>Too short.</p>
      <button>Record the refund for this guest.</button>
      <label>Type a reason for the refund.</label>
      <h3>This heading is a full sentence.</h3>
      <p hidden>This hidden line has many words.</p>
      <p style="display:none">This other hidden line has words.</p>
      <div data-sentence-budget="ignore"><p>Thank you for staying with us.</p></div>`;
    expect(visibleSentences(host)).toEqual([
      "Cash opens with the amount due.",
      "A note chip sets what the guest handed over.",
    ]);
  });
});
