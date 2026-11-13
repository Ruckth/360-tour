// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Disclosure } from "@/components/ui/disclosure";
import { Toast, useToast, type ToastAction } from "@/components/ui/toast";

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function Harness({ onReady }: { onReady: (show: (text: string, action?: ToastAction) => void) => void }) {
  const toast = useToast(1000);
  useEffect(() => onReady(toast.show), [onReady, toast.show]);
  return createElement(Toast, toast);
}

const region = () => document.querySelector<HTMLElement>('[data-testid="toast"]')!;
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => (b.textContent || b.getAttribute("aria-label")) === name);

describe("Toast", () => {
  it("keeps one live region mounted and clears the message after its time", async () => {
    vi.useFakeTimers();
    let show!: (text: string, action?: ToastAction) => void;
    await act(async () => root.render(createElement(Harness, { onReady: (s) => (show = s) })));
    expect(region().getAttribute("role")).toBe("status");
    expect(region().textContent).toBe("");
    await act(async () => show("Approved 15% discount on #1043"));
    expect(region().textContent).toBe("Approved 15% discount on #1043");
    // A plain success has nothing to press.
    expect(region().querySelectorAll("button")).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(region().textContent).toBe("");
  });

  it("runs its action, then closes; a failed action shows why and waits for ✕", async () => {
    let show!: (text: string, action?: ToastAction) => void;
    await act(async () => root.render(createElement(Harness, { onReady: (s) => (show = s) })));
    const undo = vi.fn().mockResolvedValue(undefined);
    await act(async () => show("Ignored 1 report.", { label: "Undo", run: undo }));
    await act(async () => button("Undo")!.click());
    expect(undo).toHaveBeenCalledOnce();
    expect(region().textContent).toBe("");

    await act(async () => show("Ignored 1 report.", { label: "Undo", run: () => Promise.reject(new Error("Couldn't reopen.")) }));
    await act(async () => button("Undo")!.click());
    expect(region().textContent).toBe("Couldn't reopen.");
    await act(async () => button("Close notice")!.click());
    expect(region().textContent).toBe("");
  });
});

describe("Disclosure", () => {
  it("is a native details with the label, the hint after it, and lazy content", async () => {
    await act(async () => root.render(createElement(Disclosure, { label: "More", hint: "dates, minimums", lazy: "first-open", children: createElement("p", null, "Inside") })));
    const details = document.querySelector("details")!;
    expect(details.querySelector("summary")!.textContent).toBe("More · dates, minimums");
    expect(details.open).toBe(false);
    expect(document.body.textContent).not.toContain("Inside");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(document.body.textContent).toContain("Inside");
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    // Opened once, it stays mounted (history cursors survive closing).
    expect(document.body.textContent).toContain("Inside");
  });

  it("keeps its default open state and reports changes when controlled", async () => {
    const onOpenChange = vi.fn();
    await act(async () => root.render(createElement(Disclosure, { label: "More", open: true, onOpenChange, children: "Body" })));
    const details = document.querySelector("details")!;
    expect(details.open).toBe(true);
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
